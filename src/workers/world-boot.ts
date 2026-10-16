/** Own startup messages while asynchronous world storage loads, before opening the authority. */
export function bootWorld<Host extends { receive(parcel: unknown): void; dispose(): void }>(
  open: () => Promise<Host>, failed: (error: unknown) => void,
): { receive(parcel: unknown): void; dispose(): void; ready: Promise<void> } {
  let host: Host | undefined, retired = false;
  const waiting: unknown[] = [];
  const fail = (error: unknown) => {
    if (retired) return;
    retired = true; waiting.length = 0;
    try { host?.dispose(); }
    catch (cleanup) { error = new AggregateError([error, cleanup], 'World startup and cleanup failed'); }
    failed(error);
  };
  const ready = Promise.resolve().then(open).then(created => {
    if (retired) { created.dispose(); return; }
    host = created;
    for (const parcel of waiting.splice(0)) {
      if (retired) break;
      host.receive(parcel);
    }
  }).catch(fail);
  return {
    ready,
    receive(parcel) {
      if (retired) return;
      if (host) { host.receive(parcel); return; }
      if (waiting.length >= 128) { fail(new Error('World startup message limit exceeded')); return; }
      waiting.push(parcel);
    },
    dispose() { if (retired) return; retired = true; waiting.length = 0; host?.dispose(); },
  };
}
