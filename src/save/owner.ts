import type { SaveStore } from './store';

/** One slot's ordered, owned writes. Capture JSON now, before later game state can mutate it. */
export class SaveOwner {
  private tail: Promise<void> | null = null;
  private live = true;
  private failed = false;
  private failure: unknown;
  private sequence = 0;

  constructor(private readonly store: SaveStore, private readonly key: string) {}

  write<T>(value: T, strict = false): Promise<void> {
    if (!this.live) return Promise.reject(new Error('Save owner is closed'));
    const sequence = ++this.sequence;
    let snapshot: T;
    try { snapshot = JSON.parse(JSON.stringify(value)) as T; }
    catch (error) { this.failed = true; this.failure = error; return Promise.reject(error); }
    const save = () => strict && this.store.saveStrict
      ? this.store.saveStrict(this.key, snapshot) : this.store.save(this.key, snapshot);
    let pending: Promise<void>;
    if (this.tail) pending = this.tail.then(save);
    else {
      try { pending = Promise.resolve(save()); }
      catch (error) { pending = Promise.reject(error); }
    }
    const settled = pending.then(() => { if (sequence === this.sequence) this.failed = false; }, error => {
      if (sequence === this.sequence) { this.failed = true; this.failure = error; }
    });
    this.tail = settled;
    void settled.then(() => { if (this.tail === settled) this.tail = null; });
    return pending;
  }

  /** Drain accepted writes, including any queued during an earlier await, then report failures. */
  async flush(): Promise<void> {
    while (this.tail) await this.tail;
    if (this.failed) throw this.failure;
  }

  /** Fence new requests; accepted writes still complete and can be awaited through flush. */
  dispose(): void { this.live = false; }
  async close(): Promise<void> { this.dispose(); await this.flush(); }
}
