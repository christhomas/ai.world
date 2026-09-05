import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { treeFor } from './behaviours';
import { BEHAVIOUR, Entity, Herd, STEP_LIMIT, canStand, isDaytime, tryMove, updateEntity, yawFor, type TileWorld } from './entity';

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
