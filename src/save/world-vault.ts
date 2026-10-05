import type { Vault } from '../../server/vault';

/** Installed and browser hosts keep the simulation's synchronous reads behind this async store. */
export interface WorldStorage {
  load(): Promise<readonly (readonly [string, string])[]>;
  write(name: string, text: string): Promise<void>;
}

/** Preload before opening rooms; acknowledge writes only after the host's durable operation. */
export class WorldVault implements Vault {
  private readonly kept: Map<string, string>;
  private tail: Promise<void> = Promise.resolve();
  private readonly latest = new Map<string, Promise<{ ok: true } | { ok: false; error: unknown }>>();

  private constructor(private readonly storage: WorldStorage, entries: readonly (readonly [string, string])[]) {
    this.kept = new Map(entries);
  }

  static async open(storage: WorldStorage): Promise<WorldVault> {
    return new WorldVault(storage, await storage.load());
  }

  read(name: string): string | null { return this.kept.get(name) ?? null; }
  list(prefix: string): string[] { return [...this.kept.keys()].filter(name => name.startsWith(prefix)); }

  write(name: string, text: string): void {
    this.kept.set(name, text);
    // Preserve simulation write order, including several rooms kept in one stop(). A failure
    // cannot poison the queue; only a later successful write to that same key clears its latch.
    const written = this.tail.then(async (): Promise<{ ok: true } | { ok: false; error: unknown }> => {
      try { await this.storage.write(name, text); return { ok: true }; }
      catch (error) { return { ok: false, error }; }
    });
    this.latest.set(name, written);
    this.tail = written.then(() => {});
  }

  /** Wait for every write accepted at this call; never count a memory update as durable. */
  async flush(): Promise<void> {
    const results = await Promise.all([...this.latest.values()]);
    const errors = results.flatMap(result => result.ok ? [] : [result.error]);
    if (errors.length) throw new AggregateError(errors, 'World storage did not keep every accepted write');
  }

  /** Explicit save retry: the simulation may already have marked its memory snapshot clean. */
  async retry(): Promise<void> {
    const accepted = [...this.latest.entries()];
    const results = await Promise.all(accepted.map(([, written]) => written));
    for (let i = 0; i < accepted.length; i++) {
      const [name, written] = accepted[i];
      // A newer accepted write owns this key now; never replay an older failed operation over it.
      if (!results[i].ok && this.latest.get(name) === written) this.write(name, this.kept.get(name)!);
    }
    await this.flush();
  }
}
