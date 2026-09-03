import * as THREE from 'three';
import { WORLD } from '../core/config';
import type { PropLibrary } from '../render/props';
import type { PropKind } from './biomes';
import type { WorkerRequest, WorkerResponse } from './messages';
import { TileType } from './terrain';
import type { TileWorld } from '../entities/entity';
import type { ChunkSource, ChunkTiles } from '../entities/manager';
import type { TerrainSampler } from './terrain';
import { chunkKey } from './spatial';

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
  private ready = 0;
  onFirstChunk: (() => void) | null = null;
  private firstChunkSeen = false;

  stats = { loaded: 0, drawn: 0, pending: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    sampler: TerrainSampler,
    private readonly props: PropLibrary,
    private readonly waterMaterial: THREE.Material,
    private readonly glowMaterial: THREE.Material,
  ) {
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

  private pump(): void {
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
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(msg.mesh.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(msg.mesh.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(msg.mesh.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(msg.mesh.indices, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.terrainMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (msg.water) {
        const wgeo = new THREE.BufferGeometry();
        wgeo.setAttribute('position', new THREE.BufferAttribute(msg.water.positions, 3));
        wgeo.setAttribute('normal', new THREE.BufferAttribute(msg.water.normals, 3));
        wgeo.setAttribute('color', new THREE.BufferAttribute(msg.water.colors, 3));
        if (msg.water.flow) wgeo.setAttribute('flow', new THREE.BufferAttribute(msg.water.flow, 1));
        wgeo.setIndex(new THREE.BufferAttribute(msg.water.indices, 1));
        wgeo.computeBoundingSphere();
        const wmesh = new THREE.Mesh(wgeo, this.waterMaterial);
        wmesh.receiveShadow = true;
        wmesh.renderOrder = 2;
        group.add(wmesh);
      }
      this.addProps(group, msg.props);
      this.scene.add(group);
      this.loaded.set(k, {
        cx: msg.cx, cz: msg.cz, group,
        tiles: { cx: msg.cx, cz: msg.cz, types: msg.types, heights: msg.heights, waters: msg.waters, blocked: msg.blocked, biomes: msg.biomes },
      });
      this.stats.drawn++;
      if (!this.firstChunkSeen) { this.firstChunkSeen = true; this.onFirstChunk?.(); }
    }
    this.pump();
  }

  private addProps(group: THREE.Group, data: Float32Array): void {
    const byKind = new Map<PropKind, number[]>();
    for (let i = 0; i < data.length; i += 6) {
      const kind = data[i] as PropKind;
      let list = byKind.get(kind);
      if (!list) { list = []; byKind.set(kind, list); }
      list.push(i);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [kind, list] of byKind) {
      const geo = this.props.geometries.get(kind);
      if (!geo) continue;
      const inst = new THREE.InstancedMesh(geo, this.props.material, list.length);
      list.forEach((i, n) => {
        q.setFromAxisAngle(up, data[i + 4]);
        const s = data[i + 5];
        m.compose(new THREE.Vector3(data[i + 1], data[i + 2], data[i + 3]), q, new THREE.Vector3(s, s, s));
        inst.setMatrixAt(n, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      group.add(inst);
      const glowGeo = this.props.glows.get(kind);
      if (glowGeo) {
        const glow = new THREE.InstancedMesh(glowGeo, this.glowMaterial, list.length);
        glow.instanceMatrix.copy(inst.instanceMatrix);
        glow.instanceMatrix.needsUpdate = true;
        glow.computeBoundingSphere();
        group.add(glow);
      }
    }
  }

  private unload(k: string, c: LoadedChunk): void {
    if (c.group) {
      this.scene.remove(c.group);
      c.group.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
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
    return hit.t.heights[hit.i];
  }

  waterAt(x: number, z: number): number | null {
    const hit = this.tileAt(x, z);
    if (!hit) return null;
    return hit.t.types[hit.i] === TileType.Water ? hit.t.waters[hit.i] : null;
  }

  blocked(x: number, z: number): boolean {
    const hit = this.tileAt(x, z);
    return hit ? hit.t.blocked[hit.i] === 1 : true;
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
    for (const w of this.workers) w.terminate();
    this.terrainMaterial.dispose();
  }
}
