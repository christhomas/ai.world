import type { WorkerRequest, WorkerResponse } from './messages';

/** Ordered jobs: create returns before delivery; init/patch/gen retain their send order. */
export interface ChunkJob {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

/** Scheduling and monotonic time belong to the host, rather than the scene builder. */
export interface ChunkJobHost {
  readonly concurrency: number;
  now(): number;
  create(receive: (reply: WorkerResponse) => void): ChunkJob;
}
