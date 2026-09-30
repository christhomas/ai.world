import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { growPatch, growWorld, islandsFor } from '../src/world/growworld';
import { boundsOf } from '../src/world/patchwork';
import { partsOf, type PatchParts } from '../src/world/endless';
import type { Highland } from '../src/world/highland';
import type { TerrainLayer } from '../src/world/terrainlayers';
import { terrainPreview } from '../src/ui/terrainpreview';
import { assessSkyAccess, assessSkyEyrie, type SkyAccessAssessment } from '../src/world/skyaccess';
import { Manifest, type Anchor, type ManifestJson } from '../src/world/manifest';
import { TerrainSampler } from '../src/world/terrain';
import { roadPartsOf, type GroundSource, type RoadParts } from './groundsource';
import { assessPlacePins, assessVillageContinuity, type PlacePin } from '../src/world/editimpacts';

type Request = { id: number; seed: number; patch: string; layers: readonly Highland[]; terrain: readonly TerrainLayer[] }
  | { id: number; seed: number; x: number; z: number; size: number; layers: readonly Highland[]; terrain: readonly TerrainLayer[] }
  | { id: number; seed: number; x: number; z: number; reach: number; before: ManifestJson; after: ManifestJson;
    pins: PlacePin[]; villages: string[]; protectAllVillages: boolean }
  | { id: number; seed: number; manifest: ManifestJson; eyrie: Anchor }
  | { id: number; seed: number; islands: readonly Anchor[] };
type Reply = { id: number; parts?: PatchParts; road?: RoadParts; pixels?: Uint8ClampedArray; assessment?: SkyAccessAssessment;
  placement?: { conflict: string | null }; error?: string };
const TASK = 'aiworld-ground';

// The published server is one bundle. A worker starts that same bundle with a task marker;
// index.ts then skips the HTTP listener, and this branch grows patches away from the event loop.
if (!isMainThread && workerData?.task === TASK) {
  parentPort?.on('message', (request: Request) => {
    let reply: Reply;
    try {
      reply = 'patch' in request
        ? { id: request.id, parts: partsOf(growPatch(request.seed, boundsOf(request.patch), request.layers, request.terrain)) }
        : 'before' in request
          ? { id: request.id, assessment: (() => {
            const sky = assessSkyAccess(request.seed, request.before, request.after,
              request.x, request.z, request.reach);
            if (sky.conflict) return sky;
            const changed = [{ x: request.x, z: request.z, reach: request.reach }];
            const conflict = assessPlacePins(request.seed, request.before, request.after, changed, request.pins)
              ?? assessVillageContinuity(request.seed, request.before, request.after,
                changed, request.villages, request.protectAllVillages);
            return conflict ? { sites: [], conflict } : sky;
          })() }
          : 'eyrie' in request
            ? { id: request.id, placement: { conflict: assessSkyEyrie(request.seed, request.manifest, request.eyrie) } }
          : 'islands' in request
            ? { id: request.id, road: grownRoad(request.seed, request.islands) }
          : { id: request.id, pixels: terrainPreview(request.seed, request.terrain,
            request.x, request.z, request.size, request.layers) };
    } catch (error) {
      reply = { id: request.id, error: error instanceof Error ? error.message : String(error) };
    }
    parentPort?.postMessage(reply);
  });
}

/**
 * A whole road country, grown here so the simulation's thread only has to rebuild it. See #479.
 *
 * A fresh world has no islands in its manifest yet, and planning them is part of growing it; they
 * go back with the parts so the simulation can write them down, exactly as `islandsFor` would have.
 */
function grownRoad(seed: number, saved: readonly Anchor[]): RoadParts {
  const islands = saved.length > 0 ? saved : islandsFor(new Manifest(seed), seed);
  return roadPartsOf(islands, new TerrainSampler(growWorld(seed, islands)));
}

/** How long one request may take, from being sent, before its thread is presumed stuck. */
const REQUEST_TIMEOUT = 120_000;

export interface GroundWorkerOptions {
  /** How a thread is started. The published bundle by default; a test hands in one that misbehaves. */
  start?: () => Worker;
  /** Milliseconds one request may take before its thread is replaced. See `REQUEST_TIMEOUT`. */
  timeout?: number;
}

type Answer = PatchParts | RoadParts | Uint8ClampedArray | SkyAccessAssessment | { conflict: string | null };

/**
 * The thread the server grows ground on, and what happens when it goes wrong.
 *
 * A thread that died used to be posted to for ever: every request after it sat in a promise nothing
 * would settle, and a page preparing that world waited with it (#480). Now a dead thread is
 * forgotten, whatever it was asked is refused, and the next request starts a new one. A thread that
 * has not answered in `timeout` is treated the same way, because a request that late is a thread
 * stuck inside it and everything queued behind it is stuck too.
 *
 * The clock starts when a request is sent, so time spent queued behind other requests counts. Two
 * minutes is room for several road countries (eight seconds each on the Pi) ahead of it.
 */
export class GroundWorker implements GroundSource {
  private readonly start: () => Worker;
  private readonly timeout: number;
  private worker: Worker | null = null;
  private closed = false;
  private next = 1;
  private readonly pending = new Map<number, {
    resolve: (value: Answer) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(options: GroundWorkerOptions = {}) {
    this.start = options.start ?? (() => new Worker(new URL(import.meta.url), { workerData: { task: TASK } }));
    this.timeout = options.timeout ?? REQUEST_TIMEOUT;
  }

  /** The thread requests go to, started if there is none because the last one was lost. */
  private live(): Worker {
    if (this.worker) return this.worker;
    const worker = this.start();
    worker.on('message', (reply: Reply) => {
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      clearTimeout(waiting.timer);
      const answer = reply.parts ?? reply.road ?? reply.pixels ?? reply.assessment ?? reply.placement;
      if (answer) waiting.resolve(answer);
      else waiting.reject(new Error(reply.error ?? 'The ground worker sent no answer.'));
    });
    worker.on('error', (error: Error) => this.lost(worker, error));
    worker.on('exit', (code) => this.lost(worker, new Error(`The ground worker stopped with code ${code}.`)));
    this.worker = worker;
    return worker;
  }

  /** Forget a thread and refuse everything it was asked; the next request starts another. */
  private lost(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  private ask<T extends Answer>(request: (id: number) => Request): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The ground worker has been closed.'));
    const worker = this.live();
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.lost(worker, new Error(`The ground worker took longer than ${this.timeout} ms and was replaced.`));
        void worker.terminate();
      }, this.timeout);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      worker.postMessage(request(id));
    });
  }

  grow(seed: number, patch: string, layers: readonly Highland[], terrain: readonly TerrainLayer[]): Promise<PatchParts> {
    return this.ask((id) => ({ id, seed, patch, layers, terrain }));
  }

  /** Grow a whole road country, which is seconds of work the event loop must not wait through. */
  growRoad(seed: number, islands: readonly Anchor[]): Promise<RoadParts> {
    return this.ask((id) => ({ id, seed, islands }));
  }

  /** Build a small authored map away from HTTP and WebSocket event handling. */
  preview(seed: number, x: number, z: number, size: number,
    layers: readonly Highland[], terrain: readonly TerrainLayer[]): Promise<Uint8ClampedArray> {
    return this.ask((id) => ({ id, seed, x, z, size, layers, terrain }));
  }

  /** Check changed country and pin its existing sky villages away from the HTTP event loop. */
  assess(seed: number, before: ManifestJson, after: ManifestJson,
    x: number, z: number, reach: number, pins: PlacePin[], villages: string[],
    protectAllVillages: boolean): Promise<SkyAccessAssessment> {
    return this.ask((id) => ({ id, seed, before, after, x, z, reach, pins, villages, protectAllVillages }));
  }

  placeEyrie(seed: number, manifest: ManifestJson, eyrie: Anchor): Promise<{ conflict: string | null }> {
    return this.ask((id) => ({ id, seed, manifest, eyrie }));
  }

  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    if (!worker) return;
    this.lost(worker, new Error('The ground worker has been closed.'));
    await worker.terminate();
  }
}
