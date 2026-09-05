import { describe, expect, it } from 'vitest';
import { EYRIE, SKYWARD, eyrieAt, packWeight, planEyries, tooDear, tooHeavy } from './eyries';
import type { Massif } from '../world/mountains';

const range = (x: number, z: number, radius: number): Massif => ({ x, z, radius, height: 80, hollow: 0 });
const anywhere = (): boolean => true;

/**
 * A mountain is a wall, and a wall you can only ever walk round is one you come to resent. The
 * eagle is the other way over — so what matters is that there is always a bird on both sides, that
 * it puts you down across the range rather than anywhere convenient, and that it costs enough to
 * be a decision.
 */
describe('the crags with eagles on them', () => {
  it('puts a bird on each side of a range', () => {
    const [a, b] = planEyries(1, [range(0, 0, 60)], anywhere);
    expect(a.partner).toBe(b.id);
    expect(b.partner).toBe(a.id);
  });

  it('stands them on opposite flanks, so a flight crosses the mountain', () => {
    const [a, b] = planEyries(1, [range(0, 0, 60)], anywhere);
    const apart = Math.hypot(a.x - b.x, a.z - b.z);
    // right across it, not two perches on the same shoulder
    expect(apart).toBeGreaterThan(60 * 1.5);
  });

  it('leaves the bird off a hill nobody would mind walking round', () => {
    expect(planEyries(1, [range(0, 0, EYRIE.WORTH_FLYING - 1)], anywhere)).toEqual([]);
  });

  it('will not perch where somebody could not stand', () => {
    // only the eastern half of the world has footing, so both perches must find it or there is none
    const eastOnly = (x: number): boolean => x > 0;
    for (const eyrie of planEyries(1, [range(0, 0, 60)], eastOnly)) {
      expect(eastOnly(eyrie.x), `perch at ${eyrie.x}`).toBe(true);
    }
  });

  it('gives up rather than dropping somebody in the sea', () => {
    expect(planEyries(1, [range(0, 0, 60)], () => false)).toEqual([]);
  });

  it('asks more to cross a wider range', () => {
    const small = planEyries(1, [range(0, 0, 40)], anywhere)[0];
    const big = planEyries(1, [range(0, 0, 90)], anywhere)[0];
    expect(big.fare).toBeGreaterThan(small.fare);
  });

  it('is the same world every time it is asked', () => {
    const once = planEyries(7, [range(10, -20, 70)], anywhere);
    const twice = planEyries(7, [range(10, -20, 70)], anywhere);
    expect(twice).toEqual(once);
  });

  it('names every crag something of its own', () => {
    const all = planEyries(1, [range(0, 0, 60), range(400, 0, 60), range(-400, 0, 60)], anywhere);
    expect(new Set(all.map((e) => e.name)).size).toBe(all.length);
  });
});

describe('being spoken to by a bird', () => {
  const eyries = planEyries(1, [range(0, 0, 60)], anywhere);

  it('notices you only when you are on the crag', () => {
    const perch = eyries[0];
    expect(eyrieAt(eyries, perch.x, perch.z)?.id).toBe(perch.id);
    expect(eyrieAt(eyries, perch.x + EYRIE.REACH + 1, perch.z)).toBeNull();
  });

  it('says what it wants and what you have when you cannot pay', () => {
    const said = tooDear(eyries[0], 3);
    expect(said).toContain(String(eyries[0].fare));
    expect(said).toContain('3');
  });
});

/**
 * The flight up to a village in the clouds, which is the same bird with a different job.
 *
 * Everything worth testing here is about the asymmetry. Going up can be refused — for the fare and
 * for the load — and the refusal has to say which. Coming back down is not modelled at all,
 * because it costs nothing and is answered for by the island itself: see `game/skies.ts`.
 */
describe('the flight into the clouds', () => {
  it('weighs a pack by what is in it, and a loaf is a loaf', () => {
    expect(packWeight([['apple', 3], ['sword', 1]])).toBe(4);
    expect(packWeight([['wood', 2]])).toBe(SKYWARD.HEAVY.wood * 2);
  });

  it('carries an ordinary traveller without comment', () => {
    expect(tooHeavy([['apple', 4], ['bread', 2], ['sword', 1], ['rope', 1], ['potion', 3]])).toBeNull();
  });

  it('will not lift a timber run, and says which part of it is the trouble', () => {
    const load = tooHeavy([['wood', 9], ['apple', 1]]);
    expect(load).not.toBeNull();
    expect(load!.worst).toBe('wood');
    expect(load!.weight).toBeGreaterThan(SKYWARD.LIFT);
  });

  it('will not lift a cart at all, whatever else is in the pack', () => {
    expect(tooHeavy([['cart', 1]])!.worst).toBe('cart');
  });

  it('charges the same wherever the fall is, because the height is the same', () => {
    expect(SKYWARD.FARE).toBeGreaterThan(EYRIE.FARE_BASE);
  });
});
