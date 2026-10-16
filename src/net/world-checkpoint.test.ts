import { describe, expect, it } from 'vitest';
import { checkpointId, WorldCheckpoint, WORLD_FLUSH, WORLD_FLUSHED, WORLD_FLUSH_FAILED } from './world-checkpoint';

function harness() {
  const sent: string[] = [], timers: Array<{ call(): void; cancelled: boolean }> = [];
  const owner = new WorldCheckpoint({ send: parcel => { sent.push(parcel); },
    after: call => { const timer = { call, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
  });
  return { owner, sent, timers };
}

describe('durable world acknowledgement ownership', () => {
  it('shares an outstanding checkpoint and accepts only its exact acknowledgement', async () => {
    const { owner, sent, timers } = harness();
    const first = owner.flush(); expect(owner.flush()).toBe(first);
    expect(sent).toEqual([WORLD_FLUSH + '1']);
    let done = false; void first.then(() => { done = true; });
    expect(owner.receive('{}')).toBe(false);
    owner.receive(WORLD_FLUSHED + '2'); owner.receive(WORLD_FLUSHED + '01');
    await Promise.resolve(); expect(done).toBe(false);
    owner.receive(WORLD_FLUSHED + '1'); await first;
    expect(timers[0].cancelled).toBe(true); expect(done).toBe(true);
    owner.close();
  });

  it('times out without allowing old replies or cancelled callbacks to settle a retry', async () => {
    const { owner, sent, timers } = harness();
    const first = owner.flush(), failed = expect(first).rejects.toThrow('timed out');
    timers[0].call(); await failed;
    const retry = owner.flush(); let done = false; void retry.then(() => { done = true; });
    owner.receive(WORLD_FLUSHED + '1'); timers[0].call();
    await Promise.resolve(); expect(done).toBe(false);
    expect(sent).toEqual([WORLD_FLUSH + '1', WORLD_FLUSH + '2']);
    owner.receive(WORLD_FLUSHED + '2'); await retry; owner.close();
  });

  it('rejects pending saves on retirement and never sends another request', async () => {
    const { owner, sent, timers } = harness();
    const waiting = owner.flush(), failed = expect(waiting).rejects.toThrow('closed');
    owner.close(); owner.close(); await failed;
    owner.receive(WORLD_FLUSHED + '1');
    await expect(owner.flush()).rejects.toThrow('closed');
    expect(sent).toHaveLength(1); expect(timers[0].cancelled).toBe(true);
  });

  it('reports synchronous send failures and permits a fresh explicit retry', async () => {
    let fails = true;
    const owner = new WorldCheckpoint({ send: () => { if (fails) throw new Error('send failed'); }, after: () => () => {} });
    await expect(owner.flush()).rejects.toThrow('send failed');
    fails = false; const retry = owner.flush(); owner.receive(WORLD_FLUSHED + '2'); await retry;
    owner.close();
  });

  it('rejects malformed or unsafe request ids', () => {
    for (const suffix of ['0', '-1', '1.5', '01', '1e2', '', '9007199254740992']) {
      expect(checkpointId(WORLD_FLUSH + suffix, WORLD_FLUSH)).toBeNull();
    }
    expect(checkpointId(WORLD_FLUSH + '17', WORLD_FLUSH)).toBe(17);
    expect(checkpointId(new ArrayBuffer(4), WORLD_FLUSH)).toBeNull();
  });

  it('reports a matched storage failure without retiring the connection or accepting stale failures', async () => {
    const { owner, sent } = harness();
    const first = owner.flush(), failed = expect(first).rejects.toThrow('World storage');
    owner.receive(WORLD_FLUSH_FAILED + '1'); await failed;
    const retry = owner.flush(); owner.receive(WORLD_FLUSH_FAILED + '1');
    expect(sent).toEqual([WORLD_FLUSH + '1', WORLD_FLUSH + '2']);
    owner.receive(WORLD_FLUSHED + '2'); await retry; owner.close();
  });
});
