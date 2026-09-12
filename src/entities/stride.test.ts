import { describe, expect, it } from 'vitest';
import type { TileWorld } from './entity';
import { FASTEST, LONGEST_STEP, SWIM, newHero, settleOnto, stride } from './stride';
import { Entity, Herd } from './entity';
import { KINDS } from './animals';
import { mulberry32 } from '../core/rng';

/**
 * One step of a hero, which two halves of the game take in step with each other.
 *
 * Everything here is about a client and a world agreeing. The client walks the hero the moment a
 * key goes down and the world walks him again when the message arrives, and if the two arithmetics
 * differ by so much as a mount the hero is hauled backwards at every answer. So the gate is here,
 * once, and these are the things a client could say that it must not be able to profit from.
 */

/** Flat, open ground. */
const field: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const walkedBy = (steer: { dx: number; dz: number; pace: number; dt: number }): number => {
  const hero = newHero(0, 0);
  stride(field, hero, steer);
  return Math.hypot(hero.x, hero.z);
};

describe('one step of a hero', () => {
  it('walks a pace of one at the hero\'s own running speed', () => {
    const hero = newHero(0, 0);
    stride(field, hero, { dx: 1, dz: 0, pace: 1, dt: LONGEST_STEP });
    expect(hero.x).toBeCloseTo(hero.kind.speed * LONGEST_STEP, 5);
  });

  it('carries the mount in the pace, so a horse is quicker than a walk', () => {
    expect(walkedBy({ dx: 1, dz: 0, pace: 2.6, dt: 0.5 }))
      .toBeCloseTo(walkedBy({ dx: 1, dz: 0, pace: 1, dt: 0.5 }) * 2.6, 5);
  });

  it('goes no faster for a longer vector than for a shorter one', () => {
    expect(walkedBy({ dx: 100, dz: 0, pace: 1, dt: 0.2 }))
      .toBeCloseTo(walkedBy({ dx: 0.01, dz: 0, pace: 1, dt: 0.2 }), 5);
  });

  it('goes no faster than the quickest thing in the game, whatever it is asked for', () => {
    expect(walkedBy({ dx: 1, dz: 0, pace: 1e6, dt: 0.2 }))
      .toBeCloseTo(walkedBy({ dx: 1, dz: 0, pace: FASTEST, dt: 0.2 }), 5);
  });

  it('takes no step longer than a slow frame, whatever it is told about the time', () => {
    expect(walkedBy({ dx: 1, dz: 0, pace: 1, dt: 100 }))
      .toBeCloseTo(walkedBy({ dx: 1, dz: 0, pace: 1, dt: LONGEST_STEP }), 5);
  });

  it('stands still for a steer that says nothing', () => {
    expect(walkedBy({ dx: 0, dz: 0, pace: 1, dt: 0.2 })).toBe(0);
    expect(walkedBy({ dx: 1, dz: 0, pace: 0, dt: 0.2 })).toBe(0);
    expect(walkedBy({ dx: 1, dz: 0, pace: 1, dt: 0 })).toBe(0);
    expect(walkedBy({ dx: 1, dz: 0, pace: -5, dt: 0.2 })).toBe(0);
  });
});

/**
 * Deep water: no bottom within reach, and a surface to float on.
 *
 * The shore is at x < 0, so a hero at the origin is afloat and one step west is standing again.
 */
const sea: TileWorld = {
  heightAt: (x) => (x < 0 ? 0.2 : null),
  waterAt: (x) => (x < 0 ? null : 0.3),
  blocked: () => false,
  isRoad: () => false,
};

describe('a hero out of his depth', () => {
  it('swims where he used to be stopped', () => {
    const hero = newHero(4, 0);
    hero.y = 0.3;
    const moved = stride(sea, hero, { dx: 1, dz: 0, pace: 1, dt: LONGEST_STEP });
    expect(moved, 'deep water is still a wall').toBe(true);
    expect(hero.x).toBeGreaterThan(4);
  });

  it('swims slower than he walks, by enough to feel', () => {
    const swimmer = newHero(4, 0);
    stride(sea, swimmer, { dx: 1, dz: 0, pace: 1, dt: LONGEST_STEP });
    const walker = newHero(4, 0);
    stride(field, walker, { dx: 1, dz: 0, pace: 1, dt: LONGEST_STEP });
    expect(swimmer.x - 4).toBeCloseTo((walker.x - 4) * SWIM, 5);
  });

  it('floats at the surface rather than at the bottom', () => {
    const hero = newHero(4, 0);
    hero.y = 99;
    settleOnto(sea, hero);
    expect(hero.y).toBe(0.3);
  });

  it('can always climb back onto the shore', () => {
    const hero = newHero(0.2, 0);
    hero.y = 0.3;
    stride(sea, hero, { dx: -1, dz: 0, pace: 1, dt: LONGEST_STEP });
    expect(hero.x, 'the shore was a wall from the water side').toBeLessThan(0);
    settleOnto(sea, hero);
    expect(hero.y, 'he climbed out and stayed at sea level').toBe(0.2);
  });

  it('is a thing about the hero, not about everything that walks', () => {
    // a cow does not swim to the island. `paddles` is the hero's alone, and `canStand` is the gate
    const cow = new Entity(KINDS.cow, 4, 0, new Herd(KINDS.cow, 4, 0, 4, 0, 0), '', mulberry32(1));
    const moved = stride(sea, cow, { dx: 1, dz: 0, pace: 1, dt: LONGEST_STEP });
    expect(moved, 'a cow walked out to sea').toBe(false);
  });
});
