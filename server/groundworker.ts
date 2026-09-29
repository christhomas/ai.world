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

export class GroundWorker implements GroundSource {
  private readonly worker: Worker;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (value: PatchParts | RoadParts | Uint8ClampedArray | SkyAccessAssessment | { conflict: string | null }) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL(import.meta.url), { workerData: { task: TASK } });
    this.worker.on('message', (reply: Reply) => {
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if (reply.parts) waiting.resolve(reply.parts);
      else if (reply.road) waiting.resolve(reply.road);
      else if (reply.pixels) waiting.resolve(reply.pixels);
      else if (reply.assessment) waiting.resolve(reply.assessment);
      else if (reply.placement) waiting.resolve(reply.placement);
      else waiting.reject(new Error(reply.error ?? 'The ground worker sent no patch.'));
    });
    const failed = (error: Error) => {
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
    };
    this.worker.on('error', failed);
    this.worker.on('exit', (code) => {
      if (this.pending.size) failed(new Error(`The ground worker stopped with code ${code}.`));
    });
  }

  grow(seed: number, patch: string, layers: readonly Highland[], terrain: readonly TerrainLayer[]): Promise<PatchParts> {
    const id = this.next++;
    return new Promise<PatchParts>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as PatchParts), reject });
      this.worker.postMessage({ id, seed, patch, layers, terrain } satisfies Request);
    });
  }

  /** Grow a whole road country, which is seconds of work the event loop must not wait through. */
  growRoad(seed: number, islands: readonly Anchor[]): Promise<RoadParts> {
    const id = this.next++;
    return new Promise<RoadParts>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as RoadParts), reject });
      this.worker.postMessage({ id, seed, islands } satisfies Request);
    });
  }

  /** Build a small authored map away from HTTP and WebSocket event handling. */
  preview(seed: number, x: number, z: number, size: number,
    layers: readonly Highland[], terrain: readonly TerrainLayer[]): Promise<Uint8ClampedArray> {
    const id = this.next++;
    return new Promise<Uint8ClampedArray>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as Uint8ClampedArray), reject });
      this.worker.postMessage({ id, seed, x, z, size, layers, terrain } satisfies Request);
    });
  }

  /** Check changed country and pin its existing sky villages away from the HTTP event loop. */
  assess(seed: number, before: ManifestJson, after: ManifestJson,
    x: number, z: number, reach: number, pins: PlacePin[], villages: string[],
    protectAllVillages: boolean): Promise<SkyAccessAssessment> {
    const id = this.next++;
    return new Promise<SkyAccessAssessment>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as SkyAccessAssessment), reject });
      this.worker.postMessage({ id, seed, before, after, x, z, reach,
        pins, villages, protectAllVillages } satisfies Request);
    });
  }

  placeEyrie(seed: number, manifest: ManifestJson, eyrie: Anchor): Promise<{ conflict: string | null }> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as { conflict: string | null }), reject });
      this.worker.postMessage({ id, seed, manifest, eyrie } satisfies Request);
    });
  }

  async close(): Promise<void> { await this.worker.terminate(); }
}
