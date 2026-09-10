import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { allTrees, specNamed } from '../entities/behaviours';
import { treeFor } from '../entities/behaviours';
import { Entity, Herd, updateHerd, type Ctx, type TileWorld } from '../entities/entity';
import { postsOf } from '../entities/villagers';
import { grewFromTheGround, homelandsOf } from '../entities/homeland';
import { ACTIVE_RANGE, SPAWN } from '../entities/spawning';
import { rangeIn, ringIn } from '../entities/timetable';
import { catchUp, type Away } from '../entities/unwatched';
import { samplerIn } from './endless';
import { Simplex2D } from './noise';
import { countryOf, faceAt } from './localmesh';
import {
  KEEP_READY, PROVINCE, PROVINCE_REACH, adjoins, provinceAt, provinceCorner, provinceOf,
  provinceOfHome, provincePath, provincesNear,
} from './provinces';

/**
 * Provinces are for what a world cannot work out again, and for nothing else.
 *
 * The distinction they have to keep is the one that decides whether an endless world holds together:
 * the country is *generated* by a bounded neighbourhood and knows nothing about these lines, while
 * the state people leave behind is *kept* inside them. If the two ever run together — a face that
 * stops at a border, a road that changes when a province is loaded — the world has a seam, and a
 * seam is two halves of a village facing each other across a line neither can cross.
 *
 * So the tests are of both halves of that: the arithmetic of the grid, and the country's blank
 * indifference to it.
 */
describe('the province a place is in', () => {
  it('is the same place asked for twice, and its own corner is inside it', () => {
    for (const [x, z] of [[0, 0], [511, 511], [512, 512], [-1, -1], [-513, 900], [12345.6, -7890.1]]) {
      const id = provinceOf(x, z);
      expect(provinceOf(x, z), 'a place moved province between two questions').toBe(id);
      const corner = provinceCorner(id);
      expect(provinceOf(corner.x, corner.z), `${id} does not contain its own corner`).toBe(id);
      expect(x - corner.x, `${x} is outside ${id}`).toBeGreaterThanOrEqual(0);
      expect(x - corner.x).toBeLessThan(PROVINCE);
      expect(z - corner.z).toBeGreaterThanOrEqual(0);
      expect(z - corner.z).toBeLessThan(PROVINCE);
    }
  });

  it('goes on into country nobody has been to', () => {
    // an endless world has no middle and no edge, so neither has the grid over it
    expect(provinceOf(1e6, -1e6)).toBe('1953:-1954');
    expect(provinceAt(provinceOf(1e6, -1e6))).toEqual({ px: 1953, pz: -1954 });
    expect(provinceOf(-0.001, -0.001), 'the wrong side of nought').toBe('-1:-1');
  });

  it('reaches the neighbours a walker is about to need', () => {
    // standing on a border: the ready list has to hold both sides, or walking over the line is a
    // field that looks bare until its leavings are read
    const onTheLine = provincesNear(PROVINCE, PROVINCE, KEEP_READY);
    expect(onTheLine).toContain('1:1');
    expect(onTheLine).toContain('0:0');
    expect(onTheLine).toContain('0:1');
    expect(onTheLine).toContain('1:0');
    // and in the middle of one, only that one
    expect(provincesNear(PROVINCE / 2, PROVINCE / 2, KEEP_READY)).toEqual(['0:0']);
  });

  it('has a file of its own, under the world it belongs to', () => {
    expect(provincePath('worlds', 3, '2:-1')).toBe('worlds/3/2_-1.json');
    // the same province of two different worlds is two different files, or one seed's leavings
    // would turn up in another's
    expect(provincePath('worlds', 4, '2:-1')).not.toBe(provincePath('worlds', 3, '2:-1'));
  });
});

describe('the country, which knows nothing about any of this', () => {
  const shape = new Simplex2D(4242);
  const world = countryOf(4242, (x, z) => (shape.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 6, far: 14, tries: 6 });

  it('does not stop at a province border', () => {
    // walk straight across a border and check the faces either side are ordinary neighbours: a
    // country that noticed the line would have a face that ends on it
    const border = PROVINCE;
    let crossed = 0;
    for (let z = 100; z < 400; z += 37) {
      const before = faceAt(world, border - 6, z);
      const after = faceAt(world, border + 6, z);
      expect(before, 'no country west of the border').toBeTruthy();
      expect(after, 'no country east of the border').toBeTruthy();
      if (before!.id === after!.id) crossed++;                   // one face lying across the line
      else if (before!.neighbours.includes(after!.id)) crossed++; // or two that border each other
    }
    expect(crossed, 'the country changes at a province border').toBeGreaterThan(5);
  });

  it('gives the same face on both sides of the line, asked from either province', () => {
    // the face that straddles the border, asked for from ground in one province and then the other
    for (let z = 120; z < 300; z += 41) {
      const west = faceAt(world, PROVINCE - 2, z);
      const east = faceAt(world, PROVINCE + 2, z);
      if (!west || !east || west.id !== east.id) continue;       // not a straddling face; try the next
      expect(west.corners.map((c) => `${c.x.toFixed(6)},${c.z.toFixed(6)}`))
        .toEqual(east.corners.map((c) => `${c.x.toFixed(6)},${c.z.toFixed(6)}`));
      expect(west.neighbours).toEqual(east.neighbours);
    }
  });
});

/**
 * An agent belongs to one province — and nothing walks from one to another.
 *
 * The claim is short enough to say in a sentence and load-bearing enough to be worth this many
 * checks: every agent in this world is exactly one province's business for its whole life. That is
 * what lets a province be something a machine can pick up on its own. A wolf halfway across a
 * border means two provinces are alive for as long as the walk lasts and neither can be caught up
 * without the other — and it is also why a behaviour's long-run effect can be written down at all,
 * since a closed form is no use for an agent that might be anywhere by the end of it.
 *
 * It is checked the way the endless country was: not by asserting that the code does what it does,
 * but by standing the fault right on the line and looking. Every herd below is anchored against a
 * border or on the corner where four provinces meet, because a rule about borders tested only in
 * the middle of a square is not tested.
 *
 * Three things have to hold, and each has a failure of its own:
 *
 *  - **Never both.** A herd two provinces answer for is one wolf's week accounted for twice.
 *  - **Never neither.** A herd nothing claims is a field that has stood still since anybody looked.
 *  - **Never far.** Belonging to a province is not staying inside it — a wolf that vanished at an
 *    invisible line would be worse than anything this fixes — so what is held is that the overhang
 *    is bounded by `PROVINCE_REACH`, and that the bound is worth the name at both of its ends.
 */

/** Flat, dry, walkable and roaded everywhere: ground that never refuses anybody. */
const anywhere: TileWorld = {
  heightAt: () => 1,
  waterAt: () => 0.3,
  blocked: () => false,
  isRoad: () => true,
};

/** Nobody within a thousand tiles, which is the only condition any of this is asked under. */
const alone = (seed: number): Ctx => ({
  world: anywhere, rng: mulberry32(seed), playerX: 1e6, playerZ: 1e6,
  playerArmed: false, playerAfloat: false, treeFor, time: 0.5, onAttack: () => {},
});

/**
 * The longest string the game ever puts a herd on, out of the dials rather than off a note here.
 *
 * A traveller's, and why it is long is written beside it in `properties/spawning.json`: a road
 * nobody is ever on is scenery. Read back rather than copied, so lengthening it is caught here and
 * not a year later by somebody wondering why a carter belongs to the wrong square.
 */
const LONGEST_LEASH = Math.max(
  SPAWN.HERD_LEASH, SPAWN.NIGHT_LEASH, SPAWN.WATER_LEASH, SPAWN.DEEP_LEASH,
  SPAWN.TRAVELLER_LEASH, SPAWN.CONGREGATION_LEASH, SPAWN.SHOPKEEPER_LEASH,
);

/** And the furthest any tree in the game lets something range about the anchor it is given. */
const WIDEST_RANGE = Object.keys(allTrees()).reduce((worst, name) => {
  const spec = specNamed(name);
  if (!spec) return worst;
  const ring = ringIn(spec);
  return Math.max(worst, rangeIn(spec) ?? 0, Number.isNaN(ring) ? 0 : ring);
}, 0);

/** A herd of a kind, anchored on a home, with `count` of them standing about it. */
function herdAt(kindId: string, x: number, z: number, count: number, seed: number, key = '0,0'): Herd {
  const kind = KINDS[kindId];
  const herd = new Herd(kind, x, z, x, z, LONGEST_LEASH);
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const e = new Entity(kind, x + (rng() - 0.5), z + (rng() - 0.5), herd, key, rng);
    e.y = 1;
    e.slot = i;
    herd.members.push(e);
  }
  return herd;
}

/** A week, which is longer than any absence the closed forms behave differently over. */
const WEEK: Away = { seconds: 7 * 24 * 60 * 60, time: 0.5, seed: 4242, ground: anywhere };

/** The corner where four provinces meet: the worst place in the world to stand anything. */
const CORNER = PROVINCE;

/** A patch of a real country, for measuring the villages a world actually builds. */
const COUNTRY = 4242;
const PATCH = { x0: 0, z0: 0, x1: 512, z1: 512 };

describe('an agent belongs to one province', () => {
  it('belongs to the province of a home that cannot move', () => {
    // four tiles inside 0:0 and hard against the line, on the longest leash the game hands out, so
    // the anchor spends a good deal of its life the wrong side of the border
    const herd = herdAt('sheep', PROVINCE - 4, PROVINCE - 4, 4, 991);
    expect(provinceOfHome(herd), 'a herd on the line is not in the square its home is in').toBe('0:0');

    const ctx = alone(991);
    let strayed = 0;
    for (let step = 0; step < 3000; step++) {
      updateHerd(herd, 1, ctx);
      if (provinceOf(herd.ax, herd.az) !== '0:0') strayed++;
      expect(provinceOfHome(herd), `the answer moved on step ${step}`).toBe('0:0');
    }
    // and this only proves anything if the anchor really did cross: without it the test would pass
    // just as happily against a herd that never left the middle of its own square
    expect(strayed, 'the anchor never once left its own province, so nothing was proved')
      .toBeGreaterThan(50);
  });

  it('gives a province to what the ground grew, and to nothing else', () => {
    expect(grewFromTheGround('3,-4'), 'a chunk key is a piece of ground').toBe(true);
    expect(grewFromTheGround('0,0')).toBe(true);
    for (const place of ['dungeon', 'sea', 'the-mine', 'band:Grimsdale:2']) {
      expect(grewFromTheGround(place), `${place} is a place, not a square of country`).toBe(false);
    }

    // The trap said plainly: a rat on a floor and a sheep in a field, standing on the same two
    // numbers. `provinceOf` would file them together, because a dungeon's coordinates are its own
    // and say nothing about the country overhead. The filing knows better.
    const field = herdAt('sheep', 40, 40, 3, 1, '2,2');
    const floor = herdAt('rat', 40, 40, 3, 2, 'dungeon');
    const water = herdAt('shark', 40, 40, 2, 3, 'sea');
    const filed = new Map<string, Entity[]>([
      ['2,2', field.members], ['dungeon', floor.members], ['sea', water.members],
    ]);
    const homelands = homelandsOf(filed);
    expect([...homelands.keys()], 'a floor or a pack was given a square of country').toEqual(['0:0']);
    expect(homelands.get('0:0'), 'the herd in the field was not claimed exactly once').toEqual([field]);
  });

  it('is claimed by exactly one province, never both and never neither', () => {
    // a herd in every chunk along a stretch of border, so some are one side of it, some the other,
    // and one of them is in the chunk the line itself runs through
    const filed = new Map<string, Entity[]>();
    const herds: Herd[] = [];
    const middle = PROVINCE / 16;
    for (let cx = middle - 4; cx <= middle + 4; cx++) {
      for (let cz = middle - 1; cz <= middle + 1; cz++) {
        const key = `${cx},${cz}`;
        const herd = herdAt('sheep', cx * 16 + 8, cz * 16 + 8, 3, cx * 31 + cz, key);
        herds.push(herd);
        filed.set(key, herd.members);
      }
    }
    const claims = new Map<Herd, number>();
    for (const [, mine] of homelandsOf(filed)) {
      for (const herd of mine) claims.set(herd, (claims.get(herd) ?? 0) + 1);
    }
    for (const herd of herds) {
      expect(claims.get(herd), `the herd at ${herd.homeX},${herd.homeZ} is claimed by `
        + `${claims.get(herd) ?? 0} provinces rather than one`).toBe(1);
    }
    // and the stretch straddles the corner, so all four squares are represented: without this the
    // test would pass just as well over ground that never left one province
    expect([...homelandsOf(filed).keys()].sort(), 'the stretch of border fell inside one province')
      .toEqual(['0:0', '0:1', '1:0', '1:1']);
  });

  it('never lets a week alone take an agent out of the reach of the province that owns it', () => {
    // Every creature the game has, stood on the corner where four provinces meet and left for a
    // week, caught up by the closed forms rather than by ticks. This is the property C2 needs: a
    // behaviour's long-run effect cannot be written down for an agent that might be in any province
    // by the end of it, and what makes it writable is that none of them can be.
    const strays: string[] = [];
    for (const kindId of Object.keys(KINDS)) {
      const herd = herdAt(kindId, CORNER, CORNER, 5, kindId.length * 7717);
      const home = provinceOfHome(herd);
      catchUp(herd, WEEK);
      for (const e of herd.members) {
        const far = Math.hypot(e.x - herd.homeX, e.z - herd.homeZ);
        if (far > PROVINCE_REACH) strays.push(`${kindId} is ${far.toFixed(1)} tiles from home`);
        const now = provinceOf(e.x, e.z);
        if (!adjoins(home, now)) strays.push(`${kindId} is in ${now}, which does not touch ${home}`);
      }
      expect(provinceOfHome(herd), `${kindId} changed province over a week alone`).toBe(home);
    }
    expect(strays, `a week alone put agents outside the reach of their own province:\n  `
      + `${strays.join('\n  ')}`).toEqual([]);
  });

  it('is wide enough for the widest thing the game actually puts in a province', () => {
    // the floor of the window, out of the game's own dials and behaviour files rather than out of a
    // number written here: lengthen a leash or widen a wander and this is where it is caught
    expect(LONGEST_LEASH + WIDEST_RANGE, `a herd on a ${LONGEST_LEASH}-tile leash ranging `
      + `${WIDEST_RANGE} tiles about its anchor reaches further than a province will own`)
      .toBeLessThanOrEqual(PROVINCE_REACH);

    // and the one that actually binds: a villager, whose hours send him to posts standing well
    // outside the village and who then ranges about whichever one he was left at. Asked of the
    // villages of a real country, through the same `postsOf` the game lays them out with.
    const villages = samplerIn(COUNTRY, PATCH).structures.villages;
    expect(villages.length, 'no villages in the patch, so nothing was measured').toBeGreaterThan(0);
    let furthest = 0, worst = '';
    for (const v of villages) {
      for (const [x, z] of Object.values(postsOf(v, anywhere))) {
        const out = Math.hypot(x - v.x, z - v.z);
        if (out > furthest) { furthest = out; worst = `${v.name}, radius ${v.radius.toFixed(1)}`; }
      }
    }
    expect(furthest + WIDEST_RANGE, `a villager of ${worst} works ${furthest.toFixed(1)} tiles out `
      + `and ranges ${WIDEST_RANGE} about it, which is outside what his own province will own`)
      .toBeLessThanOrEqual(PROVINCE_REACH);
  });

  it('has the province that owns a creature to hand before anybody can see it', () => {
    // The ceiling of the window, and the reason a player crossing a border sees nothing. A creature
    // in front of somebody may be up to `PROVINCE_REACH` the wrong side of its own line, and the
    // province that owns it has to have been read before it comes into view — otherwise walking
    // towards a border means opening a file at the moment somebody can see over it, which is a sown
    // field that looks bare for a frame.
    expect(ACTIVE_RANGE + PROVINCE_REACH, 'a creature can be seen before its province is to hand')
      .toBeLessThanOrEqual(KEEP_READY);
    // and past half a province an agent could overhang a square that does not touch its own
    expect(PROVINCE_REACH, 'an agent could reach a province that does not touch its own')
      .toBeLessThan(PROVINCE / 2);

    // said as the walk rather than as the arithmetic, and over a corner so both axes are crossed
    for (let x = CORNER - 200; x <= CORNER + 200; x += 11) {
      const ready = new Set(provincesNear(x, CORNER, KEEP_READY));
      for (let ahead = -ACTIVE_RANGE; ahead <= ACTIVE_RANGE; ahead += 8) {
        for (const owner of provincesNear(x + ahead, CORNER, PROVINCE_REACH)) {
          expect(ready.has(owner), `standing at ${x},${CORNER}, a creature ${ahead} tiles off could `
            + `belong to ${owner}, whose leavings have not been read`).toBe(true);
        }
      }
    }
  });

  it('knows which provinces touch, negative country included', () => {
    expect(adjoins('0:0', '0:0'), 'a province does not touch itself').toBe(true);
    expect(adjoins('0:0', '1:1'), 'a corner is a touch').toBe(true);
    expect(adjoins('0:0', '-1:0')).toBe(true);
    expect(adjoins('0:0', '2:0'), 'two squares with one between them').toBe(false);
    expect(adjoins('-1:-1', '1:1')).toBe(false);
  });
});
