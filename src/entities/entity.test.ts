import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { BEHAVIOUR, Entity, Herd, STEP_LIMIT, canStand, tryMove, updateEntity, yawFor, type TileWorld } from './entity';

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
