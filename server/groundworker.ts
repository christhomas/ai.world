import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { growPatch } from '../src/world/growworld';
import { boundsOf } from '../src/world/patchwork';
import { partsOf, type PatchParts } from '../src/world/endless';
import type { Highland } from '../src/world/highland';
import type { TerrainLayer } from '../src/world/terrainlayers';

type Request = { id: number; seed: number; patch: string; layers: readonly Highland[]; terrain: readonly TerrainLayer[] };
type Reply = { id: number; parts?: PatchParts; error?: string };
const TASK = 'aiworld-ground';

// The published server is one bundle. A worker starts that same bundle with a task marker;
// index.ts then skips the HTTP listener, and this branch grows patches away from the event loop.
if (!isMainThread && workerData?.task === TASK) {
  parentPort?.on('message', (request: Request) => {
    let reply: Reply;
    try {
      reply = { id: request.id, parts: partsOf(growPatch(
        request.seed, boundsOf(request.patch), request.layers, request.terrain,
      )) };
    } catch (error) {
      reply = { id: request.id, error: error instanceof Error ? error.message : String(error) };
    }
    parentPort?.postMessage(reply);
  });
}

export class GroundWorker {
  private readonly worker: Worker;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (parts: PatchParts) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL(import.meta.url), { workerData: { task: TASK } });
    this.worker.on('message', (reply: Reply) => {
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if (reply.parts) waiting.resolve(reply.parts);
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, seed, patch, layers, terrain } satisfies Request);
    });
  }

  async close(): Promise<void> { await this.worker.terminate(); }
}
