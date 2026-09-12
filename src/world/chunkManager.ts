import * as THREE from 'three';
import { WORLD } from '../core/config';
import type { PropLibrary } from '../render/props';
import { Solids, boxesFrom, type Body } from './solids';
import { blocking, type Footprints } from './footprints';
import { BLOCKS_WALKING } from './biomes';
import type { PropKind } from './biomes';
import { PATCHES_PER_WORKER, type WorkerRequest, type WorkerResponse } from './messages';
import { partsOf } from './endless';
import { Tellings, boundsOf, patchOfChunk, type Patchwork } from './patchwork';
import { Standing } from './standing';
import { TileType } from './terrain';
import { mountainAt, type Ranges } from './ranges';
import { WAIT_FOR_THE_WORLD } from './chunkparcel';

import type { ChunkSource, ChunkTiles, TileWorld } from './tiles';
import type { TerrainSampler } from './terrain';
import { chunkKey } from './spatial';
import { PropBatch, disposeInstances, meshFromData, type PropInstance } from '../render/instancing';
import type { SeasonTintMaterials } from '../render/seasontint';

interface LoadedChunk {
  cx: number;
  cz: number;
  group: THREE.Group | null;
  tiles: ChunkTiles | null;
  /**
   * Whether this is ground the page grew for itself because the world had not answered yet.
   *
   * Kept so it can be put right. Ground drawn from our own generation is replaced the moment the
   * world's own arrives, and until it does this is what says which chunks are still somebody's
   * guess.
   */
  grown: boolean;
  /** What is standing on it, as boxes taken off the props' own geometry. */
}

/**
 * Streams chunks around a focus point. Generation happens in a worker pool; the main thread
 * only uploads finished buffers. Chunks outside UNLOAD_RADIUS are disposed.
 */
/** How far a mountain has to stand above a tile before nothing belongs there, in world units. */
const BURIED_BY = 1.5;

/**
 * How long the page will hold off entirely while a world is standing a new country up, in
 * milliseconds.
 *
 * The fifth of a second above is a guard against a socket that has gone quiet, and it was doing
 * that job well and one other job badly. A world with nobody in it has no country at all: asked for
 * its first chunk it has to build a terrain sampler — about a third of a second — and then grow a
 * hundred and twenty-one chunks at two and a half milliseconds each. Two-thirds of a second before
 * the first answer, against a fifth of a second of patience, so the guard meant for a hiccup fired
 * on every new world and the opening view of every new country was the page's own guess.
 *
 * The world now grows that view when somebody joins rather than when somebody asks, and says so
 * when it is done. Between hello and that word, this is how long the page believes it. It is not a
 * blind wait: the world has answered once already to say hello, so silence is silence and this
 * clock only runs while there is something on the other end.
 *
 * Ten seconds, and the number is bigger than it looks like it should be because standing a country
 * up is dearer than it looks. A polygon world's terrain sampler takes a third of a second; a road
 * tree's takes between one and a half and two and a half on a laptop with nothing else running, and
 * over five under a software rasteriser with the machine busy — which was measured, at five seconds
 * flat, by watching this fire and eight chunks of the page's own ground go down a moment before the
 * world's arrived. A Raspberry Pi is slower again.
 *
 * What it costs to be wrong in each direction is not symmetric, which is why it errs long. Too
 * short and the thing this exists to prevent happens anyway. Too long and a player looks at the
 * loading screen for a few seconds more in the one case where the world has said hello and then
 * stopped — and past this it is exactly that, a world that has stopped, so the page draws the
 * country rather than the dark.
 */
const WAIT_FOR_A_NEW_COUNTRY = 10_000;

export class ChunkManager implements TileWorld, ChunkSource {
  private readonly loaded = new Map<string, LoadedChunk>();
  /** Ground the world has sent, waiting for a worker to draw it. */
  private readonly sent = new Map<string, ArrayBuffer>();
  /**
   * How much of the country now drawn this page grew for itself rather than being sent.
   *
   * The one route left by which the two halves of this game can be standing in different countries.
   * It exists on purpose — a page that waited for the world would stare at nothing every time a
   * socket hiccupped, and on a first visit the world has a hundred and twenty-one chunks to grow
   * before it can answer any of them — but a page quietly inventing the country it is walking on is
   * the exact fault that leaves no trace, because invented ground looks like ground.
   *
   * So it is counted, and the count is live rather than cumulative: it climbs while the world is
   * still working and falls back to nought as the real ground arrives and is drawn over the top.
   * A page that settles at anything other than nought is a page standing on its own opinion, and
   * this is where you find that out.
   */
  grown = 0;
  /**
   * When the page stops giving a world that says it is still growing the benefit of the doubt.
   *
   * Nought means nobody has said any such thing, which is the ordinary state of affairs and leaves
   * the fifth of a second above as the only rule. It is set when a world says hello and cleared
   * when it says its country is grown, so the window it opens is exactly the length of one world
   * standing one country up — the one stretch of a game's life when the page's own generator is
   * certain to be drawing ground that is about to be replaced.
   */
  private countryDue = 0;
  /**
   * What is standing in the world, as boxes: one index for all of it rather than one per chunk.
   *
   * Per chunk was a bug with a shape you could walk through. A box was clamped to the sixteen tiles
   * of the chunk that owned it, so a cottage near a boundary — two and a half tiles across — had
   * the part of its box over the line registered in nobody's grid, and you walked through that half
   * of the house. See `solids.ts`.
   */
  private readonly solids = new Solids();
  /** What stops a walker out of doors: the measured props, less everything you walk through. */
  private readonly stops: Footprints;
  private readonly pending = new Map<string, number>();  // key → job id
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Array<{ cx: number; cz: number; since: number }> = [];
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

  /**
   * Let the hero be seen through whatever is standing in front of him.
   *
   * The props only. The ground is deliberately left whole: a terrace hides half a tile, which is
   * nothing, and not cutting it removes the whole floor-through-the-feet case rather than guarding
   * against it. Attached here rather than in the prop library because this is where the other edit
   * to that material goes in, and two features editing one shader is precisely the trap
   * `shaderpatch.ts` exists for.
   *
   * Taken as "something that can be attached to a material" rather than as a `Cutaway`, because
   * what the ground streamer needs to know about seeing through a wall is exactly nothing — and
   * the architecture test counts how many things in `world/` reach into `render/`, which is a
   * number that should not go up for a type name.
   */
  seeThrough(cutaway: { attach: (material: THREE.Material) => void }): void {
    cutaway.attach(this.props.material);
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

  /**
   * The mountains that can be stood on, when there are any: geometry, not chunks to stream.
   *
   * Not readonly any more. In a bounded world it is set once and is the world's; in an endless one
   * it is the rock of the patch the hero is in, and it changes under him as he walks. It is what
   * `heightAt` and the walking checks read, so a stale one is a hero standing on the memory of a
   * mountain in the next province.
   */
  private ranges: Ranges | null;

  /**
   * The country, when it has no edge: which patches each worker has been told about.
   *
   * Per worker rather than one list, because a patch is told to one worker at a time — the one that
   * is about to paint a chunk in it — and telling all of them every time would be three copies of a
   * square of country nobody has asked for. Most recent last, trimmed to `PATCHES_PER_WORKER`, which
   * is exactly what the worker does with them: two ends of one rule, and if they disagree a worker
   * is asked to paint from a patch it has quietly dropped.
   */
  private readonly told = new Tellings<Worker>(PATCHES_PER_WORKER);

  constructor(
    private readonly scene: THREE.Scene,
    sampler: TerrainSampler,
    private readonly props: PropLibrary,
    private readonly waterMaterial: THREE.Material,
    glowMaterial: THREE.Material,
    /**
     * Where to get the country from, for a world that has no whole to hand over.
     *
     * Left out, this behaves exactly as it always has: one sampler, handed to every worker at
     * start-up, painting every chunk there will ever be. Handed in, each chunk is painted from the
     * patch it falls in, and the workers are told about a patch the first time one of them is asked
     * for a chunk inside it.
     */
    private readonly patches?: Patchwork,
  ) {
    this.propBatch = new PropBatch(scene, props, glowMaterial);
    this.stops = blocking(props.footprints, BLOCKS_WALKING);
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

  /** The rock under this patch, for a country whose mountains change as you cross it. */
  standOn(ranges: Ranges | null): void {
    this.ranges = ranges;
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
      if (!this.loaded.has(k) && !this.pending.has(k)) {
        this.queue.push({ cx: cx + dx, cz: cz + dz, since: performance.now() });
      }
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
    const now = performance.now();
    for (let at = 0; at < this.queue.length && this.idle.length > 0;) {
      const job = this.queue[at];
      const key = chunkKey(job.cx, job.cz);
      /*
       * The world gets first refusal, and only for a moment.
       *
       * Both halves grow this country from the seed, so the ground the world sends is the ground
       * that should be drawn — but a page that stood and waited for it would be a page staring at
       * nothing every time a socket hiccupped. So a chunk waits a breath for the world and is grown
       * here if nothing comes: the country is right when the world answers and present when it does
       * not.
       *
       * The breath is longer while a world has said hello and not yet said its country is grown,
       * because that is the one stretch where a silence is not a fault. Standing a country up takes
       * a world several times a page's patience, so without this the opening view of every new
       * world was drawn from the page's own generator and replaced a moment later.
       */
      const stillComing = now - job.since < WAIT_FOR_THE_WORLD || now < this.countryDue;
      if (!this.sent.has(key) && stillComing) { at++; continue; }
      this.queue.splice(at, 1);
      const w = this.idle.pop()!;
      const id = this.nextId++;
      this.pending.set(key, id);
      /*
       * The ground the world sent, if it has sent it, and otherwise our own.
       *
       * Both halves grow this country from the seed, which is why they can be in different ones —
       * so where the world's own ground is to hand it is what gets drawn, and the page's generator
       * becomes what it should always have been: the thing that keeps the game playable while the
       * world is still answering.
       */
      const sent = this.sent.get(key);
      // which square of country paints this chunk, and whether this worker has been told about it
      const patch = this.patches ? this.tell(w, job.cx, job.cz) : undefined;
      if (sent) {
        this.sent.delete(key);
        w.postMessage({ type: 'mesh', id, cx: job.cx, cz: job.cz, chunk: sent, patch } satisfies WorkerRequest, [sent]);
      } else {
        w.postMessage({ type: 'gen', id, cx: job.cx, cz: job.cz, patch } satisfies WorkerRequest);
      }
    }
  }

  /**
   * A chunk of country the world has sent, or one read back out of what this page kept.
   *
   * Held until the chunk is meshed rather than meshed at once, because what is drawn is decided by
   * where the player is: ground that arrives for somewhere they have already walked away from is
   * ground nobody needs. It is dropped on the same rule as everything else here.
   */
  deliver(cx: number, cz: number, bytes: ArrayBuffer): void {
    const far = Math.max(Math.abs(cx - this.focusCx), Math.abs(cz - this.focusCz)) > WORLD.UNLOAD_RADIUS;
    if (far) return;
    const key = chunkKey(cx, cz);
    this.sent.set(key, bytes);
    /*
     * Ground that arrives after the page gave up waiting is still the ground that should be drawn.
     *
     * On a first visit the world has a hundred and twenty-one chunks to grow before it can answer
     * any of them, which is far longer than a page can stand still for — so most of a first view is
     * drawn from the page's own generator and the world's own answers turn up afterwards. Without
     * this they would be filed away for next time and the player would spend the whole of this
     * visit on ground the world does not agree with.
     *
     * Only chunks that were grown here are queued again: one that was drawn from the world's own
     * bytes is already right, and redrawing it would be an endless round of redrawing.
     */
    const drawn = this.loaded.get(key);
    if (drawn?.grown) this.queue.push({ cx, cz, since: 0 });
    this.pump();
  }

  /**
   * A world has said hello, and until it says its country is grown this page will wait for it.
   *
   * Said by whatever is holding the connection rather than worked out here, because this class has
   * never known whether there is a world at all — it draws chunks, and where they come from is
   * somebody else's business. All it does with the news is stop guessing for a while.
   */
  aWorldIsGrowingIt(): void {
    this.countryDue = performance.now() + WAIT_FOR_A_NEW_COUNTRY;
  }

  /** And the word that the country is grown: the waiting is over, whatever it found. */
  theCountryIsGrown(): void {
    this.countryDue = 0;
    this.pump();
  }

  /** Which chunks this page would like the world to send, of those it is waiting on. */
  wanted(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const job of this.queue) {
      if (this.sent.has(chunkKey(job.cx, job.cz))) continue;
      out.push([job.cx, job.cz]);
    }
    return out;
  }

  /**
   * Make sure this worker can paint this chunk, and say which patch it is painting from.
   *
   * Sent immediately before the chunk request rather than up front: messages arrive in order, so a
   * `patch` followed by a `gen` is a chunk painted by that patch, and nothing has to be waited for.
   */
  private tell(w: Worker, cx: number, cz: number): string {
    const patch = patchOfChunk(cx, cz);
    if (!this.told.needs(w, patch)) return patch;
    const sampler = this.patches!.patch(patch);
    w.postMessage({
      type: 'patch', patch, seed: sampler.seed, within: boundsOf(patch), ...partsOf(sampler),
    } satisfies WorkerRequest);
    return patch;
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

    // ground drawn over: whatever was there stops being this page's own opinion
    const before = this.loaded.get(k);
    if (before?.grown) this.grown--;
    if (msg.grown) this.grown++;
    /*
     * And if the world's own ground turned up while this was being drawn, draw it again.
     *
     * `deliver` puts a late arrival back in the queue, but only for chunks already on the ground —
     * one still being meshed is not, so its bytes are filed and nothing would ever ask for them.
     * That is a narrow window and it caught eleven chunks of a hundred and twenty-one, because a
     * first view is exactly when the world is slowest and the page busiest.
     */
    if (msg.grown && this.sent.has(k)) this.queue.push({ cx: msg.cx, cz: msg.cz, since: 0 });

    if (msg.empty) {
      this.loaded.set(k, { cx: msg.cx, cz: msg.cz, group: null, tiles: null, grown: msg.grown === true });
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
      // the same boxes the server builds, from the same footprints and the same prop stream
      this.solids.put(k, boxesFrom(readPropStream(msg.props), this.stops));
      this.propBatch.set(k, readPropStream(msg.props));
      this.scene.add(group);
      // the ground of a chunk never moves once it is down, so the frame need not walk it every
      // frame asking whether it has: a hundred chunks of that is a hundred chunks of nothing
      group.matrixAutoUpdate = false;
      group.updateMatrixWorld(true);
      group.matrixWorldAutoUpdate = false;
      this.loaded.set(k, {
        cx: msg.cx, cz: msg.cz, group, grown: msg.grown === true,
        tiles: { cx: msg.cx, cz: msg.cz, types: msg.types, heights: msg.heights, waters: msg.waters, biomes: msg.biomes },
      });
      this.stats.drawn++;
      if (!this.firstChunkSeen) { this.firstChunkSeen = true; this.onFirstChunk?.(); }
    }
    this.pump();
  }

  private unload(k: string, c: LoadedChunk): void {
    // ground that is no longer drawn is no longer this page's opinion about anything. Without this
    // the count only ever climbed: every chunk the page grew for itself and then walked away from
    // stayed on the tally for the rest of the session, so a page that had long since settled onto
    // the world's own country still reported a handful of its own — and the one number that says
    // whether the two halves are in the same place could never be believed when it was small.
    if (c.grown) this.grown--;
    this.propBatch.remove(k);
    this.solids.drop(k);
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
   * Whether a mountain stands over this tile.
   *
   * The ground under a range is still generated — the rock stands on it, and the rim needs it — so
   * a tile there looks like any other to anything reading the heightfield. Nothing should be put
   * there: what is above it is a cliff face, and what is under it cannot be seen.
   */
  buried(x: number, z: number): boolean {
    if (!this.ranges) return false;
    const hit = this.tileAt(x, z);
    if (!hit) return false;
    const rock = mountainAt(this.ranges, x, z);
    return rock !== null && rock > hit.t.heights[hit.i] + BURIED_BY;
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

  blocked(x: number, z: number, body?: Body): boolean {
    if (this.built.at(x, z)) return true;
    const hit = this.tileAt(x, z);
    if (!hit) return true;                       // ground that has not arrived is not ground to walk on
    // and then whatever is standing on it, against the box it is actually drawn at
    return this.solids.at(x, z, body);
  }

  /**
   * Does the way from one point to another cross a solid?
   *
   * Only the boxes: the tile grid and what the player has built are both tile-shaped, and nothing
   * a tile wide can hide between the samples a mover takes along its step.
   */
  crosses(x0: number, z0: number, x1: number, z1: number, body?: Body): boolean {
    return this.solids.crosses(x0, z0, x1, z1, body);
  }

  /** How far into whatever it is standing in a body is: the way out of a wall, for a mover. */
  depth(x: number, z: number, body: Body): number {
    return this.solids.depth(x, z, body);
  }

  /** Plain ground: grass or sand, no road, no floor, nothing already growing on it. */
  isPlantable(x: number, z: number): boolean {
    const hit = this.tileAt(x, z);
    if (!hit) return false;
    const type = hit.t.types[hit.i];
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
