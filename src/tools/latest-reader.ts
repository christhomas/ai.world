export interface WorldReaderWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}

/** One active read. New choices cancel stale growth; identical live polls share its answer. */
export class LatestWorldReader {
  private worker: WorldReaderWorker | null = null;
  private sequence = 0;
  private pending: {
    id: number; identity: string; answer: Promise<unknown>;
    resolve(value: unknown): void; reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private readonly create: () => WorldReaderWorker) {}

  close(error = new Error('Tools page closed.')): void {
    this.worker?.terminate(); this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }

  request(action: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    const identity = JSON.stringify([action, fields]);
    if (this.pending?.identity === identity) return this.pending.answer;
    if (this.pending) this.close(new Error('This browser read was superseded by a newer selection.'));
    if (!this.worker) {
      try { this.worker = this.create(); }
      catch (error) { return Promise.reject(error); }
      const active = this.worker;
      active.onmessage = event => {
        const pending = this.pending;
        if (this.worker !== active || !pending || pending.id !== event.data.id) return;
        this.pending = null;
        clearTimeout(pending.timer);
        if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve(event.data.value);
      };
      active.onerror = () => {
        if (this.worker === active) this.close(new Error('The browser world reader failed. Retry to open it again.'));
      };
    }
    const id = ++this.sequence;
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    const answer = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => this.close(new Error('Reading the browser world timed out. Retry to open it again.')), 60_000);
    this.pending = { id, identity, answer, resolve, reject, timer };
    try { this.worker.postMessage({ id, action, ...fields }); }
    catch (error) { this.close(error instanceof Error ? error : new Error('The browser world request failed.')); }
    return answer;
  }
}
