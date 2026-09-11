import { describe, expect, it } from 'vitest';
import { Memory } from '../core/behaviour';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, type TileWorld } from './entity';
import { CREATURE_VERBS, type Mind } from './verbs';
import { tradeTree } from './behaviours';

/**
 * A man in somebody's pay, doing what he was told.
 *
 * The books being right about an order is the easy half and `hire.test.ts` has it. This is the half
 * that matters on screen: whether the word actually changes what the body does. It is asked of the
 * whole `hired` tree rather than of a verb, because what an order changes is *which branch he
 * takes*, and a branch is only a branch in the company of the ones above it.
 *
 * That ordering is load-bearing and is the first thing tested. The trouble branch sits above the
 * order branches on purpose: a man told to wait still defends himself, and a rule that let an order
 * outrank his own neck would be a rule that got him killed while obeying it.
 *
 * Driven in a browser first and the browser could not answer it — a hero who teleports drags his
 * company with him by design, so the men stood beside him wherever he went whatever they had been
 * told. That is correct behaviour and a useless experiment, which is the case a unit test is for.
 */

/** Flat ground with nothing on it, so nothing but the tree decides where anybody goes. */
const green: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  isRoad: () => false,
  solidAt: () => false,
  depth: () => 0,
} as unknown as TileWorld;

function soldier(x: number, z: number, what = '', at?: { x: number; z: number }): Entity {
  const kind = KINDS.villager;
  const herd = new Herd(kind, x, z, x, z, 40);
  const e = new Entity(kind, x, z, herd, 'test', mulberry32(3));
  e.y = 0;
  e.told = what ? { by: 'you', to: 'him', what, ...(at ? { at } : {}) } : null;
  herd.members.push(e);
  return e;
}

/** One tick of the whole `hired` tree, with the hero standing where you say and nothing else about. */
function aTick(self: Entity, over: Partial<Mind> = {}, dt = 0.5): void {
  const tree = tradeTree('hired');
  expect(tree, 'nobody knows how to be a hired man').not.toBeNull();
  const world: Mind = {
    self, ground: green, playerX: 40, playerZ: 0, playerAfloat: false, playerArmed: false,
    rng: mulberry32(9), bite: () => {}, time: 0.5,
    quarry: () => null, remove: () => {}, nearestPerson: () => null, nearestTrouble: () => null,
    stock: () => null, foe: () => null,
    strike: () => {}, worth: () => 4, wanted: false, arrest: () => {},
    ...over,
  } as Mind;
  tree!({ world, dt, memory: new Memory() });
}

describe('a hired man with no orders', () => {
  it('walks at whoever is paying him, which is what following is', () => {
    const man = soldier(0, 0);
    aTick(man);
    expect(man.tx, 'he did not set off after the hero').toBeGreaterThan(0);
  });
});

describe('a hired man told to wait', () => {
  it('does not set off after the hero', () => {
    const man = soldier(0, 0, 'hold');
    aTick(man);
    // either he was never given somewhere to go, or he was told to stay where he is
    expect(Math.hypot((man.tx ?? man.x) - man.x, (man.tz ?? man.z) - man.z),
      'a man told to wait walked off after the hero anyway').toBeLessThan(1);
  });

  it('still defends himself, because an order must not outrank his own neck', () => {
    /*
     * The trouble branch sits above the order branches in the tree and this is why. A man told to
     * hold a bridge who then stands still while a wolf eats him is obeying an instruction nobody
     * meant to give, and it would read as the order being broken rather than kept.
     */
    const man = soldier(0, 0, 'hold');
    const wolf = soldier(1, 0);
    aTick(man, { nearestTrouble: () => wolf });
    expect(man.target, 'a man told to wait ignored something with teeth on him').toBe(wolf);
  });
});

describe('a hired man told to go in first', () => {
  it('marks something dangerous that has not started anything yet', () => {
    // the difference between this and what he does unbidden: `nearestTrouble` waits for the teeth
    // to be on somebody, and a man told to fight does not wait
    const man = soldier(0, 0, 'fight');
    const bear = soldier(6, 0);
    aTick(man, { foe: () => bear });
    expect(man.target, 'told to go in and went for nothing').toBe(bear);
  });

  it('goes for it, rather than standing where he was', () => {
    const man = soldier(0, 0, 'fight');
    const bear = soldier(6, 0);
    aTick(man, { foe: () => bear });
    expect(man.tx).toBeCloseTo(bear.x, 1);
  });

  it('falls back to following when there is nothing to go in at', () => {
    // an order is not a state he gets stuck in: told to fight in an empty field he is still a man
    // walking at your shoulder
    const man = soldier(0, 0, 'fight');
    aTick(man, { foe: () => null });
    expect(man.tx).toBeGreaterThan(0);
  });
});

/**
 * An order with something in it.
 *
 * The reason an instruction is a sentence rather than a word. "Wait" and "wait *there*" are
 * different instructions and the second is the one anybody means: told to hold at a bridge and
 * given nowhere in particular, a man drifts off it under the separation sweep and his own idling,
 * and a player who comes back for him finds him standing somewhere else.
 */
describe('an order that says where', () => {
  it('walks him back to the spot when something has shoved him off it', () => {
    const man = soldier(9, 0, 'hold', { x: 0, z: 0 });
    aTick(man);
    expect(Math.hypot(man.tx - 0, man.tz - 0), 'he stood where he had drifted to').toBeLessThan(1);
    expect(man.state).toBe('walk');
  });

  it('stops him once he is back on it, rather than jittering across it', () => {
    const man = soldier(0.4, 0.2, 'hold', { x: 0, z: 0 });
    aTick(man);
    expect(Math.hypot(man.tx - man.x, man.tz - man.z)).toBeLessThan(0.01);
  });

  it('still just stands still on an order that never said where', () => {
    // safe on an instruction from before there was anywhere to put one
    const man = soldier(5, 5, 'hold');
    aTick(man);
    expect(Math.hypot(man.tx - man.x, man.tz - man.z)).toBeLessThan(1);
  });
});

/**
 * Who gave it.
 *
 * A road wide enough for two players is wide enough for two people to have hired somebody, which
 * `Bargain.side` has always known about the bargain. The order has to know it too, or it is a
 * shout anybody can make at anybody's man.
 */
describe('an order that says who gave it', () => {
  it('carries the speaker, so a man knows whose word he is taking', () => {
    const man = soldier(0, 0, 'hold', { x: 0, z: 0 });
    expect(man.told?.by).toBe('you');
    expect(man.told?.to).toBe('him');
  });
});
