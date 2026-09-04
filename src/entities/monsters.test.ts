import { describe, expect, it } from 'vitest';
import file from '../../behaviours/monsters.json';
import type { Node } from '../core/behaviour';
import { compileAll, type BehaviourFile } from '../core/behaviourFile';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, canStand, type TileWorld, updateEntity } from './entity';
import { MONSTER, MONSTER_KINDS, canBeCut, type MonsterId } from './monsters';
import { CREATURE_VERBS, rollSeconds, type Mind } from './verbs';

/**
 * These are claims about a fight rather than about a data structure, so nearly all of them are
 * made by running the creature: a real entity, on real ground, against a hero who is standing
 * still or running for their life, driven by the same file the game ships.
 */

/** Open moor: flat, dry, and nothing in the way. */
const moor: TileWorld = {
  heightAt: () => 1,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

/** One terrace, west of the origin: the step the hero can take and most things cannot. */
const terrace: TileWorld = {
  heightAt: (x: number) => (x < 0 ? 1 : 0.5),
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const TREES = compileAll(file as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);
/** Each monster is driven by the tree named after it, which is the wiring the game does too. */
const treeFor = (e: Entity): Node<Mind> | null => TREES[e.kind.id] ?? null;

/** One of them, standing on its own ground `away` tiles east of the hero. */
function stand(id: MonsterId, away: number): Entity {
  const kind = MONSTER_KINDS[id];
  const herd = new Herd(kind, away, 0, away, 0, 20);
  const e = new Entity(kind, away, 0, herd, 'haunt', mulberry32(11));
  e.y = 1;
  herd.members.push(e);
  return e;
}

/**
 * Run it for a while against a hero at the origin who either stands and watches or runs due west
 * at their own flat-out pace. Reports what it managed to do about that.
 */
function meet(e: Entity, seconds: number, opts: { time: number; running: boolean }) {
  const bites: number[] = [];
  const step = 1 / 30;
  const opened = Math.hypot(e.x, e.z);
  let heroX = 0;
  for (let t = 0; t < seconds; t += step) {
    updateEntity(e, step, {
      world: moor,
      rng: mulberry32(Math.floor(t * 1000) + 1),
      playerX: heroX, playerZ: 0,
      playerArmed: true, playerAfloat: false,
      time: opts.time, treeFor,
      onAttack: (_who, damage) => bites.push(damage),
    });
    if (opts.running) heroX -= KINDS.hero.runSpeed * step;
  }
  return { bites, opened, closed: Math.hypot(e.x - heroX, e.z), moved: Math.abs(e.x - opened) };
}

describe('the ogre', () => {
  it('is slower than the hero, coming or ambling, so leaving is always on the table', () => {
    expect(MONSTER_KINDS.ogre.runSpeed).toBeLessThan(KINDS.hero.runSpeed);
    // one pace, and it is the same one whether it has seen you or not
    expect(MONSTER_KINDS.ogre.speed).toBe(MONSTER_KINDS.ogre.runSpeed);
  });

  it('cannot catch a hero who turns and runs the moment they see it', () => {
    const e = stand('ogre', 12);
    const run = meet(e, 25, { time: 0.5, running: true });
    expect(run.bites).toEqual([]);
    expect(run.closed).toBeGreaterThan(run.opened);
  });

  it('catches a hero who stands and thinks about it, and hits like a falling tree', () => {
    const e = stand('ogre', 10);
    const run = meet(e, 25, { time: 0.5, running: false });
    expect(run.bites.length).toBeGreaterThan(0);
    for (const damage of run.bites) expect(damage).toBe(MONSTER.OGRE_HIT);
    // two of those out of ten hearts: standing still is not a plan, it is the start of one
    expect(MONSTER.OGRE_HIT * 2).toBeGreaterThanOrEqual(10 / 2);
  });

  it('cannot follow you up a terrace, because nothing gave it the hero\'s legs', () => {
    expect(canStand(terrace, MONSTER_KINDS.ogre, -1, 0, 0.5)).toBe(false);
    expect(canStand(terrace, KINDS.hero, -1, 0, 0.5)).toBe(true);
  });

  it('is a real fight for anybody who wants one, and worth having had', () => {
    expect(canBeCut(MONSTER_KINDS.ogre)).toBe(true);
    expect(MONSTER_KINDS.ogre.hp).toBe(MONSTER.OGRE_HP);
    expect(MONSTER_KINDS.ogre.hp!).toBeGreaterThan(KINDS.bear.hp!);
    expect(MONSTER_KINDS.ogre.gold![0]).toBeGreaterThan(0);
  });
});

describe('the wight', () => {
  it('is quicker than the hero, so running is not one of the answers to it', () => {
    expect(MONSTER_KINDS.wight.runSpeed).toBeGreaterThan(KINDS.hero.runSpeed);
    expect(MONSTER_KINDS.wight.speed).toBe(MONSTER_KINDS.wight.runSpeed);
  });

  it('is abroad at night and nowhere at all by day', () => {
    const night = stand('wight', 8);
    expect(meet(night, 12, { time: 0.95, running: false }).bites.length).toBeGreaterThan(0);

    const noon = stand('wight', 8);
    const day = meet(noon, 12, { time: 0.5, running: false });
    expect(day.bites).toEqual([]);
    expect(day.moved).toBeCloseTo(0);       // it does not so much as drift
  });

  it('closes on a hero who runs from it, which is the whole reason to carry a ward', () => {
    const e = stand('wight', 5);
    const run = meet(e, 30, { time: 0.95, running: true });
    expect(run.closed).toBeLessThan(run.opened);
    expect(run.bites.length).toBeGreaterThan(0);
  });

  it('has no hit points, so a swing looks for something to hurt and finds nothing', () => {
    // this is the whole of "a sword does not answer it": combat skips creatures without hp, so
    // the blade going through is the absence of a special case rather than one
    expect(MONSTER_KINDS.wight.hp).toBeUndefined();
    expect(canBeCut(MONSTER_KINDS.wight)).toBe(false);
    // and nothing you cannot kill has anything on it to take
    expect(MONSTER_KINDS.wight.gold).toBeUndefined();
    expect(MONSTER_KINDS.wight.drop).toBeUndefined();
  });

  it('says out loud what does and does not work on it', () => {
    const said = MONSTER_KINDS.wight.lines.join(' ');
    expect(said).toMatch(/blade/);
    expect(said).toMatch(/ground/);
  });
});

describe('the monster behaviour file', () => {
  it('compiles against the verbs the game declares, and nothing else', () => {
    expect(Object.keys(TREES).length).toBeGreaterThan(0);
    for (const tree of Object.values(TREES)) expect(typeof tree).toBe('function');
  });

  it('has a tree for every monster, named after the monster', () => {
    for (const id of Object.keys(MONSTER_KINDS)) {
      expect(TREES[id], `nothing decides for the ${id}`).toBeDefined();
    }
  });

  it('carries its notes, so a reader is told why rather than only what', () => {
    const noted = JSON.stringify(file).match(/"note"/g) ?? [];
    expect(noted.length).toBeGreaterThan(3);
  });
});

describe('both of them', () => {
  it('are creatures the pools already know how to draw', () => {
    for (const kind of Object.values(MONSTER_KINDS)) {
      expect(kind.parts.length).toBeGreaterThan(0);
      expect(kind.palettes.length).toBeGreaterThan(0);
      const wanted = Math.max(...kind.parts.map((p) => (p.tint ?? -1) + 1));
      for (const palette of kind.palettes) expect(palette.length).toBeGreaterThanOrEqual(wanted);
      expect(kind.names.length).toBeGreaterThan(0);
      expect(kind.lines.length).toBeGreaterThan(0);
    }
  });

  it('are not wildlife: nothing frightens them and they come alone', () => {
    for (const kind of Object.values(MONSTER_KINDS)) {
      expect(kind.timid).toBe(false);
      expect(kind.herd).toEqual([1, 1]);
      expect(kind.dangerous).toBeGreaterThan(0);
    }
  });
});
