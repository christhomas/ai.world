import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { canStand } from './walking';
import { whatCarriesHim } from './walking';
import type { TileWorld } from './entity';

/**
 * A horse is not a boat.
 *
 * A hero paddles — that is what made deep water stop being a wall for him on the 12th — and the
 * check that decides where he may step reads *his* kind. Mounting moves the horse under him and
 * changes nothing about that, so a rider could put a horse out to sea and the horse would swim,
 * being a thing that does not swim. `beasts.json` says `paddles: false` for a horse in as many
 * words, and nothing ever asked it.
 *
 * The rule is the plain one: what you may cross is decided by whatever is carrying you. A man on
 * foot swims; a man on a horse goes where a horse goes, which is up to its chest and no further.
 */
describe('what carries the hero decides where he may go', () => {
  // a beach: dry land up to x = 10, and past it nothing to stand on and water over the top
  const sea = {
    heightAt: (x: number) => (x > 10 ? null : 0),
    waterAt: (x: number) => (x > 10 ? 0.2 : null),
    blocked: () => false,
    isRoad: () => true,
  } as unknown as TileWorld;

  const hero = KINDS.hero;
  const horse = KINDS.horse;

  it('lets a man on foot swim, which is item 58', () => {
    expect(canStand(sea, hero, 20, 0)).toBe(true);
  });

  it('will not let a horse swim, because a horse does not', () => {
    expect(canStand(sea, horse, 20, 0)).toBe(false);
  });

  it('carries the hero on his own legs when he is not riding', () => {
    expect(whatCarriesHim(hero, null).id).toBe(hero.id);
  });

  it('carries him on the horse when he is, so the sea is the horse\'s wall', () => {
    const carrying = whatCarriesHim(hero, horse);
    expect(carrying.paddles).toBe(false);
    expect(canStand(sea, carrying, 20, 0), 'he rode into the sea').toBe(false);
  });

  it('still lets a rider into the shallows, which a horse can walk through', () => {
    expect(canStand(sea, whatCarriesHim(hero, horse), 5, 0)).toBe(true);
  });
});
