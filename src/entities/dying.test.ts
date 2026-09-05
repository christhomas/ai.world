import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, type TileWorld } from './entity';
import { EntityManager } from './manager';
import { EntityRenderer } from './pool';
import { DYING_LASTS, bodyMotion, dyingAt } from './motion';
import { buryTheFallen, startDying } from './dying';

const flat: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const one = (kind = 'deer'): Entity => {
  const k = KINDS[kind];
  return new Entity(k, 0, 0, new Herd(k, 0, 0, 0, 0, 0), 'test', mulberry32(1));
};

/**
 * A killed creature used to leave the world on the frame it died, so a swing that killed and a
 * swing that missed looked much the same. These pin the body staying long enough to be seen going
 * down, and — just as important — nothing treating it as though it were still alive while it does.
 */
describe('going down', () => {
  it('keeps the body, for as long as the motion file says the fall takes', () => {
    const deer = one();
    startDying(deer);
    expect(deer.dead).toBe(true);
    expect(deer.dying).toBe(DYING_LASTS);
  });

  it('stops the walk, so the collapse is not fighting a stride underneath it', () => {
    const deer = one();
    deer.walk = 1; deer.flap = 1; deer.strike = 0.3;
    startDying(deer);
    expect(deer.walk).toBe(0);
    expect(deer.flap).toBe(0);
    expect(deer.strike).toBe(0);
  });

  it('is not restarted by a second arrow into the same body', () => {
    const deer = one();
    startDying(deer);
    deer.dying = 0.1;
    startDying(deer);
    expect(deer.dying, 'the fall began again').toBe(0.1);
  });

  it('takes the body away once it has finished falling, and not before', () => {
    const deer = one();
    startDying(deer);
    const gone: Entity[] = [];
    const bury = (dt: number): void => buryTheFallen([[deer]], dt, (e) => gone.push(e));

    bury(DYING_LASTS * 0.9);
    expect(gone, 'taken away mid-fall').toEqual([]);
    bury(DYING_LASTS * 0.2);
    expect(gone).toEqual([deer]);
  });

  it('leaves the living entirely alone', () => {
    const deer = one();
    const gone: Entity[] = [];
    buryTheFallen([[deer]], 10, (e) => gone.push(e));
    expect(gone).toEqual([]);
    expect(deer.dying).toBe(0);
  });

  it('buries a body nobody is standing near', () => {
    // the sweep deliberately runs over everything rather than only what is near the hero: a
    // creature killed as they walk away would otherwise lie there for ever
    const far = one();
    far.x = 9000; far.z = 9000;
    startDying(far);
    const gone: Entity[] = [];
    buryTheFallen([[far]], DYING_LASTS + 0.01, (e) => gone.push(e));
    expect(gone).toEqual([far]);
  });
});

describe('how a body falls', () => {
  it('starts where it stood and ends flat', () => {
    expect(dyingAt(DYING_LASTS)).toBe(0);
    expect(dyingAt(0)).toBe(0);
    expect(dyingAt(0.0001)).toBeCloseTo(1, 2);
  });

  it('accelerates, because a body that topples at a steady rate is a plank being lowered', () => {
    const quarter = dyingAt(DYING_LASTS * 0.75);
    const half = dyingAt(DYING_LASTS * 0.5);
    const threeQuarters = dyingAt(DYING_LASTS * 0.25);
    expect(half - quarter).toBeLessThan(threeQuarters - half);
  });

  it('rolls the body over and sinks it out of sight', () => {
    const deer = one();
    startDying(deer);
    const start = bodyMotion(deer);
    deer.dying = 0.001;
    const end = bodyMotion(deer);
    expect(Math.abs(end.roll), 'did not go over').toBeGreaterThan(1);
    expect(end.bob, 'did not sink').toBeLessThan(-0.5);
    expect(Math.abs(start.roll)).toBeLessThan(Math.abs(end.roll));
  });

  it('takes over from the walk rather than adding to it', () => {
    // a body on its way to the ground is not also breathing
    const walking = one();
    walking.walk = 1; walking.phase = 1.2;
    const alive = bodyMotion(walking);
    startDying(walking);
    walking.dying = 0.001;
    const dead = bodyMotion(walking);
    expect(Math.abs(dead.lean), 'still leaning into a walk it is not doing').toBeLessThan(Math.abs(alive.lean) + 0.01);
  });
});

/**
 * The part that could have gone quietly wrong. Until bodies lingered, a dead creature left the
 * world on the frame it died, so most queries never bothered to exclude the dead.
 */
describe('a body is not somebody', () => {
  const setup = () => {
    const renderer = new EntityRenderer(new THREE.Scene());
    const manager = new EntityManager(renderer, flat, { getTiles: () => null }, 1);
    manager.spawnMonsters([[0, 0]], 1);
    return manager;
  };

  it('is not offered to anything asking who is nearby', () => {
    const manager = setup();
    const victim = manager.within(0, 0, 40)[0];
    expect(victim, 'nothing spawned to kill').toBeTruthy();
    victim.x = 0; victim.z = 0;
    expect(manager.within(0, 0, 5)).toContain(victim);

    manager.killEntity(victim);
    expect(manager.within(0, 0, 5), 'a corpse answered a question about the living').not.toContain(victim);
    expect(manager.nearest(0, 0, 5), 'you could talk to it').not.toBe(victim);
  });

  it('is still in the world to be drawn while it falls', () => {
    const manager = setup();
    const victim = manager.within(0, 0, 40)[0];
    manager.killEntity(victim);
    expect(manager.theFallen(), 'nothing left to draw going down').toContain(victim);
  });
});
