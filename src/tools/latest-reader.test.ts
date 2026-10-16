import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatestWorldReader, type WorldReaderWorker } from './latest-reader';

class WorkerDouble implements WorldReaderWorker {
  onmessage: WorldReaderWorker['onmessage'] = null;
  onerror: WorldReaderWorker['onerror'] = null;
  posted: Array<{ id: number; action: string; key?: string }> = [];
  terminated = false;
  postMessage(value: unknown): void { this.posted.push(value as typeof this.posted[number]); }
  terminate(): void { this.terminated = true; }
  answer(value: unknown): void { this.onmessage?.({ data: { id: this.posted[0].id, value } } as MessageEvent); }
}

describe('latest browser world read', () => {
  afterEach(() => vi.useRealTimers());
  const setup = () => {
    const workers: WorkerDouble[] = [];
    const reader = new LatestWorldReader(() => { const worker = new WorkerDouble(); workers.push(worker); return worker; });
    return { reader, workers };
  };

  it('cancels stale growth and lets a new world load without a manual retry', async () => {
    const { reader, workers } = setup();
    const old = reader.request('survey', { key: 'browser:3' });
    const rejected = expect(old).rejects.toThrow('superseded');
    const newest = reader.request('survey', { key: 'browser:7' });
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].posted[0].key).toBe('browser:7');
    workers[0].answer({ seed: 3 });
    workers[0].onerror?.({ type: 'error' } as ErrorEvent);
    expect(workers[1].terminated).toBe(false);
    workers[1].answer({ seed: 7 });
    await expect(newest).resolves.toEqual({ seed: 7 });
    expect(() => workers[1].answer({ seed: 7 })).not.toThrow();
    await rejected;
    reader.close();
  });

  it('shares an identical live poll so repeated polls cannot starve a slow survey', async () => {
    const { reader, workers } = setup();
    const first = reader.request('survey', { key: 'browser:3' });
    const poll = reader.request('survey', { key: 'browser:3' });
    expect(poll).toBe(first);
    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(1);
    workers[0].answer({ day: 2 });
    await expect(poll).resolves.toEqual({ day: 2 });
    reader.close();
  });

  it('terminates a timed-out worker and permits a fresh retry', async () => {
    vi.useFakeTimers();
    const { reader, workers } = setup();
    const timedOut = reader.request('preview', { key: 'browser:3', x: 0, z: 0 });
    const rejected = expect(timedOut).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(workers[0].terminated).toBe(true);
    const retry = reader.request('preview', { key: 'browser:3', x: 0, z: 0 });
    workers[1].answer({ pixels: [] });
    await expect(retry).resolves.toEqual({ pixels: [] });
    reader.close();
  });
});
