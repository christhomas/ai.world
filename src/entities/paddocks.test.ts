import { describe, expect, it } from 'vitest';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { GroundWorld } from '../world/groundworld';
import { Register } from '../world/register';
import { EntityManager } from './manager';
import { Roster } from './roster';
import { propFootprints } from './props';
import { postsOf } from './villagers';
import { CATTLE } from './paddocks';

/**
 * The cattle a village keeps, standing where the books say it keeps them.
 *
 * `livelihoods.ts` has a herd that calves, feeds the place and pays the farmers for the meat the
 * next valley buys — and for as long as none of it was drawn, it was the mines all over again: a
 * beautifully modelled thing you could walk out to and find grass. So the question here is not
 * whether the arithmetic is right, which is that file's own business, but whether a player standing
 * in the field sees what the register says is in it.
 */

/** A world with a village in it, and the country round that village grown. */
function villageAt(seed: number, on = 1) {
  const sampler = new TerrainSampler(generateWebGraph(seed));
  const ground = new GroundWorld(sampler, propFootprints());
  const village = sampler.structures.villages[0];
  ground.reach(village.x, village.z, 3);
  const register = new Register(seed, on);
  const manager = new EntityManager(
    new Roster(), ground, ground, seed, sampler.structures.villages, undefined, undefined, register,
  );
  return { manager, register, village, ground };
}

/**
 * This village's cattle, near a spot — which is not the same as the cows near a spot.
 *
 * A village's own herd is the one wearing the village's name, which is also what makes killing one
 * of them rustling rather than hunting.
 */
const cattleOf = (manager: EntityManager, village: string, at: [number, number], within: number) =>
  manager.within(at[0], at[1], within).filter((e) => e.kind.id === 'cow' && e.herd.tag === village);

/** Long enough for the chunks round the square to have been walked over. */
function stand(manager: EntityManager, at: { x: number; z: number }): void {
  for (let n = 0; n < 20; n++) manager.update(0.05, at.x, at.z, false, () => {}, 0.5);
}

describe('a village\'s cattle', () => {
  it('are standing in the field its own farmers walk to', () => {
    const { manager, register, village, ground } = villageAt(3);
    register.settle(village.name, village.houses.length, ['farmer', 'seller', 'soldier']);
    stand(manager, village);

    const field = postsOf(village, ground).field;
    expect(field, 'this village has no field, so there is nothing to test').toBeDefined();
    const cows = cattleOf(manager, village.name, field!, CATTLE.LEASH + CATTLE.SPREAD);
    expect(cows.length, 'the books say the village keeps cattle and the field is empty').toBeGreaterThan(0);
  });

  it('are as many as the register says, up to what a field will carry', () => {
    const { manager, register, village, ground } = villageAt(3);
    register.settle(village.name, village.houses.length, ['farmer', 'seller', 'soldier']);
    stand(manager, village);

    const field = postsOf(village, ground).field!;
    const cows = cattleOf(manager, village.name, field, CATTLE.LEASH + CATTLE.SPREAD).length;
    const books = Math.min(CATTLE.MOST_SHOWN, Math.round(register.herdOf(village.name)));
    // fewer is allowed and means the ground refused somebody a place to stand; more never is,
    // because more is a village with cattle it has not got
    expect(cows).toBeLessThanOrEqual(books);
    expect(cows).toBeGreaterThan(books - 3);
  });

  it('are not there at all in a village that keeps none', () => {
    /*
     * The register is what says a village has cattle, and a village with nobody to work them has
     * none. Asked of a fishing hamlet — settled with trades that do not include a farmer — rather
     * than of a village nobody has visited, because visiting one is what settles it: the register
     * relives a place from its founding the first time anybody walks in, so there is no such thing
     * as standing in a village it knows nothing about.
     *
     * The tag is what the assertion turns on. The plains are livestock country and the world
     * scatters cows across them on its own; six of them stood in this field before a single cow
     * belonged to anybody.
     */
    const { manager, register, village, ground } = villageAt(3);
    register.settle(village.name, village.houses.length, ['sailor', 'seller', 'soldier']);
    stand(manager, village);
    const field = postsOf(village, ground).field!;
    expect(register.herdOf(village.name)).toBe(0);
    expect(cattleOf(manager, village.name, field, CATTLE.LEASH)).toEqual([]);
  });

  it('are gone from the field once the last farmer is', () => {
    const { manager, register, village, ground } = villageAt(3);
    register.settle(village.name, village.houses.length, ['farmer', 'seller', 'soldier']);
    for (const farmer of register.living(village.name).filter((p) => p.trade === 'farmer')) {
      register.bury(farmer.id);
    }
    register.advance(register.today + 2);
    stand(manager, village);

    const field = postsOf(village, ground).field!;
    expect(register.herdOf(village.name)).toBe(0);
    expect(cattleOf(manager, village.name, field, CATTLE.LEASH)).toEqual([]);
  });
});
