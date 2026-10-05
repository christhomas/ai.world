import { describe, expect, it, vi } from 'vitest';
import { createCountryGrower, type CountryGrowthJob } from './country-jobs';
import type { CountryReply, CountryRequest } from './countrymessages';
import { boundsOf, Patchwork } from './patchwork';
import { growPatch } from './growworld';
import { partsOf } from './endless';
import type { TerrainSampler } from './terrain';

function harness() {
  const patches = new Patchwork(11, () => ({} as TerrainSampler));
  const sent: CountryRequest[] = [];
  let receive: (reply: CountryReply) => void = () => {};
  let fail = () => {};
  const detach = vi.fn();
  const job: CountryGrowthJob = {
    send: vi.fn((request) => { sent.push(request); }),
    listen: (reply, failed) => { receive = reply; fail = failed; return detach; },
    stop: vi.fn(),
  };
  const grower = createCountryGrower(11, patches, job);
  return { patches, sent, job, grower, detach, receive: (reply: CountryReply) => receive(reply), fail: () => fail() };
}

const emptyReply = (patch: string): CountryReply => ({ type: 'grown', patch, took: 1, parts: {} as never });

describe('owned country growth jobs', () => {
  it('fences queued requests and saved host callbacks before releasing the worker', () => {
    const h = harness();
    h.grower.want('0,0'); h.grower.want('1,0');
    h.job.stop = vi.fn(() => h.receive(emptyReply('0,0')));
    h.grower.dispose(); h.grower.dispose();
    h.receive(emptyReply('0,0')); h.fail(); h.grower.want('2,0');
    expect(h.sent).toHaveLength(1);
    expect(h.grower.waiting).toEqual([]);
    expect(h.patches.holding()).toEqual([]);
    expect(h.grower.grown).toBe(0);
    expect(h.detach).toHaveBeenCalledTimes(1);
    expect(h.job.stop).toHaveBeenCalledTimes(1);
  });

  it('accepts only the current job reply and rebuilds real shared patch parts', () => {
    const h = harness();
    h.grower.want('0,0'); h.grower.want('1,0');
    h.receive(emptyReply('1,0'));
    expect(h.sent).toHaveLength(1);
    expect(h.grower.grown).toBe(0);
    const original = growPatch(11, boundsOf('0,0'));
    const reply: CountryReply = { type: 'grown', patch: '0,0', took: 17, parts: partsOf(original) };
    h.receive(reply); h.receive(reply);
    expect(h.sent).toHaveLength(2);
    expect(h.grower.grown).toBe(1);
    expect(h.grower.lastTook).toBe(17);
    expect(h.grower.waiting).toEqual(['1,0']);
    const rebuilt = h.patches.patch('0,0');
    for (const [x, z] of [[0, 0], [100, 120], [400, 300]]) {
      const before = original.newSample(), after = rebuilt.newSample();
      original.sampleTile(x, z, before); rebuilt.sampleTile(x, z, after);
      expect(after).toEqual(before);
    }
    h.grower.dispose();
  }, 30000);

  it('retires a failed sender and leaves synchronous underfoot growth available', () => {
    const h = harness();
    h.job.send = () => { throw new Error('Platform job unavailable'); };
    expect(() => h.grower.want('0,0')).not.toThrow();
    expect(h.grower.waiting).toEqual([]);
    expect(h.patches.patch('0,0')).toBeDefined();
    expect(h.job.stop).toHaveBeenCalledTimes(1);
    h.receive(emptyReply('0,0'));
    expect(h.grower.grown).toBe(0);
  });

  it('stops the worker even if detaching listeners fails', () => {
    const h = harness();
    h.detach.mockImplementation(() => { throw new Error('Detach failed'); });
    expect(() => h.grower.dispose()).toThrow('Country growth job cleanup failed');
    expect(h.job.stop).toHaveBeenCalledTimes(1);
    expect(() => h.grower.dispose()).not.toThrow();
  });

  it('handles failure reported synchronously while subscribing', () => {
    const stop = vi.fn(), detach = vi.fn();
    const grower = createCountryGrower(11, new Patchwork(11), {
      send: () => { throw new Error('Retired job was called'); },
      listen: (_reply, failed) => { failed(); return detach; }, stop,
    });
    grower.want('0,0'); grower.dispose();
    expect(grower.waiting).toEqual([]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('releases a job whose listener cannot be installed', () => {
    const stop = vi.fn();
    expect(() => createCountryGrower(11, new Patchwork(11), {
      send: () => {}, listen: () => { throw new Error('Subscription failed'); }, stop,
    })).toThrow('Subscription failed');
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
