import { describe, expect, it, vi } from 'vitest';
import { Manifest } from '../../world/manifest';
import type { Surroundings } from './context';
import { prayerInteractions } from './prayer';

const shrine = { name: 'Shrine of Echoes', x: 100, z: 100 };

function setting(shared = false) {
  const state = { day: 10, prayers: [] as Array<{ id: string; due: number }> };
  const persist = vi.fn();
  const persistAsync = vi.fn(async () => {});
  const ctx = {
    state, manifest: new Manifest(3), structures: { villages: [
      { name: 'Ashford', x: 196, z: 100 },
    ] },
    around: { surveyVillages: (_x: number, _z: number, _reach: number) => [
      { name: 'Ashford', x: 196, z: 100 },
      { name: 'Neighboring patch', x: 290, z: 100 },
    ] },
    sampler: { within: { x0: 0, x1: 512, z0: 0, z1: 512 } },
    online: { connected: true, away: shared },
    hud: { flash: vi.fn() }, sound: { chime: vi.fn() }, persist,
    persistAsync,
  } as unknown as Surroundings;
  return { ctx, state, persist, persistAsync };
}

describe('the shrine prayer conversation', () => {
  it('refuses to change a shared world', () => {
    const { ctx, state, persist } = setting(true);
    const refused = prayerInteractions(ctx).choicesAt(shrine)[0].next();
    expect(refused?.pages.join(' ')).toContain('world of your own');
    expect(state.prayers).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });

  it('names affected villages before a local prayer is saved', () => {
    const { ctx, state, persistAsync } = setting();
    const sites = prayerInteractions(ctx).choicesAt(shrine)[0].next();
    const warning = sites?.choices?.find((choice) => choice.label.includes('east heights'))?.next();
    expect(warning?.pages.join(' ')).toContain('Ashford');
    expect(warning?.pages.join(' ')).toContain('Neighboring patch');
    expect(state.prayers).toEqual([]);
    warning?.choices?.[0].next();
    expect(state.prayers).toMatchObject([{ id: 'highland:prayer:Shrine of Echoes:east', due: 70 }]);
    expect(persistAsync).toHaveBeenCalledOnce();
  });

  it('retries a due answer after persistence fails', async () => {
    const { ctx, state, persistAsync } = setting();
    state.prayers.push({ id: 'highland:prayer:test', due: 10 });
    persistAsync.mockRejectedValue(new Error('storage unavailable'));
    const prayer = prayerInteractions(ctx);
    prayer.tick();
    await Promise.resolve();
    await Promise.resolve();
    prayer.tick();
    expect(persistAsync).toHaveBeenCalledTimes(2);
  });
});
