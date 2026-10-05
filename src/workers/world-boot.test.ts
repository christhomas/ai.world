import { describe, expect, it, vi } from 'vitest';
import { bootWorld } from './world-boot';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('world startup ownership', () => {
  it('delivers join, pause and later messages in order only after storage opens', async () => {
    const host = { receive: vi.fn(), dispose: vi.fn() }, failed = vi.fn();
    const opening = deferred<typeof host>();
    const boot = bootWorld(() => opening.promise, failed);
    boot.receive('join'); boot.receive('pause'); expect(host.receive).not.toHaveBeenCalled();
    opening.resolve(host); await boot.ready; boot.receive('resume');
    expect(host.receive.mock.calls).toEqual([['join'], ['pause'], ['resume']]);
    expect(failed).not.toHaveBeenCalled();
  });

  it('retirement discards startup messages and disposes the late authority once', async () => {
    const host = { receive: vi.fn(), dispose: vi.fn() }, opening = deferred<typeof host>(), failed = vi.fn();
    const boot = bootWorld(() => opening.promise, failed);
    boot.receive('join'); boot.dispose(); boot.dispose(); boot.receive('late');
    opening.resolve(host); await boot.ready;
    expect(host.receive).not.toHaveBeenCalled(); expect(host.dispose).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('a storage rejection reports failure once and retires future input', async () => {
    const error = new Error('database blocked'), failed = vi.fn();
    const boot = bootWorld(async () => { throw error; }, failed);
    boot.receive('join'); await boot.ready; boot.receive('late'); boot.dispose();
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('bounds startup messages and closes a subsequently opened authority', async () => {
    const host = { receive: vi.fn(), dispose: vi.fn() }, opening = deferred<typeof host>(), failed = vi.fn();
    const boot = bootWorld(() => opening.promise, failed);
    for (let i = 0; i < 129; i++) boot.receive(i);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(String(failed.mock.calls[0][0])).toContain('limit');
    opening.resolve(host); await boot.ready;
    expect(host.receive).not.toHaveBeenCalled(); expect(host.dispose).toHaveBeenCalledTimes(1);
  });

  it('reports buffered-message and cleanup failures together', async () => {
    const error = new Error('bad join'), cleanup = new Error('could not close');
    const host = { receive: () => { throw error; }, dispose: () => { throw cleanup; } }, failed = vi.fn();
    const boot = bootWorld(async () => host, failed); boot.receive('join'); await boot.ready;
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toMatchObject({ errors: [error, cleanup] });
  });
});
