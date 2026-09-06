import * as THREE from 'three';
import { WORLD } from '../core/config';
import type { PropLibrary } from '../render/props';
import type { PropKind } from './biomes';
import type { WorkerRequest, WorkerResponse } from './messages';
import { Standing } from './standing';
import { TileType } from './terrain';
import { mountainAt, type Ranges } from './ranges';
import type { TileWorld } from '../entities/entity';
import type { ChunkSource, ChunkTiles } from '../entities/manager';
import type { TerrainSampler } from './terrain';
import { chunkKey } from './spatial';
import { PropBatch, disposeInstances, meshFromData, type PropInstance } from '../render/instancing';
import type { SeasonTintMaterials } from '../render/seasontint';

interface LoadedChunk {
  cx: number;
  cz: number;
  group: THREE.Group | null;
  tiles: ChunkTiles | null;
}

/**
 * Streams chunks around a focus point. Generation happens in a worker pool; the main thread
 * only uploads finished buffers. Chunks outside UNLOAD_RADIUS are disposed.
 */
export class ChunkManager implements TileWorld, ChunkSource {
  private readonly loaded = new Map<string, LoadedChunk>();
  private readonly pending = new Map<string, number>();  // key → job id
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Array<{ cx: number; cz: number }> = [];
  private nextId = 1;
  private focusCx = Number.NaN;
  private focusCz = Number.NaN;
  private readonly offsets: Array<{ dx: number; dz: number }> = [];
  private readonly terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  /** Season tint: multiplied into every vertex colour of terrain and props. */
  /** Let a season tint drive the terrain and prop materials. */
  useSeasonTint(tint: SeasonTintMaterials): void {
    tint.attach(this.terrainMaterial);
    tint.attach(this.props.material);
  }
  private ready = 0;
  onFirstChunk: (() => void) | null = null;
  private firstChunkSeen = false;

  /**
   * Every prop in every loaded chunk, drawn per kind rather than per chunk.
   *
   * A chunk owning its own instanced meshes is the obvious way round and the wrong one: a chunk is
   * sixteen tiles square and holds a handful of any one kind of tree, so a hundred loaded chunks
   * meant hundreds of draw calls each carrying three or four instances. The chunk still decides
   * what grows where and still takes its props away when it goes; it just no longer draws them.
   */
  private readonly propBatch: PropBatch;

  stats = { loaded: 0, drawn: 0, pending: 0 };

  /** The world's mountains, when it has any: geometry to stand on, not chunks to stream. */
  private readonly ranges: Ranges | null;

  constructor(
    private readonly scene: THREE.Scene,
    sampler: TerrainSampler,
    private readonly props: PropLibrary,
    private readonly waterMaterial: THREE.Material,
    glowMaterial: THREE.Material,
  ) {
    this.propBatch = new PropBatch(scene, props, glowMaterial);
    this.ranges = sampler.ranges;
    const R = WORLD.VIEW_RADIUS;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) this.offsets.push({ dx, dz });
    this.offsets.sort((a, b) => a.dx * a.dx + a.dz * a.dz - (b.dx * b.dx + b.dz * b.dz));

    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../workers/chunkgen.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(w, e.data);
      w.postMessage({
        type: 'init', seed: sampler.seed, graph: sampler.graph, hydro: sampler.hydro, structures: sampler.structures,
      } satisfies WorkerRequest);
      this.workers.push(w);
    }
  }

  update(x: number, z: number): void {
    const cx = Math.floor(x / WORLD.CHUNK_SIZE);
    const cz = Math.floor(z / WORLD.CHUNK_SIZE);
    if (cx !== this.focusCx || cz !== this.focusCz) {
      this.focusCx = cx; this.focusCz = cz;
      this.refreshDesired();
    }
    this.pump();
    this.propBatch.update();
    this.stats.loaded = this.loaded.size;
    this.stats.pending = this.pending.size + this.queue.length;
  }

  private refreshDesired(): void {
    const { focusCx: cx, focusCz: cz } = this;
    this.queue.length = 0;
    for (const { dx, dz } of this.offsets) {
      const k = chunkKey(cx + dx, cz + dz);
      if (!this.loaded.has(k) && !this.pending.has(k)) this.queue.push({ cx: cx + dx, cz: cz + dz });
    }
    for (const [k, c] of this.loaded) {
      if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz)) > WORLD.UNLOAD_RADIUS) {
        this.unload(k, c);
      }
    }
  }

  /** True while the tab is hidden: queued chunks wait rather than keeping the workers busy. */
  private paused = false;

  /** Stand the workers down; whatever is queued stays queued. */
  pause(): void { this.paused = true; }

  /** Put them back to work on whatever piled up. */
  resume(): void {
    this.paused = false;
    this.pump();
  }

  private pump(): void {
    if (this.paused) return;
    while (this.idle.length > 0 && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const w = this.idle.pop()!;
      const id = this.nextId++;
      this.pending.set(chunkKey(job.cx, job.cz), id);
      w.postMessage({ type: 'gen', id, cx: job.cx, cz: job.cz } satisfies WorkerRequest);
    }
  }

  private onMessage(w: Worker, msg: WorkerResponse): void {
    if (msg.type === 'ready') {
      this.ready++;
      this.idle.push(w);
      this.pump();
      return;
    }
    this.idle.push(w);
    const k = chunkKey(msg.cx, msg.cz);
    if (this.pending.get(k) !== msg.id) { this.pump(); return; } // stale
    this.pending.delete(k);
    const far = Math.max(Math.abs(msg.cx - this.focusCx), Math.abs(msg.cz - this.focusCz)) > WORLD.UNLOAD_RADIUS;
    if (far) { this.pump(); return; }

    if (msg.empty) {
      this.loaded.set(k, { cx: msg.cx, cz: msg.cz, group: null, tiles: null });
    } else {
      const group = new THREE.Group();
      const land = meshFromData(msg.mesh, this.terrainMaterial);
      land.castShadow = true;
      land.receiveShadow = true;
      group.add(land);
      if (msg.water) {
        const water = meshFromData(msg.water, this.waterMaterial);
        water.receiveShadow = true;
        water.renderOrder = 2;
        group.add(water);
      }
      this.propBatch.set(k, readPropStream(msg.props));
      this.scene.add(group);
      // the ground of a chunk never moves once it is down, so the frame need not walk it every
      // frame asking whether it has: a hundred chunks of that is a hundred chunks of nothing
      group.matrixAutoUpdate = false;
      group.updateMatrixWorld(true);
      group.matrixWorldAutoUpdate = false;
      this.loaded.set(k, {
        cx: msg.cx, cz: msg.cz, group,
        tiles: { cx: msg.cx, cz: msg.cz, types: msg.types, heights: msg.heights, waters: msg.waters, blocked: msg.blocked, biomes: msg.biomes },
      });
      this.stats.drawn++;
      if (!this.firstChunkSeen) { this.firstChunkSeen = true; this.onFirstChunk?.(); }
    }
    this.pump();
  }

  private unload(k: string, c: LoadedChunk): void {
    this.propBatch.remove(k);
    if (c.group) {
      this.scene.remove(c.group);
      c.group.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      });
      disposeInstances(c.group);
      this.stats.drawn--;
    }
    this.loaded.delete(k);
  }

  private tileAt(x: number, z: number): { t: ChunkTiles; i: number } | null {
    const CS = WORLD.CHUNK_SIZE;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.loaded.get(chunkKey(cx, cz));
    if (!c || !c.tiles) return null;
    const lx = Math.floor(x - cx * CS), lz = Math.floor(z - cz * CS);
    return { t: c.tiles, i: lz * CS + lx };
  }

  /** Walkable ground height at a world position; null when unloaded, sea, or river/lake. */
  heightAt(x: number, z: number): number | null {
    const hit = this.tileAt(x, z);
    if (!hit) return null;
    const type = hit.t.types[hit.i];
    if (type === TileType.Skip || type === TileType.Seabed || type === TileType.Water) return null;
    const ground = hit.t.heights[hit.i];
    // A mountain is a solid standing on the ground rather than a shape the ground was bent into,
    // so what is underfoot is whichever of the two is higher. Nothing needs to know which it is
    // standing on: the surface is steep enough that STEP_LIMIT keeps walkers off the flanks by
    // itself, and the roads — which run along the borders between faces, where the geometry comes
    // down to the ground — are the ways through, exactly as the map draws them.
    const rock = this.ranges ? mountainAt(this.ranges, x, z) : null;
    return rock !== null && rock > ground ? rock : ground;
  }

  /**
   * The water surface at a point, or null where there is none. Rivers and lakes carry their own
   * level; the sea is the sea. A chunk that came back with no land in it at all is open ocean,
   * which is how anything that swims can live out there — nothing else is generated for it.
   */
  waterAt(x: number, z: number): number | null {
    const CS = WORLD.CHUNK_SIZE;
    const chunk = this.loaded.get(chunkKey(Math.floor(x / CS), Math.floor(z / CS)));
    if (!chunk) return null;                       // nothing generated here yet
    if (!chunk.tiles) return WORLD.WATER_Y;        // an empty chunk is open sea
    const lx = Math.floor(x - Math.floor(x / CS) * CS), lz = Math.floor(z - Math.floor(z / CS) * CS);
    const i = lz * CS + lx;
    if (chunk.tiles.types[i] === TileType.Water) return chunk.tiles.waters[i];
    return chunk.tiles.types[i] === TileType.Seabed ? WORLD.WATER_Y : null;
  }

  /**
   * What has been put up since the ground was made.
   *
   * It lives here rather than on the hero's own view of the world on purpose. Everything that
   * walks asks this one object whether it may — the hero, wolves, villagers, a constable running
   * somewhere. Teaching only the hero about a house would give you a wall that stopped you and let
   * a wolf stroll through it, which reads worse than no wall at all.
   */
  private readonly built = new Standing();

  /** Replace everything standing that the ground does not know about. */
  standsOn(tiles: Iterable<{ x: number; z: number }>): void {
    this.built.replace(tiles);
  }

  blocked(x: number, z: number): boolean {
    if (this.built.at(x, z)) return true;
    const hit = this.tileAt(x, z);
    return hit ? hit.t.blocked[hit.i] === 1 : true;
  }

  /** Plain ground: grass or sand, no road, no floor, nothing already growing on it. */
  isPlantable(x: number, z: number): boolean {
    const hit = this.tileAt(x, z);
    if (!hit) return false;
    const type = hit.t.types[hit.i];
    if (hit.t.blocked[hit.i]) return false;
    return type === TileType.Ground || type === TileType.GroundAlt || type === TileType.Sand;
  }

  isRoad(x: number, z: number): boolean {
    const hit = this.tileAt(x, z);
    if (!hit) return false;
    const type = hit.t.types[hit.i];
    return type === TileType.Road || type === TileType.Bridge || type === TileType.Plaza;
  }

  getTiles(cx: number, cz: number): ChunkTiles | null {
    const c = this.loaded.get(chunkKey(cx, cz));
    return c ? c.tiles : null;
  }

  dispose(): void {
    for (const [k, c] of this.loaded) this.unload(k, c);
    this.propBatch.dispose();
    for (const w of this.workers) w.terminate();
    this.terrainMaterial.dispose();
  }
}

/**
 * The worker sends props as a flat stream of nine numbers each: what it is, where it stands, which
 * way it faces, how big, how tall for its width, how far off upright, and how light or dark.
 * Walk it as instances.
 */
const PROP_STRIDE = 9;

function* readPropStream(data: Float32Array): Generator<PropInstance> {
  for (let i = 0; i < data.length; i += PROP_STRIDE) {
    yield {
      kind: data[i] as PropKind,
      x: data[i + 1], y: data[i + 2], z: data[i + 3],
      rot: data[i + 4], scale: data[i + 5],
      stretch: data[i + 6], lean: data[i + 7], tint: data[i + 8],
    };
  }
}
