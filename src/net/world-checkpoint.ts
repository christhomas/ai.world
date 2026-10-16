export const WORLD_FLUSH = 'world-flush:';
export const WORLD_FLUSHED = 'world-flushed:';
export const WORLD_FLUSH_FAILED = 'world-flush-failed:';

export function checkpointId(parcel: unknown, prefix: string): number | null {
  if (typeof parcel !== 'string' || !parcel.startsWith(prefix)) return null;
  const suffix = parcel.slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(suffix)) return null;
  const id = Number(suffix);
  return Number.isSafeInteger(id) ? id : null;
}

interface CheckpointPorts {
  send(parcel: string): void;
  after(callback: () => void, milliseconds: number): () => void;
}

/** One bounded durable checkpoint; stale replies cannot acknowledge a later attempt. */
export class WorldCheckpoint {
  private next = 0;
  private retired = false;
  private pending: { id: number; promise: Promise<void>; resolve(): void;
    reject(error: unknown): void; cancel(): void } | null = null;

  constructor(private readonly ports: CheckpointPorts) {}

  flush(): Promise<void> {
    if (this.retired) return Promise.reject(new Error('The world connection is closed'));
    if (this.pending) return this.pending.promise;
    if (this.next >= Number.MAX_SAFE_INTEGER) return Promise.reject(new Error('World checkpoint ids exhausted'));
    const id = ++this.next;
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    const pending = { id, promise, resolve, reject, cancel: () => {} };
    this.pending = pending;
    try {
      pending.cancel = this.ports.after(() => {
        if (this.pending === pending) this.fail(new Error('The world save timed out'));
      }, 20_000);
      this.ports.send(WORLD_FLUSH + id);
    } catch (error) { this.fail(error); }
    return promise;
  }

  receive(parcel: unknown): boolean {
    if (typeof parcel !== 'string') return false;
    const failed = parcel.startsWith(WORLD_FLUSH_FAILED);
    if (!failed && !parcel.startsWith(WORLD_FLUSHED)) return false;
    const id = checkpointId(parcel, failed ? WORLD_FLUSH_FAILED : WORLD_FLUSHED), pending = this.pending;
    if (pending && id === pending.id) {
      this.pending = null; pending.cancel();
      if (failed) pending.reject(new Error('World storage did not keep the checkpoint'));
      else pending.resolve();
    }
    return true;
  }

  private fail(error: unknown): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null; pending.cancel(); pending.reject(error);
  }

  close(): void {
    this.retired = true;
    this.fail(new Error('The world closed before its save was acknowledged'));
  }
}
