import { describe, expect, it } from 'vitest';
import creatures from '../../behaviours/creatures.json';
import type { Node } from '../core/behaviour';
import { compileAll, type BehaviourFile } from '../core/behaviourFile';
import { GAMEPLAY } from '../core/config';
import { mulberry32 } from '../core/rng';
import { COMBAT } from '../game/combat';
import { GameState } from '../game/state';
import { DUNGEON_MONSTERS, KINDS, dungeonMonsters } from './animals';
import { Entity, Herd, damageEntity, updateEntity, type TileWorld } from './entity';
import { CREATURE_VERBS, rollSeconds, type Mind } from './verbs';

/**
 * How dangerous the world is, as a test.
 *
 * Every number here is measured rather than written down: the shipped behaviour trees drive real
 * entities on real ground, blows land through the same reeling window main.ts gates them through,
 * armour is whatever the starting kit actually adds up to, and the hero swings on the same
 * cooldown for the same damage as combat.ts. Change a creature's bite, its herd or its pace and
 * these move, which is the point of measuring rather than asserting a table of magic seconds.
 *
 * The one judgement call is REACTION, and it is written out loud so it can be argued with.
 */

/**
 * How long a player who is paying ordinary attention takes to notice something is on them and
 * turn away: a moment to see the screen flash, a moment to decide, a moment to get moving.
 *
 * Everything else here is a multiple of it. It is deliberately generous, because a beginner in a
 * dark cave is not a reflex test, and it is the number to argue with if any of this feels wrong.
 */
const REACTION = 1.5;

/** Nothing alive may empty ten hearts inside this: two goes at reacting, for the worst of them. */
const NEVER_FASTER_THAN = REACTION * 2;

/** And nothing a beginner can meet in their first hour may do it inside this. */
const EARLY_FLOOR = REACTION * 4;

/**
 * What a beginner can walk into before they have been anywhere to buy anything: the shallow
 * dungeon band, which is every cave and the floor of a vault you arrive on, plus the dangerous
 * animals that live above ground. Read from the spawn table rather than listed, so moving a
 * creature deeper is by itself enough to take it off this list.
 */
const EARLY = [...new Set([...DUNGEON_MONSTERS.map((w) => w.kind), 'wolf', 'bear'])];

const TREES = compileAll(creatures as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);
/** The wiring behaviours.ts does, repeated here so this test needs nothing from the game layer. */
const DRIVEN_BY: Record<string, string> = {
  graze: 'grazer', wander: 'wanderer', travel: 'traveller', hop: 'hopper',
  swim: 'swimmer', prowl: 'prowler', hunt: 'monster', fly: 'flier', circle: 'seaHunter',
};
const treeFor = (e: Entity): Node<Mind> | null => TREES[DRIVEN_BY[e.kind.behaviour]] ?? null;

/** Open flat ground: nothing in the way, so what happens is the creature and nothing else. */
const flat: TileWorld = {
  heightAt: () => 1,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const STEP = 1 / 60;

/** Every kind that attacks the hero at all. */
const dangerous = Object.entries(KINDS).filter(([, k]) => (k.dangerous ?? 0) > 0);

/** A pack of one kind, ringed round the hero at the range they would have closed to anyway. */
function pack(id: string, count: number): Entity[] {
  const kind = KINDS[id];
  const rng = mulberry32(7);
  const herd = new Herd(kind, 2.5, 0, 2.5, 0, 30);
  const mob: Entity[] = [];
  for (let n = 0; n < count; n++) {
    const a = (n / count) * Math.PI * 2;
    const e = new Entity(kind, 2.5 + Math.cos(a) * 0.9, Math.sin(a) * 0.9, herd, 'test', rng);
    e.y = 1;
    herd.members.push(e);
    mob.push(e);
  }
  return mob;
}

/** The blow the hero takes, gated and shoved exactly as main.ts gates and shoves it. */
function blowTaker(state: GameState, hero: { x: number; z: number }) {
  let reeling = 0;
  let blows = 0;
  let perBlow = 0;
  return {
    get blows() { return blows; },
    get perBlow() { return perBlow; },
    age: (dt: number) => { reeling = Math.max(0, reeling - dt); },
    take: (attacker: Entity, damage: number) => {
      // main.ts: a blow buys you a moment in which nothing else can land
      if (reeling > 0) return false;
      reeling = GAMEPLAY.REELING;
      const dx = hero.x - attacker.x, dz = hero.z - attacker.z;
      const len = Math.hypot(dx, dz) || 1;
      hero.x += (dx / len) * GAMEPLAY.KNOCKED_BACK;
      hero.z += (dz / len) * GAMEPLAY.KNOCKED_BACK;
      const before = state.hp;
      state.damage(damage);
      if (!blows) perBlow = before - state.hp;
      blows++;
      return true;
    },
  };
}

interface Meeting {
  /** Seconds until a fresh hero is on nought hearts, or Infinity if they were never finished. */
  died: number;
  /** Blows that actually landed: fewer than were thrown, because of the reeling window. */
  blows: number;
  /** Hearts each landed blow cost, after the starting kit's armour. */
  perBlow: number;
  /** Blows that landed after the hero turned and ran: the parting shots. */
  chased: number;
}

/**
 * Put a pack on a fresh hero and watch.
 *
 * `reactAfter` is the honest version of running away: the hero stands there until that many
 * seconds after the first blow lands, and only then turns and runs flat out. Leave it out and
 * they never move at all, which is the worst case and the one the floors are measured against.
 */
function meet(id: string, count: number, seconds: number, reactAfter = Infinity): Meeting {
  const mob = pack(id, count);
  const state = GameState.fresh();
  const hero = { x: 0, z: 0 };
  const taker = blowTaker(state, hero);
  let died = Infinity, firstBlow = Infinity, running = false, chased = 0;
  for (let t = 0; t < seconds && died === Infinity; t += STEP) {
    taker.age(STEP);
    const before = taker.blows;
    for (const e of mob) {
      updateEntity(e, STEP, {
        world: flat, rng: mulberry32(Math.floor(t * 1000) + 1),
        playerX: hero.x, playerZ: hero.z,
        playerArmed: state.armed, playerAfloat: false,
        time: 0.5, treeFor, onAttack: taker.take,
      });
    }
    if (taker.blows > before) {
      if (firstBlow === Infinity) firstBlow = t;
      if (running) chased++;
    }
    if (!running && firstBlow !== Infinity && t >= firstBlow + reactAfter) running = true;
    if (running) hero.x -= KINDS.hero.speed * STEP;
    if (state.hp <= 0) died = t;
  }
  return { died, blows: taker.blows, perBlow: taker.perBlow, chased };
}

interface Fight {
  /** Hearts left when the last of them is down; nought if the hero went down first. */
  hearts: number;
  won: boolean;
  seconds: number;
}

/**
 * The same meeting, but the hero fights back: closes, faces, and swings on combat.ts's cooldown
 * for whatever the weapon in their hand is worth. The reach and the arc are combat.ts's own, so
 * what a swing catches here is what it catches in the game, sweep and all.
 */
function fight(id: string, count: number, weapon: string | null, seconds = 60): Fight {
  const mob = pack(id, count);
  const state = GameState.fresh();
  if (weapon) { state.give(weapon); state.equip(weapon); }
  const hero = { x: 0, z: 0 };
  const taker = blowTaker(state, hero);
  let swingCooldown = 0;
  const alive = () => mob.filter((e) => !e.dead);
  let t = 0;
  for (; t < seconds; t += STEP) {
    if (state.hp <= 0 || alive().length === 0) break;
    taker.age(STEP);
    swingCooldown = Math.max(0, swingCooldown - STEP);
    for (const e of mob) {
      if (e.dead) continue;
      updateEntity(e, STEP, {
        world: flat, rng: mulberry32(Math.floor(t * 1000) + 1),
        playerX: hero.x, playerZ: hero.z,
        playerArmed: state.armed, playerAfloat: false,
        time: 0.5, treeFor, onAttack: taker.take,
      });
    }
    // the hero: face the nearest one, close if it is out of reach, swing whenever they may
    const near = alive().sort((a, b) =>
      Math.hypot(a.x - hero.x, a.z - hero.z) - Math.hypot(b.x - hero.x, b.z - hero.z))[0];
    if (!near) break;
    const dx = near.x - hero.x, dz = near.z - hero.z;
    const away = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(-dz, dx);
    if (away > COMBAT.RANGE - 0.4) {
      const step = Math.min(away, KINDS.hero.speed * STEP);
      hero.x += (dx / away) * step;
      hero.z += (dz / away) * step;
      continue;
    }
    if (swingCooldown > 0) continue;
    swingCooldown = COMBAT.COOLDOWN;
    // combat.ts sweeps the whole arc, so a huddle can go down to a single blow
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    for (const e of alive()) {
      const ex = e.x - hero.x, ez = e.z - hero.z;
      const len = Math.hypot(ex, ez) || 1;
      if (len > COMBAT.RANGE) continue;
      if ((ex / len) * fx + (ez / len) * fz < Math.cos(COMBAT.ARC)) continue;
      damageEntity(e, state.attack, hero.x, hero.z, flat);
    }
  }
  return { hearts: Math.max(0, state.hp), won: alive().length === 0 && state.hp > 0, seconds: t };
}

describe('what a fresh hero sets out with', () => {
  it('is ten hearts, a two-point stick and one heart of armour', () => {
    const state = GameState.fresh();
    expect(state.maxHpTotal).toBe(10);
    expect(state.attack).toBe(2);
    // every two points of armour turn one heart aside, and a blow never falls below one. The
    // tunic and the boots make two, so a one-point bite and a two-point bite cost the same
    expect(state.defence).toBe(2);
    expect(state.damage(2)).toBe(false);
    expect(state.hp).toBe(9);
  });

  it('is not enough to count as armed, which is why prowlers still come on', () => {
    // the prowler tree backs a wolf or a bear off an armed hero. `armed` wants two points in the
    // hand and a stick is one, so a beginner is offered no such courtesy. If that ever changes,
    // the wolf and bear rows of this table change with it and want measuring again
    expect(GameState.fresh().armed).toBe(false);
  });
});

describe('the survivability table', () => {
  it('gives every dangerous creature alive more than two goes at reacting', () => {
    for (const [id, k] of dangerous) {
      // sea hunters only ever bite somebody in the water: on dry land they have no opinion
      if (k.behaviour === 'circle') continue;
      const worst = meet(id, k.herd[1], 40);
      expect(worst.died, `a ${id} pack empties ten hearts in ${worst.died.toFixed(2)}s`)
        .toBeGreaterThan(NEVER_FASTER_THAN);
    }
  });

  it('gives a beginner four goes at it for anything they can meet in their first hour', () => {
    for (const id of EARLY) {
      const worst = meet(id, KINDS[id].herd[1], 40);
      expect(worst.died, `a ${id} pack empties ten hearts in ${worst.died.toFixed(2)}s`)
        .toBeGreaterThan(EARLY_FLOOR);
    }
  });

  it('cannot be got round by piling more of them on, because reeling is the ceiling', () => {
    // four roosts converging on one chamber is the worst a cave can arrange, and it is barely
    // worse than one roost. That ceiling is the only reason any swarm is survivable at all
    const one = meet('bat', KINDS.bat.herd[1], 40);
    const four = meet('bat', KINDS.bat.herd[1] * 4, 40);
    expect(four.died).toBeGreaterThan(NEVER_FASTER_THAN);
    expect(four.perBlow).toBe(one.perBlow);
  });

  it('lets a beginner walk away from everything in the starting area', () => {
    for (const id of EARLY) {
      // slower than the hero, so leaving is always an answer to it
      expect(KINDS[id].speed, `a ${id} is not slower than the hero`).toBeLessThan(KINDS.hero.speed);
      // one parting shot as they turn is fair; a second means the pack is keeping up
      const ran = meet(id, KINDS[id].herd[1], 40, REACTION);
      expect(ran.chased, `a ${id} pack keeps landing blows on somebody already running`)
        .toBeLessThanOrEqual(1);
      expect(ran.died, `a ${id} pack runs a fleeing hero down`).toBe(Infinity);
    }
  });

  it('gives a bat twice the hero’s pace to make up, which is a cave corner’s worth', () => {
    // a diving bat goes through the rock a corridor is made of, so the corridor is longer for
    // the hero than for the bat. Anything under about half and an ordinary zigzag cuts you off
    expect(KINDS.hero.speed / KINDS.bat.speed).toBeGreaterThan(2);
  });
});

describe('a stick', () => {
  it('sees off a bat roost, a cave rat and a wolf pack, which is the early game working', () => {
    for (const id of ['bat', 'rat', 'wolf']) {
      const won = fight(id, KINDS[id].herd[1], null);
      expect(won.won, `a stick loses to a ${id} pack`).toBe(true);
      expect(won.hearts, `a ${id} pack costs every heart there is`).toBeGreaterThan(0);
    }
  });

  it('costs you something on the way, so it is a fight and not a formality', () => {
    expect(fight('rat', KINDS.rat.herd[1], null).hearts).toBeLessThan(10);
  });
});

describe('the things that are meant to be a bad idea', () => {
  it('makes a bear cost a beginner more than half of themselves', () => {
    const stick = fight('bear', 1, null);
    // winnable, and not worth winning: six of ten hearts for twenty-five gold, alone in a wood
    expect(stick.hearts, 'a bear is cheap with a stick').toBeLessThanOrEqual(10 / 2);
    // and a real weapon changes the argument twice over, because a drawn sword is also what
    // makes a prowler decide you are not worth it
    const sword = fight('bear', 1, 'sword');
    expect(sword.hearts).toBeGreaterThan(stick.hearts);
  });

  it('has a troll beat a stick, and take a fifth of you every time it lands', () => {
    expect(fight('troll', 1, null).won, 'a three-floor vault ends in a fight a stick wins').toBe(false);
    // it is a fight you come back to with a weapon, which is the whole shape of the thing
    expect(fight('troll', 1, 'steelsword').won, 'nothing wins it').toBe(true);
    expect(meet('troll', 1, 20).perBlow).toBeGreaterThanOrEqual(3);
  });

  it('keeps them out of the way of wherever a beginner actually goes', () => {
    // a cave is always floor one, so this is the table an hour-one cave mouth draws from
    const shallow = dungeonMonsters(1).map((w) => w.kind);
    expect(shallow).not.toContain('skeleton');
    expect(shallow).not.toContain('troll');
    expect(dungeonMonsters(2).map((w) => w.kind)).toContain('skeleton');
    // and nothing in it hits for more than one heart past the kit a beginner is standing in
    for (const w of dungeonMonsters(1)) expect(KINDS[w.kind].dangerous ?? 0).toBeLessThanOrEqual(1);
  });

  it('still leaves the deep end harder than the shallow one', () => {
    const bite = (list: readonly { kind: string }[]) =>
      Math.max(...list.map((w) => KINDS[w.kind].dangerous ?? 0));
    expect(bite(dungeonMonsters(3))).toBeGreaterThan(bite(dungeonMonsters(1)));
    expect(dungeonMonsters(9)).toEqual(dungeonMonsters(3));
  });
});
