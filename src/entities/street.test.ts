import { howManyAreOut } from './street';
import { describe, expect, it } from 'vitest';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { GroundWorld } from '../world/groundworld';
import { Register } from '../world/register';
import { EntityManager } from './manager';
import { Roster } from './roster';
import { propFootprints } from './props';

/**
 * Who is standing in a village street, and which half of the game decided it.
 *
 * The whole of C5 from this side, and it is one line: a manager that is being told what lives in the
 * world spawns nothing at all, and a manager that is not spawns everything it always did. The second
 * half is the one that matters most and is the easiest to lose — a page with nothing behind it has to
 * play exactly as it did before any of this, and the way that breaks is silently, with an empty
 * village nobody notices until they walk into one.
 */

/** A world with a village in it, and the country round that village grown. */
function villageAt(seed: number) {
  const sampler = new TerrainSampler(generateWebGraph(seed));
  const ground = new GroundWorld(sampler, propFootprints());
  const village = sampler.structures.villages[0];
  ground.reach(village.x, village.z, 3);
  const register = new Register(seed, 1);
  const manager = new EntityManager(
    new Roster(), ground, ground, seed, sampler.structures.villages, undefined, undefined, register,
  );
  return { manager, register, village };
}

/** Noon, and long enough for the chunks round the square to have been walked over. */
function stand(manager: EntityManager, at: { x: number; z: number }): void {
  for (let n = 0; n < 20; n++) manager.update(0.05, at.x, at.z, false, () => {}, 0.5);
}

describe('who a village puts in its street', () => {
  it('fills it from the register when this page is the world', () => {
    const { manager, register, village } = villageAt(3);
    stand(manager, village);

    const out = manager.within(village.x, village.z, 40).filter((e) => e.person !== '');
    expect(out.length, 'a village with nobody in its square').toBeGreaterThan(0);
    for (const one of out) {
      expect(register.find(one.person), 'somebody is standing there who is not on the register').toBeDefined();
      expect(one.herd.tag, 'and he does not know which village he is in').toBe(village.name);
    }
  });

  it('puts nobody out at all when somebody else is holding the world', () => {
    const { manager, village } = villageAt(3);
    manager.toldWhatLives = true;
    stand(manager, village);

    expect(manager.within(village.x, village.z, 60), 'a page that is being told what lives here invented some of its own, and every one of them is a second villager nobody else can see')
      .toEqual([]);
  });

  it('fills it again from the seed when the world stops talking', () => {
    const { manager, village } = villageAt(3);
    // a world speaks: everything this page invented is handed back and it stops inventing
    manager.toldWhatLives = true;
    manager.forgetWhatWeInvented();
    stand(manager, village);
    expect(manager.within(village.x, village.z, 60), 'the world is holding this country').toEqual([]);

    // and then it goes quiet, which is the same act in the other direction
    manager.toldWhatLives = false;
    manager.forgetWhatWeInvented();
    stand(manager, village);
    expect(manager.within(village.x, village.z, 40).filter((e) => e.person !== '').length,
      'a world that went quiet handed back a countryside with nobody in it — the squares were emptied rather than forgotten, so this page believes it has already populated them')
      .toBeGreaterThan(0);
  });

  it('leaves out anybody who has been paid to walk with somebody', () => {
    const { manager, register, village } = villageAt(3);
    // whoever the street would have shown first, taken off it before it is filled
    stand(manager, village);
    const first = manager.within(village.x, village.z, 40).find((e) => e.person !== '')!;
    const hired = first.person;
    expect(register.find(hired)).toBeDefined();

    const fresh = villageAt(3);
    fresh.manager.spokenFor = new Set([hired]);
    stand(fresh.manager, fresh.village);
    expect(fresh.manager.within(fresh.village.x, fresh.village.z, 40).some((e) => e.person === hired),
      'a man in somebody else\'s pay was put back in his own village square')
      .toBe(false);
  });
});

/**
 * How many of a village's people are out at once.
 *
 * It used to be two to four whatever the village, so a hamlet of two houses and a town of fifteen
 * put the same crowd on the square. Reported from the small end: "there are sometimes 20 villagers
 * walking around, but the town has two houses".
 */
describe('the crowd on a village square', () => {
  it('grows with what the village has built', () => {
    const at = (houses: number) => howManyAreOut(houses, 0.5);
    expect(at(2)).toBeLessThan(at(6));
    expect(at(6)).toBeLessThan(at(14));
  });

  it('is never nobody, and never a market day', () => {
    for (const houses of [0, 1, 2, 5, 9, 20, 400]) {
      for (const roll of [0, 0.25, 0.5, 0.99]) {
        const out = howManyAreOut(houses, roll);
        expect(out, `${houses} houses is a ghost town`).toBeGreaterThanOrEqual(1);
        expect(out, `${houses} houses is a crowd`).toBeLessThanOrEqual(7);
        expect(Number.isInteger(out), 'half a villager').toBe(true);
      }
    }
  });

  it('settles the fraction with the roll rather than rounding it away', () => {
    // three houses is one or two out depending on the hour, which is what a village looks like
    const shy = howManyAreOut(3, 0.9), busy = howManyAreOut(3, 0.1);
    expect(busy).toBe(shy + 1);
  });
});
