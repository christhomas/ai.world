import { afterEach, describe, expect, it, vi } from 'vitest';
import { workerLink } from './link';

class HostWorker {
  static last: HostWorker;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  constructor() { HostWorker.last = this; }
}

function open() {
  vi.stubGlobal('Worker', HostWorker); vi.stubGlobal('window', {});
  const events = { onOpen: vi.fn(), onClose: vi.fn(), onMessage: vi.fn(), onStorageFailure: vi.fn() };
  const link = workerLink(events);
  return { link, events, worker: HostWorker.last };
}

describe('browser world checkpoint delivery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fences a queued open callback when its owner already terminated the worker', async () => {
    const { link, events, worker } = open(); link.close(); await Promise.resolve();
    expect(link.ready).toBe(false); expect(events.onOpen).not.toHaveBeenCalled();
    worker.onmessage?.({ data: '{}' }); expect(events.onMessage).not.toHaveBeenCalled();
  });

  it('waits for the matching worker reply and keeps control messages out of the game protocol', async () => {
    const { link, events, worker } = open(); await Promise.resolve();
    const waiting = link.flush!(); expect(worker.postMessage).toHaveBeenCalledWith('world-flush:1');
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.onmessage?.({ data: 'world-flushed:1' }); await waiting;
    expect(events.onMessage).not.toHaveBeenCalled();
    link.close(); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects an unacknowledged save on storage failure and worker error', async () => {
    for (const storage of [true, false]) {
      const { link, events, worker } = open(); await Promise.resolve();
      const waiting = link.flush!(), failed = expect(waiting).rejects.toThrow('closed');
      if (storage) worker.onmessage?.({ data: 'world-storage-failed' }); else worker.onerror?.();
      await failed; expect(link.ready).toBe(false); expect(events.onClose).toHaveBeenCalledTimes(1);
      worker.onmessage?.({ data: 'world-flushed:1' }); expect(events.onMessage).not.toHaveBeenCalled();
      link.close();
    }
  });

  it('keeps the authority owned after a recoverable storage warning and checkpoint failure', async () => {
    const { link, events, worker } = open(); await Promise.resolve();
    const waiting = link.flush!(), failed = expect(waiting).rejects.toThrow('World storage');
    worker.onmessage?.({ data: 'world-storage-warning' });
    worker.onmessage?.({ data: 'world-flush-failed:1' }); await failed;
    expect(link.ready).toBe(true); expect(worker.terminate).not.toHaveBeenCalled();
    expect(events.onClose).not.toHaveBeenCalled(); expect(events.onStorageFailure).toHaveBeenCalledTimes(1);
    expect(events.onMessage).not.toHaveBeenCalled();
    const retry = link.flush!(); worker.onmessage?.({ data: 'world-flushed:2' }); await retry; link.close();
  });
});
