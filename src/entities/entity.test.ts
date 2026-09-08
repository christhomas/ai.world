import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { treeFor } from './behaviours';
import { BEHAVIOUR, Entity, Herd, STEP_LIMIT, canStand, isDaytime, spaceNear, tryMove, updateEntity, yawFor, type TileWorld } from './entity';

/** Flat 20x20 world at height 1, with a cliff (height 2) for x >= 10 and a tree at (5,5). */
const world: TileWorld = {
  heightAt: (x, z) => (x < 0 || z < 0 || x >= 20 || z >= 20 ? null : x >= 10 ? 2 : 1),
  waterAt: () => null,
  blocked: (x, z) => Math.floor(x) === 5 && Math.floor(z) === 5,
  isRoad: () => false,
};

describe('entity movement', () => {
  it('respects step limits per kind', () => {
    expect(canStand(world, KINDS.sheep, 9.5, 2, 1)).toBe(true);
    expect(canStand(world, KINDS.sheep, 10.5, 2, 1)).toBe(false);          // 1.0 drop > STEP_LIMIT
    expect(canStand(world, KINDS.hero, 10.5, 2, 1)).toBe(false);           // still a full unit
    expect(canStand(world, KINDS.hero, 10.5, 2, 1.5)).toBe(true);          // one terrace (0.5)
    expect(canStand(world, KINDS.sheep, 5.5, 5.5)).toBe(false);            // tree
    expect(STEP_LIMIT).toBeLessThan(0.5);
  });

  it('tryMove slides along a blocked axis', () => {
    const herd = new Herd(KINDS.sheep, 0, 0, 0, 0, 5);
    const e = new Entity(KINDS.sheep, 9.9, 3, herd, 'k', mulberry32(1));
    e.y = 1;
    expect(tryMove(world, e, 0.5, 0.5)).toBe(true);   // x blocked by cliff, z still moves
    expect(e.x).toBeCloseTo(9.9);
    expect(e.z).toBeCloseTo(3.5);
  });

  /*
   * The fault this was written for: a hero on a courser covers 4.8 tiles in one server step, and a
   * move that only asked about the far end of that walked him through a house and out the other
   * side. It was reported as walking through walls "sometimes", because whether it happened was a
   * question of how long the frame was.
   */
  it('is stopped by a wall thinner than the step it is taking', () => {
    // a wall a fifth of a tile thick — thinner than any single step, thicker than a slice
    const thin: TileWorld = {
      heightAt: () => 1,
      waterAt: () => null,
      blocked: (x) => x >= 5 && x < 5.2,
      isRoad: () => false,
    };
    const herd = new Herd(KINDS.hero, 0, 0, 0, 0, 5);
    const e = new Entity(KINDS.hero, 4, 3, herd, 'k', mulberry32(1));
    e.y = 1;
    tryMove(thin, e, 5, 0);
    expect(e.x, 'walked clean through a wall thinner than one step').toBeLessThan(5);
    expect(e.x, 'stopped short of a wall it should have walked up to').toBeGreaterThan(4.7);
  });

  it('sweeps a long move rather than jumping it', () => {
    const e = new Entity(KINDS.hero, 4.5, 5.5, new Herd(KINDS.hero, 0, 0, 0, 0, 5), 'k', mulberry32(1));
    e.y = 1;
    // straight at the tree on tile (5,5), from a tile away: one jump would land beyond it
    tryMove(world, e, 2, 0);
    expect(e.x, 'stepped over a whole blocked tile').toBeLessThan(5);
  });

  it('yawFor faces +x rigs along the velocity', () => {
    expect(yawFor(1, 0)).toBeCloseTo(0);
    expect(yawFor(0, 1)).toBeCloseTo(-Math.PI / 2);
  });

  it('prey flee from the hero; predators bite when close', () => {
    const rng = mulberry32(2);
    const bites: number[] = [];
    // decisions live in behaviours/creatures.json now, so the trees have to be handed in
    const ctx = { world, rng, playerX: 3, playerZ: 3, playerArmed: false, treeFor, time: 0.5, onAttack: (_e: Entity, d: number) => bites.push(d) };
    const sheep = new Entity(KINDS.sheep, 3.5, 3, new Herd(KINDS.sheep, 3, 3, 3, 3, 5), 'k', rng);
    sheep.y = 1;
    updateEntity(sheep, 0.1, ctx);
    expect(sheep.state).toBe('flee');

    const wolf = new Entity(KINDS.wolf, 3.5, 3, new Herd(KINDS.wolf, 3, 3, 3, 3, 5), 'k', rng);
    wolf.y = 1;
    // a blow is wound up before it lands, so the bite is a tick or two after the decision to bite
    updateEntity(wolf, 0.1, ctx);
    expect(wolf.winding, 'the wolf did not wind up at all').toBeGreaterThan(0);
    expect(bites, 'the bite landed in the same instant it was decided on').toEqual([]);
    for (let n = 0; n < 20 && bites.length === 0; n++) updateEntity(wolf, 0.1, ctx);
    expect(bites).toEqual([KINDS.wolf.dangerous]);
    updateEntity(wolf, 0.1, ctx);
    expect(bites.length).toBe(1);                        // cooldown
    // the cooldown is set when the wolf commits, not when the blow lands, so by the time we are
    // looking at it the wind-up has already been spent out of it
    expect(wolf.attackCooldown).toBeGreaterThan(BEHAVIOUR.BITE_COOLDOWN * (1 - BEHAVIOUR.WIND_UP) - 0.3);
    expect(wolf.attackCooldown).toBeGreaterThan(0);

    // an armed hero scares the wolf off instead
    const armed = { ...ctx, playerArmed: true };
    const wolf2 = new Entity(KINDS.wolf, 3.5, 3, new Herd(KINDS.wolf, 3, 3, 3, 3, 5), 'k', rng);
    wolf2.y = 1;
    updateEntity(wolf2, 0.1, armed);
    expect(wolf2.state).toBe('flee');
  });
});

describe('villager hours', () => {
  it('walk home at dusk, vanish inside, and come back out after dawn', () => {
    const herd = new Herd(KINDS.villager, 10, 10, 10, 10, 6);
    const e = new Entity(KINDS.villager, 10, 10, herd, 'k', mulberry32(4));
    e.y = 1;
    e.posts = { home: [6, 10], square: [10, 10] };
    const ctx = { world, rng: mulberry32(5), playerX: 100, playerZ: 100, playerArmed: false, treeFor, onAttack: () => {}, time: 0.95 };
    for (let t = 0; t < 20 && !e.indoors; t += 0.1) updateEntity(e, 0.1, ctx);
    expect(e.indoors).toBe(true);
    expect(Math.hypot(e.x - 6, e.z - 10)).toBeLessThan(1);
    // still indoors while it is dark
    updateEntity(e, 0.1, ctx);
    expect(e.indoors).toBe(true);
    // morning: back out and wandering
    updateEntity(e, 0.1, { ...ctx, time: 0.5 });
    expect(e.indoors).toBe(false);
    expect(isDaytime(0.5)).toBe(true);
    expect(isDaytime(0.95)).toBe(false);
    expect(isDaytime(0.1)).toBe(false);
  });
});

describe('a villager\'s working day', () => {
  /** A farmer with somewhere to farm, somewhere to drink, and somewhere to sleep. */
  const farmer = () => {
    const herd = new Herd(KINDS.villager, 10, 10, 10, 10, 8);
    const e = new Entity(KINDS.villager, 10, 10, herd, 'k', mulberry32(6));
    e.y = 1;
    e.trade = 'farmer';
    e.posts = { home: [6, 10], field: [14, 12], square: [10, 10], inn: [8, 14] };
    return e;
  };

  const tick = (e: Entity, time: number) =>
    updateEntity(e, 0.1, { world, rng: mulberry32(2), playerX: 99, playerZ: 99, playerArmed: false, treeFor, onAttack: () => {}, time });

  it('is read out of behaviours/villagers.json, hour by hour', () => {
    const e = farmer();
    tick(e, 0.35);
    expect([e.herd.ax, e.herd.az]).toEqual([14, 12]);   // morning: the field
    tick(e, 0.54);
    expect([e.herd.ax, e.herd.az]).toEqual([10, 10]);   // noon: the square
    tick(e, 0.8);
    expect([e.herd.ax, e.herd.az]).toEqual([8, 14]);    // evening: the inn
    tick(e, 0.95);
    expect([e.herd.ax, e.herd.az]).toEqual([6, 10]);    // night: home
  });

  it('walks home at dusk, goes inside, and comes back out in the morning', () => {
    const e = farmer();
    for (let t = 0; t < 40 && !e.indoors; t += 0.1) tick(e, 0.95);
    expect(e.indoors).toBe(true);
    expect(Math.hypot(e.x - 6, e.z - 10)).toBeLessThan(3.1);

    tick(e, 0.95);
    expect(e.indoors).toBe(true);            // still in there while it is dark
    tick(e, 0.35);
    expect(e.indoors).toBe(false);           // and out again for the morning
  });

  it('falls back to its own kind when a trade has nowhere to go', () => {
    const e = farmer();
    e.posts = { square: [10, 10] };          // no field, no inn, no house
    tick(e, 0.35);
    expect(e.indoors).toBe(false);           // nothing to send them indoors, so they potter
  });
});

/*
 * Being put inside something, which is the one fault a player cannot walk away from.
 *
 * Nothing walks into a solid, but plenty of things are put into one: a hero carried home after a
 * knock on the head and set down two tiles from the middle of a village, which is sometimes a
 * market stall. Reported as "I respawn in the middle of an object and I am trapped".
 */
describe('somebody put down inside a wall', () => {
  /** Flat ground everywhere, with a solid block three tiles across in the middle of it. */
  const walled: TileWorld = {
    heightAt: (x, z) => (x < 0 || z < 0 || x >= 30 || z >= 30 ? null : 1),
    waterAt: () => null,
    blocked: (x, z) => x > 10 && x < 13 && z > 10 && z < 13,
    isRoad: () => false,
  };

  it('is let out rather than held in', () => {
    const e = new Entity(KINDS.hero, 11.5, 11.5, new Herd(KINDS.hero, 0, 0, 0, 0, 5), 'k', mulberry32(1));
    e.y = 1;
    // walking west, from the middle of the block
    for (let n = 0; n < 40 && walled.blocked(e.x, e.z); n++) tryMove(walled, e, -0.2, 0);
    expect(walled.blocked(e.x, e.z), 'still inside the wall after forty steps').toBe(false);
    expect(e.x, 'walked out of the world entirely').toBeGreaterThan(5);
  });

  it('and is not let back in once out', () => {
    const e = new Entity(KINDS.hero, 9, 11.5, new Herd(KINDS.hero, 0, 0, 0, 0, 5), 'k', mulberry32(1));
    e.y = 1;
    for (let n = 0; n < 20; n++) tryMove(walled, e, 0.2, 0);
    expect(e.x, 'walked into the wall from outside').toBeLessThan(10.1);
  });

  it('finds somewhere to stand near a spot that will not take him', () => {
    const clear = spaceNear(walled, KINDS.hero, 11.5, 11.5);
    expect(clear, 'nowhere at all to put him').toBeTruthy();
    expect(walled.blocked(clear!.x, clear!.z), 'put down inside the wall again').toBe(false);
    expect(Math.hypot(clear!.x - 11.5, clear!.z - 11.5), 'carried half way across the map').toBeLessThan(3);
  });
});
