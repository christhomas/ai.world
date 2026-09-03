import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
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
    const ctx = { world, rng, playerX: 3, playerZ: 3, playerArmed: false, onAttack: (_e: Entity, d: number) => bites.push(d) };
    const sheep = new Entity(KINDS.sheep, 3.5, 3, new Herd(KINDS.sheep, 3, 3, 3, 3, 5), 'k', rng);
    sheep.y = 1;
    updateEntity(sheep, 0.1, ctx);
    expect(sheep.state).toBe('flee');

    const wolf = new Entity(KINDS.wolf, 3.5, 3, new Herd(KINDS.wolf, 3, 3, 3, 3, 5), 'k', rng);
    wolf.y = 1;
    updateEntity(wolf, 0.1, ctx);
    expect(bites).toEqual([KINDS.wolf.dangerous]);
    updateEntity(wolf, 0.1, ctx);
    expect(bites.length).toBe(1);                        // cooldown
    expect(wolf.attackCooldown).toBeGreaterThan(BEHAVIOUR.BITE_COOLDOWN - 0.3);

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
    e.home = [6, 10];
    const ctx = { world, rng: mulberry32(5), playerX: 100, playerZ: 100, playerArmed: false, onAttack: () => {}, time: 0.95 };
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

describe('the village day', () => {
  it('sends people to work, to the square, to the inn, then home', async () => {
    const { routineAt } = await import('./entity');
    expect(routineAt(0.1)).toBe('home');    // small hours
    expect(routineAt(0.35)).toBe('work');   // morning
    expect(routineAt(0.5)).toBe('square');  // noon
    expect(routineAt(0.7)).toBe('inn');     // evening
    expect(routineAt(0.9)).toBe('home');    // night
  });

  it('moves the herd anchor to the post the hour calls for', () => {
    const herd = new Herd(KINDS.villager, 10, 10, 10, 10, 8);
    const e = new Entity(KINDS.villager, 10, 10, herd, 'k', mulberry32(6));
    e.y = 1;
    e.home = [6, 10];
    e.work = [14, 12];
    e.square = [10, 10];
    e.inn = [8, 14];
    const tick = (time: number) => updateEntity(e, 0.1, { world, rng: mulberry32(2), playerX: 99, playerZ: 99, playerArmed: false, onAttack: () => {}, time });
    tick(0.35);
    expect([herd.ax, herd.az]).toEqual([14, 12]);
    tick(0.7);
    expect([herd.ax, herd.az]).toEqual([8, 14]);
    tick(0.5);
    expect([herd.ax, herd.az]).toEqual([10, 10]);
  });
});
