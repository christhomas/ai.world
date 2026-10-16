interface SavedExitPorts {
  park(): void;
  resume(): void;
  save(): Promise<void>;
  release(): void;
  depart(): void;
}

/** A failed save keeps the owned game available; duplicate exit gestures share the same write. */
export function savedExit(ports: SavedExitPorts): () => Promise<void> {
  let pending: Promise<void> | null = null;
  let complete = false;
  return () => {
    if (complete) return Promise.resolve();
    if (pending) return pending;
    const leave = async () => {
      ports.park();
      try { await ports.save(); }
      catch (error) { ports.resume(); throw error; }
      complete = true;
      try { ports.release(); }
      finally { ports.depart(); }
    };
    pending = leave();
    void pending.then(() => { pending = null; }, () => { pending = null; });
    return pending;
  };
}
