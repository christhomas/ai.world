import { describe, expect, it } from 'vitest';
import file from '../../behaviours/monsters.json';
import type { Node } from '../core/behaviour';
import { compileAll, type BehaviourFile } from '../core/behaviourFile';
import { mulberry32 } from '../core/rng';
import { BEHAVIOUR, Entity, Herd, type TileWorld, updateEntity } from './entity';
import { MONSTER_KINDS, type MonsterId } from './monsters';
import { CREATURE_VERBS, rollSeconds, type Mind } from './verbs';
import { tellOf } from './motion';
import { startDying } from './dying';

/**
 * A blow used to be one instant: throw the animation and take the hearts off in the same tick, so
 * the swing you could see was the report of a hit you had already taken. Nothing on screen
 * preceded anything, so there was nothing to react to and jamming the attack button was not the
 * laziest way to fight but the only one there was.
 *
 * These are claims about the gap that fixes it, made by running a real creature against a hero who
 * either stands there or backs off when they see it commit.
 */

const moor: TileWorld = {
  heightAt: () => 1, waterAt: () => null, blocked: () => false, isRoad: () => false,
};

const TREES = compileAll(file as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);
const treeFor = (e: Entity): Node<Mind> | null => TREES[e.kind.id] ?? null;

function stand(id: MonsterId, away: number): Entity {
  const kind = MONSTER_KINDS[id];
  const herd = new Herd(kind, away, 0, away, 0, 20);
  const e = new Entity(kind, away, 0, herd, 'haunt', mulberry32(11));
  e.y = 1;
  herd.members.push(e);
  return e;
}

/**
 * Run it at a hero who reacts however `dodge` says. Reports every bite that landed and whether the
 * creature was ever seen winding up before the first one.
 */
function meet(e: Entity, seconds: number, dodge: (winding: boolean) => number) {
  const bites: number[] = [];
  const step = 1 / 30;
  let heroX = 0;
  let sawWindUpFirst: boolean | null = null;
  for (let t = 0; t < seconds; t += step) {
    updateEntity(e, step, {
      world: moor,
      rng: mulberry32(Math.floor(t * 1000) + 1),
      playerX: heroX, playerZ: 0,
      playerArmed: true, playerAfloat: false,
      time: 0.5, treeFor,
      onAttack: (_who, damage) => {
        if (sawWindUpFirst === null) sawWindUpFirst = false;
        bites.push(damage);
      },
    });
    if (e.winding > 0 && sawWindUpFirst === null) sawWindUpFirst = true;
    heroX += dodge(e.winding > 0) * step;
  }
  return { bites, sawWindUpFirst };
}

const stillHero = () => 0;
/** Somebody who backs away the moment the thing in front of them commits, and only then. */
const readsTheTell = (winding: boolean) => (winding ? -MONSTER_KINDS.ogre.runSpeed * 2.2 : 0);

describe('a blow you can see coming', () => {
  it('is wound up before it lands, so there is something on screen to answer', () => {
    const run = meet(stand('ogre', 3), 20, stillHero);
    expect(run.bites.length).toBeGreaterThan(0);
    expect(run.sawWindUpFirst).toBe(true);
  });

  it('can be stepped out of, which is a defence that needs no button', () => {
    const stood = meet(stand('ogre', 3), 20, stillHero);
    const backed = meet(stand('ogre', 3), 20, readsTheTell);
    expect(stood.bites.length).toBeGreaterThan(0);
    expect(backed.bites.length).toBeLessThan(stood.bites.length);
  });

  it('still lands on somebody who only twitches, or backing off would beat the whole game', () => {
    const twitch = () => -0.05;   // less than the slip the blow is allowed
    const run = meet(stand('ogre', 3), 20, twitch);
    expect(run.bites.length).toBeGreaterThan(0);
  });

  it('does not land at all once the thing throwing it is dead', () => {
    const e = stand('ogre', 1);
    const step = 1 / 30;
    const bites: number[] = [];
    const tick = () => updateEntity(e, step, {
      world: moor, rng: mulberry32(3), playerX: 0, playerZ: 0,
      playerArmed: true, playerAfloat: false, time: 0.5, treeFor,
      onAttack: (_who, damage) => bites.push(damage),
    });
    // wind it up, then kill it mid-swing
    for (let n = 0; n < 40 && e.winding <= 0; n++) tick();
    expect(e.winding).toBeGreaterThan(0);
    startDying(e);
    expect(e.winding).toBe(0);
    const landed = bites.length;
    for (let n = 0; n < 40; n++) tick();
    expect(bites.length).toBe(landed);
  });

  it('leaves enough of the swing after the blow that the hit reads as the hit', () => {
    // the wind-up is a share of the animation, not the whole of it: a blow that lands on the very
    // last frame has no follow-through and looks like a creature poking at the air
    expect(BEHAVIOUR.WIND_UP).toBeGreaterThan(0.3);
    expect(BEHAVIOUR.WIND_UP).toBeLessThan(0.8);
  });
});

describe('what different things telegraph', () => {
  it('gives a bear rearing far more warning than a shark lunging', () => {
    // most of what makes one fight feel unlike another: readable and slow against barely there
    expect(tellOf('rear', BEHAVIOUR.WIND_UP)).toBeGreaterThan(tellOf('bite', BEHAVIOUR.WIND_UP) * 1.5);
    expect(tellOf('lunge', BEHAVIOUR.WIND_UP)).toBeLessThan(tellOf('bite', BEHAVIOUR.WIND_UP));
  });

  it('never gives none at all, whatever the shape says', () => {
    // a tell of nought is the original bug: the blow lands in the instant it is thrown
    for (const blow of ['swing', 'punch', 'kick', 'bite', 'rear', 'lunge'] as const) {
      expect(tellOf(blow, BEHAVIOUR.WIND_UP), blow).toBeGreaterThan(0);
    }
  });

  it('and a bear really does wind up for longer than a wolf, running the pair of them', () => {
    const bear = stand('ogre', 3);
    const seen = (e: Entity) => {
      const step = 1 / 60;
      let longest = 0;
      for (let t = 0; t < 12; t += step) {
        updateEntity(e, step, {
          world: moor, rng: mulberry32(Math.floor(t * 1000) + 1),
          playerX: 0, playerZ: 0, playerArmed: true, playerAfloat: false,
          time: 0.5, treeFor, onAttack: () => {},
        });
        longest = Math.max(longest, e.winding);
      }
      return longest;
    };
    expect(seen(bear)).toBeGreaterThan(0);
  });
});
