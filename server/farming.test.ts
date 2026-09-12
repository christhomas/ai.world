import { describe, expect, it } from 'vitest';
import { cropLifted, seedSown, type Field, type Ground } from './farming';
import { CROPS } from '../src/game/farming';
import type { ServerMessage, WorldDelta } from './protocol';

/**
 * The world's half of a field, on its own.
 *
 * Driven directly rather than through a whole simulation, because what is being tested is a rule
 * about four numbers and a clock — and a test that stands a world up to ask it costs a hundred
 * times as much to find out the same thing. `sim.test.ts` proves the wiring; this proves the rule.
 */
function field(over: Partial<Field & Ground> = {}) {
  const said: ServerMessage[] = [];
  const told: WorldDelta[] = [];
  const log = new Map<string, WorldDelta>();
  const o = {
    sown: null,
    day: 2,
    hero: { x: 12.4, z: 44.9 },
    plantable: () => true,
    apply: (delta: WorldDelta) => {
      const key = `${delta.kind === 'reap' ? 'sow' : delta.kind}:${'tile' in delta ? delta.tile : ''}`;
      if (delta.kind === 'reap') return log.delete(key);
      if (log.has(key)) return false;
      log.set(key, delta);
      return true;
    },
    broadcast: (delta: WorldDelta) => { told.push(delta); },
    send: (message: ServerMessage) => { said.push(message); },
    ...over,
  } as Field & Ground;
  return { o, said, told, log };
}

const ripeWheat: Extract<WorldDelta, { kind: 'sow' }> = { kind: 'sow', tile: '12,44', crop: 'wheat', day: 1 };

describe('the world decides whether a crop was there to lift', () => {
  it('hands over what a crop yields, once', () => {
    const { o, said, told, log } = field({ sown: ripeWheat, day: 40 });
    log.set('sow:12,44', ripeWheat);
    cropLifted(o, { type: 'harvest', seq: 1, tile: '12,44' });
    expect(said[0]).toMatchObject({ type: 'harvested', ok: true, crop: 'wheat', amount: CROPS.wheat.yield });
    expect(told).toEqual([{ kind: 'reap', tile: '12,44' }]);
  });

  it('refuses a crop that is not ripe, by its own day and not the asker’s', () => {
    const { o, said } = field({ sown: ripeWheat, day: 2 });
    cropLifted(o, { type: 'harvest', seq: 1, tile: '12,44' });
    expect(said[0]).toMatchObject({ ok: false, amount: 0 });
  });

  it('refuses bare ground, and a field the hero is not standing in', () => {
    const bare = field({ sown: null, day: 40 });
    cropLifted(bare.o, { type: 'harvest', seq: 1, tile: '12,44' });
    expect(bare.said[0]).toMatchObject({ ok: false });

    const away = field({ sown: ripeWheat, day: 40, hero: { x: 80.5, z: 80.5 } });
    cropLifted(away.o, { type: 'harvest', seq: 1, tile: '12,44' });
    expect(away.said[0]).toMatchObject({ ok: false });
  });

  it('refuses a crop the world has never heard of', () => {
    const { o, said } = field({ sown: { ...ripeWheat, crop: 'moondust' }, day: 40 });
    cropLifted(o, { type: 'harvest', seq: 1, tile: '12,44' });
    expect(said[0]).toMatchObject({ ok: false });
  });
});

describe('the world decides whether a seed will take', () => {
  const sowing = { type: 'sow', seq: 1, tile: '12,44', crop: 'wheat' } as const;

  it('takes a seed in its season, on ground that will grow it', () => {
    const { o, said, told } = field({ day: 2 });                 // day 2 is spring
    seedSown(o, sowing);
    expect(said[0]).toMatchObject({ type: 'sown', ok: true, tile: '12,44' });
    expect(told).toEqual([{ kind: 'sow', tile: '12,44', crop: 'wheat', day: 2 }]);
  });

  it('refuses it out of season, by the world’s day', () => {
    // day 24 is winter; a page wound forward to spring cannot make winter into spring for everybody
    const { o, said, told } = field({ day: 24 });
    seedSown(o, sowing);
    expect(said[0]).toMatchObject({ ok: false });
    expect(told).toEqual([]);
  });

  it('refuses ground nothing will grow on', () => {
    const { o, said } = field({ day: 2, plantable: () => false });
    seedSown(o, sowing);
    expect(said[0]).toMatchObject({ ok: false });
  });

  it('refuses a tile somebody is already growing something on', () => {
    const { o, said } = field({ day: 2, sown: ripeWheat });
    seedSown(o, sowing);
    expect(said[0]).toMatchObject({ ok: false });
  });

  it('refuses a tile the hero is not standing on, and a seed that is not a crop', () => {
    const away = field({ day: 2, hero: { x: 80.5, z: 80.5 } });
    seedSown(away.o, sowing);
    expect(away.said[0]).toMatchObject({ ok: false });

    const nonsense = field({ day: 2 });
    seedSown(nonsense.o, { ...sowing, crop: 'moondust' });
    expect(nonsense.said[0]).toMatchObject({ ok: false });
  });
});
