import { describe, expect, it } from 'vitest';
import { BEHAVIOUR, Entity, Herd, type TileWorld } from './entity';
import { keepApart } from './contact';
import { KINDS } from './animals';
import { mulberry32 } from '../core/rng';

/** Flat, empty, walkable everywhere: this is about bodies, not about terrain. */
const flat: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const one = (kind: string, x: number, z: number): Entity => {
  const k = KINDS[kind];
  return new Entity(k, x, z, new Herd(k, x, z, x, z, 0), 'test', mulberry32(1));
};

/**
 * The player's own words: "the models overlap each other and there is no distance from each
 * other, they sit on your head and kill you". So what is tested is that a body takes up room.
 */
describe('bodies taking up room', () => {
  it('pushes something standing inside you back out of you', () => {
    const bat = one('bat', 0.1, 0);
    keepApart(bat, 0, 0, BEHAVIOUR.PERSONAL, 0.5, flat);
    expect(Math.hypot(bat.x, bat.z), 'still inside the hero').toBeGreaterThan(0.1);
  });

  it('gets there in a moment rather than over a slow drift', () => {
    const bat = one('bat', 0.1, 0);
    // a third of a second of shoving, which is about how long a swarm gives you
    for (let n = 0; n < 20; n++) keepApart(bat, 0, 0, BEHAVIOUR.PERSONAL, 1 / 60, flat);
    expect(Math.hypot(bat.x, bat.z)).toBeGreaterThanOrEqual(BEHAVIOUR.PERSONAL - 0.01);
  });

  it('has somewhere to go even when exactly on top of you', () => {
    const bat = one('bat', 0, 0);
    for (let n = 0; n < 20; n++) keepApart(bat, 0, 0, BEHAVIOUR.PERSONAL, 1 / 60, flat);
    expect(Number.isFinite(bat.x) && Number.isFinite(bat.z)).toBe(true);
    expect(Math.hypot(bat.x, bat.z), 'nowhere is still somewhere').toBeGreaterThan(0.2);
  });

  it('leaves alone anything already standing clear', () => {
    const wolf = one('wolf', 4, 0);
    keepApart(wolf, 0, 0, BEHAVIOUR.PERSONAL, 0.5, flat);
    expect(wolf.x).toBe(4);
    expect(wolf.z).toBe(0);
  });

  it('separates a whole swarm rather than only the nearest of them', () => {
    // six bats all on the same spot, which is exactly the reported problem
    const swarm = Array.from({ length: 6 }, () => one('bat', 0, 0));
    for (let tick = 0; tick < 40; tick++) {
      for (const bat of swarm) keepApart(bat, 0, 0, BEHAVIOUR.PERSONAL, 1 / 60, flat);
      for (let i = 0; i < swarm.length; i++) {
        for (let j = i + 1; j < swarm.length; j++) {
          keepApart(swarm[i], swarm[j].x, swarm[j].z, BEHAVIOUR.ELBOW, 1 / 60, flat);
        }
      }
    }
    for (const bat of swarm) {
      expect(Math.hypot(bat.x, bat.z), 'one of them is still on the hero').toBeGreaterThan(BEHAVIOUR.PERSONAL * 0.8);
    }
    // and they are not all stacked on each other either
    for (let i = 0; i < swarm.length; i++) {
      for (let j = i + 1; j < swarm.length; j++) {
        const apart = Math.hypot(swarm[i].x - swarm[j].x, swarm[i].z - swarm[j].z);
        expect(apart, 'two of them share a square').toBeGreaterThan(BEHAVIOUR.ELBOW * 0.5);
      }
    }
  });

  it('will not shove anything that walks through a wall', () => {
    // a bat would go over it, and should: this is about the things that cannot
    const walled: TileWorld = { ...flat, blocked: (x) => x > 0.2 };
    const wolf = one('wolf', 0.1, 0);
    for (let n = 0; n < 20; n++) keepApart(wolf, 0, 0, BEHAVIOUR.PERSONAL, 1 / 60, walled);
    expect(wolf.x, 'pushed through solid ground').toBeLessThanOrEqual(0.2);
  });
});
