import { describe, expect, it } from 'vitest';
import villagers from '../../behaviours/villagers.json';
import { compileAll, type BehaviourFile } from '../core/behaviourFile';
import { mulberry32 } from '../core/rng';
import { DTile, generateDungeon, type DungeonMap } from '../dungeon/generate';
import { DungeonWorld } from '../dungeon/world';
import { KINDS } from '../entities/animals';
import { treeFor, tradeTree } from '../entities/behaviours';
import { Entity, Herd, canStand, updateEntity } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { Roster } from '../entities/roster';
import { CREATURE_VERBS, rollSeconds } from '../entities/verbs';
import { Register } from '../world/register';
import { CREW, facesIn, putTheCrewToWork, type Workings } from './crews';
import { Mines, mineIdOf, type Working } from './mines';

/**
 * A mine you can walk into and watch being worked.
 *
 * The ledger has always been right about this — a crew goes down every morning, the gold is shared
 * among them to the coin, one of them is occasionally not there at the end of it — and until now
 * none of it was ever drawn, so the tunnels the whole economy comes out of stood empty. These are
 * claims about the people who are supposed to be in them: that they are the ones the register
 * names, that they are at the rock and not in it, and that they are in the same corners every time
 * anybody looks.
 *
 * Everything here calls the function directly rather than through `places.enterDungeon`, which
 * belongs to somebody else this week. The one line that joins the two is in `docs/worklist.md`.
 */

const CAVE = { id: 'cave:10,10', name: 'Bat Hollow', x: 10, z: 10 };
const MINE = mineIdOf(CAVE);
/** One seed for the cave and for the crew's places in it, the way an anchor hands out one. */
const SEED = 4242;

const working = (village = 'Ashford'): Working =>
  ({ village, mine: MINE, name: CAVE.name, x: CAVE.x, z: CAVE.z, heardIn: [village] });

/** A village where everybody grown is underground, so a crew is never nought by accident. */
const village = (seed = 1): Register => {
  const register = new Register(seed);
  register.settle('Ashford', 6, ['miner']);
  register.settle('Thinby', 4, ['farmer']);
  return register;
};

const holeUnder = (seed = SEED): DungeonMap => generateDungeon(seed, 'cave', 1);

/**
 * Somewhere to put bodies that is not a game: it makes the same entity the manager would and
 * remembers what it was asked for, so the placing can be checked without a renderer in the room.
 */
function bench(): Workings & { made: Entity[] } {
  const made: Entity[] = [];
  return {
    made,
    spawnPack(kindId: string, x: number, z: number, _radius: number, seed: number): Entity[] {
      const kind = KINDS[kindId];
      const herd = new Herd(kind, x, z, x, z, 12);
      const e = new Entity(kind, x, z, herd, 'dungeon', mulberry32(seed));
      herd.members.push(e);
      made.push(e);
      return [e];
    },
  };
}

/** Where somebody is, to the tile, for comparing one visit with the next. */
const spots = (crew: readonly Entity[]): string[] =>
  crew.map((e) => `${e.name} at ${e.x.toFixed(2)},${e.z.toFixed(2)} facing ${e.yaw.toFixed(3)}`);

/** The four sides of a tile, as the placing itself counts them. */
const AROUND: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const tileAt = (map: DungeonMap, x: number, z: number): DTile =>
  (x < 0 || z < 0 || x >= map.size || z >= map.size ? DTile.Rock : map.tiles[z * map.size + x] as DTile);

describe('who is down a mine', () => {
  it('is the people the register says went down, and not a fresh set of lookalikes', () => {
    const register = village();
    const mines = new Mines(SEED, 1);
    const crew = mines.whoIsDown(MINE, [working()], (v) => register.living(v));

    expect(crew.length, 'a village of miners has nobody underground').toBeGreaterThan(1);
    // the same people the day's takings are shared among, which is the whole point: a crew that
    // was rolled up on the spot would be four strangers standing where four men are being paid
    expect(crew.every((p) => p.trade === 'miner')).toBe(true);
    expect(crew.map((p) => p.id))
      .toEqual(register.living('Ashford').filter((p) => p.trade === 'miner').map((p) => p.id));
  });

  it('is nobody at all in a hole no village works', () => {
    const register = village();
    const mines = new Mines(SEED, 1);
    expect(
      mines.whoIsDown('cave:nobody-goes-there', [working()], (v) => register.living(v)),
      'a shrine nobody has ever cut a seam in has a crew in it',
    ).toEqual([]);
  });

  it('is nobody in a village that has no miners in it', () => {
    const register = village();
    const mines = new Mines(SEED, 1);
    expect(
      mines.whoIsDown(MINE, [working('Thinby')], (v) => register.living(v)),
      'a village of farmers has sent somebody down a mine',
    ).toEqual([]);
  });

  it('is nobody in a mine the village is too frightened to go near', () => {
    const register = village();
    // the same fear the place is described by, so what the village says and what you find agree
    const feared = Mines.from(SEED, { day: 1, mines: [{ id: MINE, worked: 0, dread: 0.9, cleared: 0 }] });
    expect(feared.saidOf(MINE)).toContain('Nobody');
    expect(
      feared.whoIsDown(MINE, [working()], (v) => register.living(v)),
      'the village swears nobody will go down there, and there they are',
    ).toEqual([]);
  });

  it('is not the man the mine swallowed, the morning after it did', () => {
    const register = village();
    const mines = new Mines(SEED, 1);
    const before = mines.whoIsDown(MINE, [working()], (v) => register.living(v));
    const lost = before[0];

    register.bury(lost.id, 5);
    const after = mines.whoIsDown(MINE, [working()], (v) => register.living(v));
    expect(after.map((p) => p.id), `${lost.name} is dead and still at the face`).not.toContain(lost.id);
    expect(after).toHaveLength(before.length - 1);
  });
});

describe('where a crew stands in the workings', () => {
  it('puts every one of them at rock, not in the middle of a room', () => {
    const map = holeUnder();
    const faces = facesIn(map, 6, SEED);
    expect(faces.length, 'a cave with sixteen rooms in it has no corners to cut').toBe(6);

    for (const face of faces) {
      const x = Math.floor(face.x), z = Math.floor(face.z);
      const rock = AROUND.filter(([dx, dz]) => tileAt(map, x + dx, z + dz) === DTile.Rock).length;
      expect(rock, `the man at ${x},${z} is standing in the open with nothing to cut`)
        .toBeGreaterThanOrEqual(CREW.CUT_INTO);
    }
  });

  it('turns each of them to face the rock, because a miner with his back to the seam is scenery', () => {
    const map = holeUnder();
    for (const face of facesIn(map, 6, SEED)) {
      const x = Math.floor(face.x), z = Math.floor(face.z);
      // the way he is looking, rounded to the tile it lands in
      const ax = Math.round(Math.cos(face.yaw)), az = Math.round(-Math.sin(face.yaw));
      expect(tileAt(map, x + ax, z + az), `the man at ${x},${z} is facing open floor`).toBe(DTile.Rock);
    }
  });

  it('keeps them off the steps you come in on', () => {
    const map = holeUnder();
    const [ex, ez] = map.entrance;
    for (const face of facesIn(map, 6, SEED)) {
      expect(
        Math.hypot(face.x - (ex + 0.5), face.z - (ez + 0.5)),
        'somebody is working the tile the hero arrives on',
      ).toBeGreaterThanOrEqual(CREW.CLEAR_OF_STAIRS);
    }
  });

  it('keeps them out of each other, so nothing spends the afternoon shoving', () => {
    const map = holeUnder();
    const faces = facesIn(map, 6, SEED);
    for (let a = 0; a < faces.length; a++) {
      for (let b = a + 1; b < faces.length; b++) {
        expect(
          Math.hypot(faces[a].x - faces[b].x, faces[a].z - faces[b].z),
          'two of them are standing in the same corner',
        ).toBeGreaterThan(1.4);
      }
    }
  });

  it('seats the same men in the same corners every time anybody walks in', () => {
    const register = village();
    const mines = new Mines(SEED, 1);
    const crew = mines.whoIsDown(MINE, [working()], (v) => register.living(v));

    const once = bench();
    const twice = bench();
    putTheCrewToWork(once, holeUnder(), crew, SEED);
    putTheCrewToWork(twice, holeUnder(), crew, SEED);
    expect(spots(twice.made), 'the crew moved between one visit and the next').toEqual(spots(once.made));
  });

  it('lays a different hole out differently, so two mines are not one mine twice', () => {
    const here = facesIn(holeUnder(SEED), 6, SEED);
    const there = facesIn(holeUnder(SEED + 1), 6, SEED + 1);
    expect(there.map((f) => `${f.x},${f.z}`)).not.toEqual(here.map((f) => `${f.x},${f.z}`));
  });

  it('asks for nobody when there is nobody to ask for', () => {
    const empty = bench();
    expect(putTheCrewToWork(empty, holeUnder(), [], SEED)).toEqual([]);
    expect(empty.made, 'a mine nobody works has bodies in it').toHaveLength(0);
  });
});

describe('the crew, put into a real hole in the ground', () => {
  const register = village();
  const map = holeUnder();
  const world = new DungeonWorld(map, MINE, 'cave');
  const mines = new Mines(SEED, 1);
  const crew = mines.whoIsDown(MINE, [working()], (v) => register.living(v));
  // the manager the game builds for a floor, with a list standing in for the renderer
  const manager = new EntityManager(new Roster(), world, { getTiles: () => null }, SEED);
  const put = putTheCrewToWork(manager, map, crew, SEED);

  it('is the whole crew and nobody else', () => {
    expect(put, 'somebody the register named never reached the face').toHaveLength(crew.length);
    expect(put.map((e) => e.person)).toEqual(crew.map((p) => p.id));
    expect(put.map((e) => e.name)).toEqual(crew.map((p) => p.name));
  });

  it('leaves nobody standing in rock', () => {
    for (const e of put) {
      expect(world.tile(e.x, e.z), `${e.name} is inside the wall at ${e.x},${e.z}`).toBe(DTile.Floor);
      expect(canStand(world, e.kind, e.x, e.z), `${e.name} is somewhere a body cannot be`).toBe(true);
      expect(world.heightAt(e.x, e.z)).not.toBeNull();
    }
  });

  it('makes each of them somebody the village can be asked about', () => {
    for (const e of put) {
      // the id is what `talk.ts` reads the person back off the register with, which is what gives
      // him a family, a purse and something to say about how the seam has been going
      expect(register.find(e.person)?.village).toBe('Ashford');
      expect(e.herd.tag).toBe('Ashford');
      expect(e.role).toBe('villager');
    }
  });

  it('gives each of them the cut he is working as the place he belongs', () => {
    for (const e of put) {
      const post = e.posts.work;
      expect(post, `${e.name} has nowhere to go back to`).toBeDefined();
      expect(Math.hypot(post![0] - e.x, post![1] - e.z)).toBeLessThan(0.01);
    }
  });
});

describe('a shift at the face', () => {
  it('is a day the game knows how to run, without anybody wiring it up', () => {
    // what `treeFor` does with the entity as it is built, which is the only wiring that matters
    expect(tradeTree('facework'), 'nobody knows how to work a rock face').not.toBeNull();
    expect(treeFor({ trade: 'facework', kind: { id: 'villager', behaviour: 'wander' } }))
      .toBe(tradeTree('facework'));
    /*
     * And a miner standing in a village street is not at a rock face.
     *
     * This asserted that a miner had no tree at all, which was true when it was written and was
     * guarding the right mistake: give the `miner` trade the `facework` day and every miner in the
     * country stands outside his own front door swinging a pick at the grass. He has a surface day
     * of his own now — up to the high ground at first light, home at dusk — so the guard is that
     * the two days are different, which is what it was always about.
     */
    expect(tradeTree('miner'), 'a miner has no day above ground').not.toBeNull();
    expect(tradeTree('miner'), 'a village miner has quietly been given a pick and a rock face')
      .not.toBe(tradeTree('facework'));
  });

  it('swings, over and over, and stays where it was put', () => {
    const register = village();
    const map = holeUnder();
    const world = new DungeonWorld(map, MINE, 'cave');
    const mines = new Mines(SEED, 1);
    const crew = mines.whoIsDown(MINE, [working()], (v) => register.living(v));
    const [man] = putTheCrewToWork(bench(), map, crew, SEED);
    const startedAt: [number, number] = [man.x, man.z];

    const trees = compileAll(villagers as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);
    const step = 1 / 30;
    let strokes = 0;
    let swinging = false;
    for (let t = 0; t < 8; t += step) {
      updateEntity(man, step, {
        world,
        rng: mulberry32(3),
        playerX: 999, playerZ: 999,        // the hero is nowhere near: this is work, not a fight
        playerArmed: false,
        time: 0.5,
        treeFor: () => trees.facework,
        onAttack: () => { throw new Error('a man at a face took a heart off somebody'); },
      });
      if (man.strike > 0 && !swinging) strokes++;
      swinging = man.strike > 0;
    }

    expect(strokes, 'eight seconds at the face and not one stroke thrown').toBeGreaterThan(3);
    // the nearest honest motion the game has: an arm over the top and down, which is what the
    // hero's sword does and what a pick does. There is no pick swing in animations/motion.json
    expect(man.blow).toBe('swing');
    expect(
      Math.hypot(man.x - startedAt[0], man.z - startedAt[1]),
      'he wandered off the seam he is supposed to be cutting',
    ).toBeLessThan(1);
  });
});

/**
 * A crew is one or two men, so where they stand decides whether anybody ever meets them.
 *
 * A village keeps one or two miners on purpose — the register was tuned that way after a version
 * that gave one village five out of twelve adults and made it, in its own comment, "a mine with a
 * village". So a crew is a man in sixteen rooms, and ranked by seam alone he stands wherever the
 * thickest rock happens to be: measured, 16, 12 and 21 tiles into a 56-tile map on three seeds. A
 * player walks in, meets rats, and leaves believing the workings are abandoned.
 */
describe('where a lone miner is put', () => {
  it('is somewhere a player walking in would pass', () => {
    for (const seed of [1, 5, 9]) {
      const map = generateDungeon(seed, 'cave', 1);
      const [ex, ez] = map.entrance;
      const one = facesIn(map, 1, seed)[0];
      expect(one, `seed ${seed} offered nowhere to work`).toBeTruthy();
      const away = Math.hypot(one.x - ex, one.z - ez);
      // measured after the ring ranking: 11, 12 and 7 against 16, 12 and 21 before it
      expect(away, `the only miner is ${away.toFixed(0)} tiles in, which is a mine that reads as empty`)
        .toBeLessThan(16);
    }
  });

  it('still puts him at a face worth cutting rather than the nearest wall', () => {
    // the ring is coarse on purpose: within one, the thickest seam still wins. A man at the first
    // scrap of wall inside the door would be standing in a doorway hitting a partition.
    const map = generateDungeon(5, 'cave', 1);
    const [ex, ez] = map.entrance;
    const one = facesIn(map, 1, 5)[0];
    expect(Math.hypot(one.x - ex, one.z - ez), 'he is standing on top of the stairs')
      .toBeGreaterThanOrEqual(CREW.CLEAR_OF_STAIRS);
  });
});
