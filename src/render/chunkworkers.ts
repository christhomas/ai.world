import type { ChunkJobHost } from '../world/chunkjobs';
import type { WorkerResponse } from '../world/messages';

/** Browser worker adapter; an embedded host supplies its own ordered job queue. */
export const browserChunkJobs: ChunkJobHost = {
  get concurrency() { return Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)); },
  now: () => performance.now(),
  create(receive) {
    const worker = new Worker(new URL('../workers/chunkgen.worker.ts', import.meta.url), { type: 'module' });
    let live = true;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => { if (live) receive(event.data); };
    return {
      postMessage(message, transfer = []) { if (live) worker.postMessage(message, transfer); },
      terminate() { if (!live) return; live = false; worker.onmessage = null; worker.terminate(); },
    };
  },
};
