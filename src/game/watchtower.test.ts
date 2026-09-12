import { describe, expect, it } from 'vitest';
import villagers from '../../behaviours/villagers.json';
import { compileAll, type BehaviourFile } from '../core/behaviourFile';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd, updateEntity, type TileWorld } from '../entities/entity';
import { CREATURE_VERBS, rollSeconds, type Mind } from '../entities/verbs';
import { ORDERS } from './hire';

/**
 * A man posted to a watchtower, and what he does from up there.
 *
 * A watchtower has stood in this country since the first landmarks went in and has never been
 * anything but scenery — a shape on a hill with a door nobody opens. This is what makes it a
 * building worth paying for: a hired sword told to take it stands on the fighting platform and
 * puts arrows into whatever comes near, and the same man standing in the grass beside it is worth
 * a great deal less.
 *
 * Three things are pinned here and each of them was a way to get this wrong.
 *
 * He has to *stay up there*. The branch that sends a hired man at whatever has teeth is the first
 * thing in his tree, for good reasons that have nothing to do with towers, and a bowman who climbs
 * down to go and hit a wolf with his sword has thrown away the only thing a bow is for.
 *
 * He has to stay up there *when nothing is happening*, which is the same failure wearing a hat: a
 * quiet watch that does not claim the tick falls through to the branch below and the first wolf a
 * mile off empties the tower.
 *
 * And stepping off has to bring him down. The ground does not know the platform is there — it is a
 * prop, and a prop is something to walk round rather than something to stand on — so the height he
 * is standing at is his own, and anything that makes him take a step has to give it up. Otherwise
 * a man knocked off a tower walks home through the air.
 */

const TREES = compileAll(villagers as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);
const HIRED = TREES.hired;

/** Flat ground at a known height, so "how far above the ground is he" has one answer. */
const GROUND = 3;
const flat: TileWorld = {
  heightAt: () => GROUND,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

/** Where the tower stands in these tests, and how high its platform is in the behaviour file. */
const TOWER = { x: 0, z: 0 };
const PLATFORM = 5.3;

function soldier(x: number, z: number): Entity {
  const kind = KINDS.villager;
  const herd = new Herd(kind, x, z, x, z, 40);
  const man = new Entity(kind, x, z, herd, 'test', mulberry32(3));
  man.trade = 'hired';
  man.y = GROUND;
  herd.members.push(man);
  return man;
}

function wolfAt(x: number, z: number): Entity {
  const kind = KINDS.wolf;
  const herd = new Herd(kind, x, z, x, z, 40);
  const beast = new Entity(kind, x, z, herd, 'test', mulberry32(5));
  beast.y = GROUND;
  herd.members.push(beast);
  return beast;
}

/**
 * Run the hired tree for a while, with whatever the world is supposed to contain.
 *
 * `foe` is what a man told to fight — or to watch — looks for, and it is handed in the way the
 * game hands it in: the nearest thing with teeth, or nothing at all.
 */
function watch(man: Entity, seconds: number, foe: Entity | null = null): { struck: Array<[string, number]> } {
  const struck: Array<[string, number]> = [];
  const step = 1 / 30;
  for (let t = 0; t < seconds; t += step) {
    updateEntity(man, step, {
      world: flat, rng: mulberry32(Math.floor(t * 1000) + 1),
      playerX: 40, playerZ: 40, playerArmed: true, playerAfloat: false,
      time: 0.5,
      treeFor: () => HIRED,
      onAttack: () => false,
      foe: (_from, within) => {
        if (!foe || foe.dead) return null;
        return Math.hypot(foe.x - man.x, foe.z - man.z) <= within ? foe : null;
      },
      nearestTrouble: () => null,
      strike: (_by, victim, damage) => { struck.push([victim.kind.id ?? '?', damage]); },
    } as Parameters<typeof updateEntity>[2]);
  }
  return { struck };
}

const post = (man: Entity) => {
  man.told = { by: 'you', to: 'him', what: ORDERS.WATCH, at: TOWER };
};

describe('a hired sword told to take the tower', () => {
  it('walks to the foot of it and ends up standing on the platform', () => {
    const man = soldier(6, 0);
    post(man);
    watch(man, 12);
    expect(Math.hypot(man.x - TOWER.x, man.z - TOWER.z), 'he never reached the tower').toBeLessThan(2);
    expect(man.perch, 'he is standing in the grass beside it').toBeCloseTo(GROUND + PLATFORM, 5);
  });

  it('stays up there when there is nothing at all to shoot', () => {
    // the failure this guards: a quiet tick falls through to "walk at whoever hired you", and the
    // man you paid to watch the road is suddenly at your shoulder half a mile away
    const man = soldier(0.5, 0);
    post(man);
    watch(man, 10);
    expect(man.perch, 'a quiet watch walked him off the tower').not.toBeNull();
    expect(man.doing).toBe('on the tower');
  });

  it('shoots what comes near without climbing down to it', () => {
    const man = soldier(0.5, 0);
    post(man);
    watch(man, 4);                               // long enough to be up there
    const wolf = wolfAt(9, 0);
    const { struck } = watch(man, 6, wolf);
    expect(struck.length, 'nothing was shot at').toBeGreaterThan(0);
    expect(struck[0][0]).toBe('wolf');
    expect(man.perch, 'he climbed down to fight a wolf he could have shot').not.toBeNull();
    expect(Math.hypot(man.x - TOWER.x, man.z - TOWER.z), 'he left his post').toBeLessThan(2);
  });

  it('will not reach something further off than an arrow carries', () => {
    const man = soldier(0.5, 0);
    post(man);
    watch(man, 4);
    const far = wolfAt(40, 0);
    const { struck } = watch(man, 6, far);
    expect(struck, 'a bowman hit something forty tiles away').toEqual([]);
  });

  it('shoots on a cooldown rather than every frame', () => {
    const man = soldier(0.5, 0);
    post(man);
    watch(man, 4);
    const wolf = wolfAt(8, 0);
    const seconds = 9;
    const { struck } = watch(man, seconds, wolf);
    // the file says one arrow every 1.8 seconds; anything near thirty a second is a stream
    expect(struck.length).toBeGreaterThan(1);
    expect(struck.length, 'he is loosing arrows every frame').toBeLessThan(seconds);
  });
});

describe('coming down off a tower', () => {
  it('happens the moment he takes a step', () => {
    const man = soldier(0.5, 0);
    post(man);
    watch(man, 6);
    expect(man.perch).not.toBeNull();

    // told something else: the order is what was holding him up there
    man.told = { by: 'you', to: 'him', what: ORDERS.FOLLOW };
    watch(man, 6);
    expect(man.perch, 'he walked home through the air').toBeNull();
  });

  it('leaves him at the height of the ground he walks onto', () => {
    const man = soldier(0.5, 0);
    post(man);
    watch(man, 6);
    man.told = { by: 'you', to: 'him', what: ORDERS.FOLLOW };
    watch(man, 8);
    expect(man.y, 'he is still hanging above the grass').toBeCloseTo(GROUND, 1);
  });
});
