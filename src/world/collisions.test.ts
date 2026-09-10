import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd, bodyOf, canStand, spaceNear, tryMove, type Crowd, type TileWorld } from '../entities/entity';
import { stride } from '../entities/stride';
import { propFootprints } from '../entities/props';
import { BLOCKS_WALKING, PropKind } from './biomes';
import { FURNITURE_BLOCKS, MIN_BLOCK, blocking } from './footprints';
import { Solids, boxesFrom, pointInBox } from './solids';
import { inTheWay } from './tiles';
import { propsOf, type PropAt } from './propstream';
import { CASTLE, generateCastle } from '../dungeon/castle';
import { floorThePlanOffers } from '../dungeon/castlefit';
import { reachable } from '../dungeon/map';
import { DungeonWorld } from '../dungeon/world';
import { generateWebGraph } from './roadweb';
import { TerrainSampler } from './terrain';

/**
 * A flat field, two things in it, and a question: what happens when one is walked into the other?
 *
 * Every collision fault this game has had was found by playing it and none by the tests, because
 * the tests asked whether the arithmetic was right and the faults were all somewhere else — a box
 * clipped at a chunk boundary, a step that jumped over what it should have hit, a bed blocked by
 * the tile it stood on, an arrow through a wall. Each one was obvious within a minute of walking
 * about and invisible to a thousand assertions.
 *
 * So this is the bench: bare ground, one thing that moves, one thing that does not, and the whole
 * cross of them — every mover against every solid, from eight directions, at three speeds, turned
 * three ways. It answers mechanically what used to need somebody driving a browser: does this pair
 * stop each other, does the stop happen where the thing is drawn, and can anything get inside
 * anything else.
 *
 * It is deliberately not a world. No terrain, no chunks, no server, no renderer: the field is flat
 * and the only things in it are the two under test, so a failure names the pair rather than the
 * afternoon.
 */

/**
 * What the run says about itself, printed at the end.
 *
 * The point of this bench is that a machine can answer "is the collision still right" without
 * anybody watching it happen. That only works if the run says what it covered as well as whether it
 * passed: a green suite that quietly stopped testing thirty creatures is worse than a red one.
 */
/**
 * One line of the account: a verdict, how many cases earned it, and what they were.
 *
 * Verdict first because that is the only thing a person reads at a glance, and the run is meant to
 * be readable by whoever picks it up out of a pipeline an hour later.
 */
interface Line {
  verdict: 'PASS' | 'TOUCHING' | 'INTERSECTED' | 'FAIL';
  count: number;
  what: string;
  detail?: string[];
}

const covered: Line[] = [];
const report = (line: Line): void => { covered.push(line); };

/** Where the run leaves its account of itself. Printed by `chore collisions`. */
const REPORT = 'collision-report.txt';

/**
 * What each `PropKind` is called, read out of the enum that defines them.
 *
 * `PropKind` is a `const enum`, which means it has no existence at run time: the numbers are
 * inlined and there is nothing to look a name up in. A report that says "prop 33" is a report
 * somebody has to decode, so the names are taken from the source of the enum itself — which cannot
 * drift from it, needs nothing kept in step, and is a thing only a test would do.
 */
function propNames(): Map<number, string> {
  const source = readFileSync('src/world/biomes.ts', 'utf8');
  const enumBody = source.slice(source.indexOf('export const enum PropKind {'));
  const names = new Map<number, string>();
  for (const [, name, value] of enumBody.slice(0, enumBody.indexOf('}')).matchAll(/(\w+)\s*=\s*(\d+)/g)) {
    names.set(Number(value), name);
  }
  return names;
}

const NAMES = propNames();
const nameOf = (kind: number): string => `${NAMES.get(kind) ?? 'prop'}(${kind})`;

/** Ground that goes on for ever at one height, with whatever has been put on it. */
function field(solids: Solids): TileWorld {
  return {
    heightAt: () => 1,
    waterAt: () => null,
    blocked: (x, z, body) => solids.at(x, z, body),
    // a road, because one creature in the game only walks on roads and would otherwise stand still
    // through every case below and pass them all by never moving
    isRoad: () => true,
    crosses: (x0, z0, x1, z1, body) => solids.crosses(x0, z0, x1, z1, body),
  };
}

/** One prop standing at the middle of the bench, turned as asked. */
function standing(kind: PropKind, rot: number, scale = 1): { world: TileWorld; box: { hw: number; hd: number } } {
  const stops = blocking(propFootprints(), new Set([kind]));
  const boxes = boxesFrom([{ kind, x: 0, z: 0, rot, scale }], stops);
  expect(boxes.length, `nothing solid is drawn for prop kind ${kind}`).toBe(1);
  const solids = new Solids();
  solids.put('bench', boxes);
  return { world: field(solids), box: { hw: boxes[0].hw, hd: boxes[0].hd } };
}

/** Somebody to walk into it. */
function walker(id: string, x: number, z: number): Entity {
  const kind = KINDS[id];
  expect(kind, `there is no creature called ${id}`).toBeTruthy();
  const e = new Entity(kind, x, z, new Herd(kind, x, z, x, z, 0), 'bench', mulberry32(1));
  e.y = 1;
  return e;
}

/** How far a box reaches along the world's axes once it is turned: the wall a walker meets. */
function reach(box: { hw: number; hd: number }, rot: number, dx: number, dz: number): number {
  // the box's own corners, turned into the world, projected onto the way we are coming from
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let most = 0;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const lx = sx * box.hw, lz = sz * box.hd;
    const wx = lx * cos - lz * sin, wz = lx * sin + lz * cos;
    most = Math.max(most, wx * dx + wz * dz);
  }
  return most;
}

/** The eight ways you can walk at something. */
const APPROACHES: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * The three speeds a step is taken at, and why each one is here.
 *
 * A frame at sixty is what most play looks like. A quarter of a second is the longest step the game
 * will take — a stutter, a chunk being built, a batch of steers arriving together — and it is what
 * `LONGEST_STEP` clamps to. And a courser is the fastest anything moves: pace three and a half for
 * a quarter of a second is 4.8 tiles in one go, which is a cottage and out the other side, and it
 * is the case that made walking through walls visible in the first place.
 */
const SPEEDS: Array<{ what: string; dt: number; pace: number }> = [
  { what: 'a frame at sixty', dt: 1 / 60, pace: 1 },
  { what: 'a quarter-second stutter', dt: 0.25, pace: 1 },
  { what: 'a courser at full gallop', dt: 0.25, pace: 3.5 },
];

/** Where somebody was, move by move. */
type Trace = Array<{ x: number; z: number }>;

/**
 * Walk somebody at a point until they stop getting anywhere, keeping every position on the way.
 *
 * The trace is the whole point. Asking where a walk *ended* misses the fault that matters most:
 * something that goes clean through a wall and out the far side ends up on open ground, having
 * passed through the thing it was supposed to hit, and looks from the outside exactly like
 * something that walked round it. Every move is kept so that every move can be asked about.
 *
 * The step count is worked out from how fast this one actually is rather than fixed, because the
 * bench holds a bear at 0.8 tiles a second and a hero at 5.5: a count that suits one of them has
 * the other still ambling across open ground when the test looks, which reads as "held off by
 * something" and is nothing of the kind.
 */
function walkAt(world: TileWorld, e: Entity, dx: number, dz: number, dt: number, pace: number): Trace {
  const far = Math.hypot(e.x, e.z) + 2;
  const perStep = Math.max(1e-6, e.kind.speed * pace * Math.min(dt, 0.25));
  const steps = Math.min(4000, Math.ceil((far / perStep) * 1.5) + 20);
  const trace: Trace = [{ x: e.x, z: e.z }];
  for (let n = 0; n < steps; n++) {
    const before = { x: e.x, z: e.z };
    stride(world, e, { dx, dz, pace, dt });
    trace.push({ x: e.x, z: e.z });
    if (Math.hypot(e.x - before.x, e.z - before.z) < 1e-4) break;
  }
  return trace;
}

/**
 * The bench's own answer to "did that move go through this box", owing nothing to the engine.
 *
 * Written here rather than borrowed from `solids.ts` on purpose: a test that checks the engine by
 * asking the engine agrees with itself by construction. This is the same slab clip stated
 * independently, and the two disagreeing is exactly the news worth having.
 *
 * The box is shrunk by a whisker first, because a walker held against a wall slides along its face
 * and every one of those moves lies exactly on the boundary. Touching a wall is what stopping looks
 * like; the fault is getting *into* it.
 */
const SKIN = 0.02;

function wentInto(box: { hw: number; hd: number }, rot: number, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const hw = box.hw - SKIN, hd = box.hd - SKIN;
  if (hw <= 0 || hd <= 0) return false;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const ax = from.x * cos - from.z * sin, az = from.x * sin + from.z * cos;
  const bx = to.x * cos - to.z * sin, bz = to.x * sin + to.z * cos;
  let lo = 0, hi = 1;
  for (const [start, end, half] of [[ax, bx, hw], [az, bz, hd]] as const) {
    const d = end - start;
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(start) > half) return false;
      continue;
    }
    const near = (-half - start) / d, far = (half - start) / d;
    lo = Math.max(lo, Math.min(near, far));
    hi = Math.min(hi, Math.max(near, far));
    if (lo > hi) return false;
  }
  return true;
}

/**
 * Did this walk ever get inside the thing it was walking at?
 *
 * Two ways of asking, and which one is right depends on whether the mover could have slid.
 *
 * A move that is refused outright is retried along each axis on its own, so a walker pressed into a
 * wall at an angle travels along it in a staircase of little slices. The straight line between two
 * recorded positions then cuts the corner the walker actually went round — the chord is not the
 * path, and testing the chord reports a wall-slide as a wall-crossing. Every one of the first
 * failures this bench produced was that, and the engine was right each time.
 *
 * Coming straight at a thing, sliding cannot happen: the sideways component is nought, so the
 * chord is the path and a segment test is exact. That is where the fault that matters most can be
 * caught — a step longer than the wall it is walking into, which ends up on clear ground the far
 * side and looks from the outside exactly like walking round.
 *
 * So: square on, the whole segment; at an angle, every position it was actually recorded at.
 *
 * A walk that starts inside something is a different case with its own tests, so it is skipped.
 */
function passedThrough(
  box: { hw: number; hd: number }, rot: number, trace: Trace, sliding: boolean,
): { at: number; from: { x: number; z: number }; to: { x: number; z: number } } | null {
  if (wentInto(box, rot, trace[0], trace[0])) return null;
  for (let n = 1; n < trace.length; n++) {
    const from = sliding ? trace[n] : trace[n - 1];
    if (wentInto(box, rot, from, trace[n])) return { at: n, from: trace[n - 1], to: trace[n] };
  }
  return null;
}

/** The four corners of a turned box, going round. */
function corners(box: { hw: number; hd: number }, x: number, z: number, rot: number): Array<[number, number]> {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([sx, sz]) => {
    const lx = sx * box.hw, lz = sz * box.hd;
    return [x + lx * cos - lz * sin, z + lx * sin + lz * cos] as [number, number];
  });
}

/**
 * How much of one turned box lies inside another, as a share of the first.
 *
 * Depth in tiles was the wrong measure and said so as soon as it was read: a tile of overlap is a
 * chicken swallowed whole and a horse resting its nose on something. What a person means by "those
 * two are inside each other" is how much of the thing is in there — a hundredth is what low-poly
 * models do when they stand next to each other, and a half is one sitting on the other.
 *
 * The overlap of two convex shapes is one clipped by the other, which for rectangles is four cuts
 * (Sutherland and Hodgman) and then the shoelace formula for what is left. Exact, thirty lines, and
 * no special cases.
 */
function overlapShare(
  a: { hw: number; hd: number }, ax: number, az: number, aRot: number,
  b: { hw: number; hd: number }, bx: number, bz: number, bRot: number,
): number {
  let shape = corners(a, ax, az, aRot);
  // cut it by each of the other box's four sides in turn
  const edges = corners(b, bx, bz, bRot);
  for (let i = 0; i < edges.length && shape.length > 0; i++) {
    const [x0, z0] = edges[i], [x1, z1] = edges[(i + 1) % edges.length];
    /*
     * Which side of this edge counts as in.
     *
     * A cross product says which side a point is on but not which side is which: that depends on
     * whether the corners go round clockwise or the other way, and getting it backwards clips
     * everything away and answers nought for every pair — a bench reporting no overlaps anywhere,
     * which is the most flattering bug it could have had. So the box's own middle settles it: the
     * middle of a box is inside the box.
     */
    const side = (p: [number, number]): number => (x1 - x0) * (p[1] - z0) - (z1 - z0) * (p[0] - x0);
    const facing = Math.sign(side([bx, bz])) || 1;
    const inside = (p: [number, number]): number => side(p) * facing;
    const clipped: Array<[number, number]> = [];
    for (let n = 0; n < shape.length; n++) {
      const here = shape[n], next = shape[(n + 1) % shape.length];
      const dHere = inside(here), dNext = inside(next);
      if (dHere >= 0) clipped.push(here);
      if ((dHere >= 0) !== (dNext >= 0)) {
        const t = dHere / (dHere - dNext);
        clipped.push([here[0] + (next[0] - here[0]) * t, here[1] + (next[1] - here[1]) * t]);
      }
    }
    shape = clipped;
  }
  if (shape.length < 3) return 0;
  let twiceArea = 0;
  for (let n = 0; n < shape.length; n++) {
    const [x0, z0] = shape[n], [x1, z1] = shape[(n + 1) % shape.length];
    twiceArea += x0 * z1 - x1 * z0;
  }
  const own = 4 * a.hw * a.hd;
  return Math.abs(twiceArea / 2) / own;
}

/**
 * What a pair did to each other: stood clear, grazed, or sat on one another.
 *
 * As a share of the mover rather than a distance, because that is the question being asked. A
 * hundredth of a body inside something is two low-poly models standing next to each other and looks
 * right; a fifth is a nose in a tree, which looks careless; a half is one thing sitting inside
 * another, which is the fault worth a name.
 */
const GRAZE = 0.01;
const SUNK = 0.2;

type Verdict = 'passed' | 'touching' | 'intersected';

function verdictOf(share: number): Verdict {
  if (share <= GRAZE) return 'passed';
  return share <= SUNK ? 'touching' : 'intersected';
}

/** Straight along an axis, where a refused move has nowhere to slide to. */
const squareOn = (dx: number, dz: number): boolean => dx === 0 || dz === 0;

/** The props worth putting on a bench, and what each of them is a case of. */
const SOLIDS: Array<{ what: string; kind: PropKind }> = [
  { what: 'a cottage, which is the big square case', kind: PropKind.HousePlains },
  { what: 'a market stall, which is longer than it is wide', kind: PropKind.Stall },
  { what: 'an oak, which is the round case', kind: PropKind.Oak },
  { what: 'a fence rail, which is thinner than a stride', kind: PropKind.Fence },
  { what: 'a signpost, which is thinner still', kind: PropKind.Sign },
  { what: 'a church, which is the biggest thing a village builds', kind: PropKind.ChurchPlains },
  // and the keep, which is the biggest solid object in the game: four and a half tiles across the
  // base, against a cottage's two and a half. A box that size is worth walking into from the
  // corners as well, because the bench sets a walker down five tiles out and on the diagonal that
  // is only half a tile clear of the stone — which is exactly where a footprint drawn a shade too
  // wide stops being a wall and starts being somewhere a horse is standing inside
  { what: 'a castle keep, which is the biggest solid thing in the game', kind: PropKind.CastleKeep },
];

/** And the things that walk into them, from the smallest to the one that is nearly two tiles long. */
const WALKERS = ['hero', 'wolf', 'chicken', 'horse'];

/**
 * Everything that walks, and everything solid, for the matrix of all of them against all of them.
 *
 * What is left out is left out for a reason rather than for time. Anything that flies is not
 * stopped by a fence and is not meant to be — `canStand` lets it over everything, which is what
 * makes a bird a bird — and anything that swims cannot stand on a field at all. Both have their own
 * cases at the end.
 */
const OVER_OR_THROUGH = new Set(['fly', 'swim', 'circle']);

const EVERY_MOVER = Object.entries(KINDS)
  .filter(([, kind]) => kind.speed > 0 && !OVER_OR_THROUGH.has(kind.behaviour))
  .map(([id]) => id);

/** Every prop that is meant to stop somebody, which is the list the world itself blocks on. */
const EVERY_SOLID = [...BLOCKS_WALKING].filter((kind) => propFootprints().get(kind) !== undefined);

/*
 * The measure has to be right before anything measured with it means anything. A silent nought
 * from a clipper with its corners the wrong way round reads exactly like a game with no overlaps
 * in it, which is the most flattering bug a bench could have.
 */
describe('the overlap measure itself', () => {
  const unit = { hw: 0.5, hd: 0.5 };

  it('is all of it when a box is on top of itself', () => {
    expect(overlapShare(unit, 0, 0, 0, unit, 0, 0, 0)).toBeCloseTo(1, 6);
  });

  it('is half when a box is half in', () => {
    expect(overlapShare(unit, 0, 0, 0, unit, 0.5, 0, 0)).toBeCloseTo(0.5, 6);
  });

  it('is a quarter when it is half in each way', () => {
    expect(overlapShare(unit, 0, 0, 0, unit, 0.5, 0.5, 0)).toBeCloseTo(0.25, 6);
  });

  it('is nothing when they are apart, and nothing when they merely touch', () => {
    expect(overlapShare(unit, 0, 0, 0, unit, 3, 0, 0)).toBe(0);
    expect(overlapShare(unit, 0, 0, 0, unit, 1, 0, 0)).toBeCloseTo(0, 6);
  });

  it('turns with the boxes', () => {
    // a square turned by a quarter is the same square, so the answer may not change
    expect(overlapShare(unit, 0, 0, Math.PI / 2, unit, 0.5, 0, Math.PI / 2)).toBeCloseTo(0.5, 6);
    // and a long box across a short one overlaps only where they cross
    const long = { hw: 2, hd: 0.25 }, across = { hw: 2, hd: 0.25 };
    expect(overlapShare(long, 0, 0, 0, across, 0, 0, Math.PI / 2)).toBeCloseTo(0.25 * 0.5 / (2 * 0.5), 6);
  });

  it('is a share of the mover, not of the thing it walked into', () => {
    const small = { hw: 0.25, hd: 0.25 }, big = { hw: 2, hd: 2 };
    expect(overlapShare(small, 0, 0, 0, big, 0, 0, 0), 'a small thing wholly inside a big one').toBeCloseTo(1, 6);
    expect(overlapShare(big, 0, 0, 0, small, 0, 0, 0), 'and the same pair the other way about')
      .toBeCloseTo((0.5 * 0.5) / (4 * 4), 6);
  });
});

describe('walking into things, on a bench with nothing else in it', () => {
  for (const { what, kind } of SOLIDS) {
    for (const rot of [0, Math.PI / 4, Math.PI / 2]) {
      it(`stops at ${what}, turned ${Math.round((rot * 180) / Math.PI)}°`, () => {
        const { world, box } = standing(kind, rot);
        const failures: string[] = [];
        for (const id of WALKERS) {
          for (const [dx, dz] of APPROACHES) {
            for (const { what: speed, dt, pace } of SPEEDS) {
              // start well clear, on the far side of whichever way we are walking
              const from = 5;
              const e = walker(id, -dx * from, -dz * from);
              const trace = walkAt(world, e, dx, dz, dt, pace);
              const through = passedThrough(box, rot, trace, !squareOn(dx, dz));
              // how far the box reaches back along the way we came, which is the wall we should meet
              // the wall, plus how far this body reaches back along the way it came — as it is
              // turned, because a wolf walking north meets the wall with its nose and not its ribs
              const wall = reach(box, rot, -dx, -dz) + reach(bodyOf(KINDS[id]), -e.yaw, -dx, -dz);
              const got = -(e.x * dx + e.z * dz);   // how far short of the middle we stopped
              const inside = through !== null;
              if (through) {
                failures.push(`${id} went through ${what} on move ${through.at} of ${trace.length}, `
                  + `${through.from.x.toFixed(2)},${through.from.z.toFixed(2)} to ${through.to.x.toFixed(2)},${through.to.z.toFixed(2)}, `
                  + `coming from ${dx},${dz} at ${speed}`);
              }
              // and not stopped by nothing: a stride short of the wall is as far as anybody should
              // be held off, and the sweep works in slices of a fifth of a tile
              if (!inside && got > wall + 0.45) {
                failures.push(`${id} stopped ${got.toFixed(2)} out from ${what} whose wall is at ${wall.toFixed(2)}, from ${dx},${dz} at ${speed}`);
              }
            }
          }
        }
        report({
          verdict: failures.length === 0 ? 'PASS' : 'FAIL',
          count: WALKERS.length * APPROACHES.length * SPEEDS.length,
          what: `${what}, turned ${Math.round((rot * 180) / Math.PI)}°, from eight sides at three speeds`,
          detail: failures.slice(0, 4),
        });
        expect(failures.slice(0, 6), `${failures.length} of ${WALKERS.length * APPROACHES.length * SPEEDS.length}`).toEqual([]);
      });
    }
  }
});

describe('the whole matrix: everything that walks, into everything solid', () => {
  it('stops, wherever it comes from', () => {
    expect(EVERY_MOVER.length, 'nothing to walk with').toBeGreaterThan(20);
    expect(EVERY_SOLID.length, 'nothing to walk into').toBeGreaterThan(30);
    const failures: string[] = [];
    const models: Record<Verdict, number> = { passed: 0, touching: 0, intersected: 0 };
    const sunk: Array<{ mover: string; into: PropKind; depth: number; from: string }> = [];
    let cases = 0;
    for (const kind of EVERY_SOLID) {
      const { world, box } = standing(kind, 0);
      for (const id of EVERY_MOVER) {
        for (const [dx, dz] of APPROACHES.slice(0, 4)) {
          cases++;
          const e = walker(id, -dx * 5, -dz * 5);
          const trace = walkAt(world, e, dx, dz, 1 / 60, 1);
          const through = passedThrough(box, 0, trace, !squareOn(dx, dz));
          if (through) {
            failures.push(`${id} went through prop ${kind} on move ${through.at}, `
              + `${through.from.x.toFixed(2)},${through.from.z.toFixed(2)} to ${through.to.x.toFixed(2)},${through.to.z.toFixed(2)}, from ${dx},${dz}`);
          }
          // and what the models did, which is a different question from what the points did
          const body = bodyOf(KINDS[id]);
          let worst = 0;
          for (const at of trace) worst = Math.max(worst, overlapShare(body, at.x, at.z, e.yaw, box, 0, 0, 0));
          const verdict = verdictOf(worst);
          models[verdict]++;
          if (verdict === 'intersected' && sunk.length < 200) {
            sunk.push({ mover: id, into: kind, depth: worst, from: `${dx},${dz}` });
          }
          const wall = reach(box, 0, -dx, -dz) + reach(bodyOf(KINDS[id]), -e.yaw, -dx, -dz);
          const got = -(e.x * dx + e.z * dz);
          if (got > wall + 0.45) failures.push(`${id} held ${got.toFixed(2)} off prop ${kind} whose wall is at ${wall.toFixed(2)}`);
        }
      }
    }
    const worst = [...sunk].sort((a, b) => b.depth - a.depth);
    report({
      verdict: failures.length === 0 ? 'PASS' : 'FAIL',
      count: cases,
      what: `every one of ${EVERY_MOVER.length} movers walked into every one of ${EVERY_SOLID.length} solids, from four sides`,
      detail: failures.slice(0, 4),
    });
    report({ verdict: 'PASS', count: models.passed, what: `of those, models with under ${GRAZE * 100}% of themselves inside what they stopped at` });
    report({ verdict: 'TOUCHING', count: models.touching, what: `models grazing it — up to ${SUNK * 100}% of themselves in` });
    report({
      verdict: 'INTERSECTED',
      count: models.intersected,
      what: `models with over ${SUNK * 100}% of themselves inside what they stopped at`,
      detail: worst.slice(0, 5).map((one) => `${one.mover} had ${(one.depth * 100).toFixed(0)}% of itself inside ${nameOf(one.into)}, walking from ${one.from}`),
    });
    /*
     * Nought, and it took three goes to get there.
     *
     * A walker was first asked about as a *point*: its middle met the wall and the model carried on
     * into the plaster — three thousand of these walks ended with the model inside the thing, a
     * bear over a tile deep into an oak. Then as a circle of its narrow half, which halved it and
     * could not do better, because a circle that fits a horse's width cannot fit its length.
     *
     * Now the model is asked about as the model: its own rectangle, turned the way it faces,
     * against the rectangle of whatever it is walking into. Nothing is inside anything.
     */
    // Nought, now that a model is collided as the box it is drawn as. It stays nought.
    expect(models.intersected, 'a model is standing inside something again').toBe(0);
    expect(models.touching, 'and models have started grazing what they stop at').toBe(0);
    expect(failures.slice(0, 8), `${failures.length} failures across ${cases} pairs`).toEqual([]);
  });

  it('and everything that flies goes over the lot of it, which is the rule for birds', () => {
    const flying = Object.entries(KINDS).filter(([, k]) => k.behaviour === 'fly').map(([id]) => id);
    expect(flying.length, 'no birds at all').toBeGreaterThan(0);
    const { world } = standing(PropKind.HousePlains, 0);
    for (const id of flying) {
      const e = walker(id, -6, 0);
      for (let n = 0; n < 400; n++) stride(world, e, { dx: 1, dz: 0, pace: 1, dt: 1 / 60 });
      expect(e.x, `a ${id} was stopped by a cottage it should have flown over`).toBeGreaterThan(2);
    }
  });
});

describe('two things that both move', () => {
  /** A crowd of exactly one other body, which is all a pair needs. */
  const crowdOf = (other: Entity): Crowd => ({
    occupied: (x, z, ignore) => {
      if (ignore === other) return false;
      const body = bodyOf(other.kind);
      const dx = x - other.x, dz = z - other.z;
      const cos = Math.cos(-other.yaw), sin = Math.sin(-other.yaw);
      const alongX = Math.abs(dx * cos - dz * sin), alongZ = Math.abs(dx * sin + dz * cos);
      return alongX < body.hw && alongZ < body.hd;
    },
  });

  it('cannot be walked through, whatever the pair', () => {
    const world = field(new Solids());
    const failures: string[] = [];
    for (const mover of EVERY_MOVER) {
      for (const still of EVERY_MOVER) {
        for (const [dx, dz] of APPROACHES.slice(0, 2)) {
          const target = walker(still, 0, 0);
          const e = walker(mover, -dx * 6, -dz * 6);
          const crowd = crowdOf(target);
          for (let n = 0; n < 400; n++) stride(world, e, { dx, dz, pace: 1, dt: 1 / 60 }, crowd);
          if (crowd.occupied(e.x, e.z, e)) {
            failures.push(`a ${mover} ended up standing inside a ${still}, coming from ${dx},${dz}`);
          }
        }
      }
    }
    report({
      verdict: failures.length === 0 ? 'PASS' : 'FAIL',
      count: EVERY_MOVER.length ** 2 * 2,
      what: 'every mover walked into every mover, from two sides',
      detail: failures.slice(0, 4),
    });
    expect(failures.slice(0, 6), `${failures.length} of ${EVERY_MOVER.length ** 2 * 2} pairs`).toEqual([]);
  });

  it('lets somebody already inside a body walk out of it', () => {
    const world = field(new Solids());
    const target = walker('horse', 0, 0);
    const e = walker('hero', 0.05, 0.05);
    const crowd = crowdOf(target);
    expect(crowd.occupied(e.x, e.z, e), 'the test did not start inside anything').toBe(true);
    for (let n = 0; n < 300; n++) stride(world, e, { dx: 1, dz: 0, pace: 1, dt: 1 / 60 }, crowd);
    expect(crowd.occupied(e.x, e.z, e), 'stuck inside another body for ever').toBe(false);
  });
});

describe('a thing put down inside another thing', () => {
  for (const { what, kind } of SOLIDS) {
    it(`can walk out of ${what}, and is not put there in the first place`, () => {
      const { world } = standing(kind, 0);
      // the middle of the prop, which is the worst place anything could be set down
      const clear = spaceNear(world, KINDS.hero, 0, 0);
      expect(clear, `nowhere to put anybody near ${what}`).toBeTruthy();
      expect(world.blocked(clear!.x, clear!.z), `put down inside ${what}`).toBe(false);

      const e = walker('hero', 0, 0);
      expect(world.blocked(e.x, e.z), 'the test did not start inside anything').toBe(true);
      for (let n = 0; n < 400; n++) stride(world, e, { dx: 1, dz: 0, pace: 1, dt: 1 / 60 });
      expect(world.blocked(e.x, e.z), `never got out of ${what}`).toBe(false);
    });
  }
});

describe('what a blow can reach across the bench', () => {
  for (const { what, kind } of SOLIDS) {
    it(`does not reach through ${what}`, () => {
      const { world, box } = standing(kind, 0);
      const past = Math.max(box.hw, box.hd) + 1;
      expect(inTheWay(world, -past, 0, past, 0), `swung through ${what}`).toBe(true);
      // and the same two points with the prop out of the way
      const open = field(new Solids());
      expect(inTheWay(open, -past, 0, past, 0), 'stopped by nothing at all').toBe(false);
      // standing inside it, a blow is not taken away: a hero on a stall must still be able to fight
      expect(inTheWay(world, 0, 0, past, 0), `helpless while standing in ${what}`).toBe(false);
    });
  }
});

describe('the ground itself', () => {
  it('holds anybody who is standing on nothing', () => {
    // a hole in the world rather than a prop in it: the other half of what stops a walker
    const hole: TileWorld = {
      heightAt: (x) => (x > 2 ? null : 1),
      waterAt: () => null,
      blocked: () => false,
      isRoad: () => false,
    };
    for (const id of WALKERS) {
      const e = walker(id, 0, 0);
      for (let n = 0; n < 300; n++) stride(hole, e, { dx: 1, dz: 0, pace: 1, dt: 1 / 60 });
      expect(canStand(hole, e.kind, e.x, e.z), `${id} walked off the edge of the world`).toBe(true);
      expect(e.x, `${id} walked out over nothing`).toBeLessThan(2.05);
    }
  });

  it('is not what stops anybody on open ground', () => {
    // the control for every case above: with nothing in the way, everybody crosses the bench
    const world = field(new Solids());
    for (const id of WALKERS) {
      const e = walker(id, -6, 0);
      walkAt(world, e, 1, 0, 1 / 60, 1);
      expect(e.x, `${id} was stopped by an empty field`).toBeGreaterThan(0);
    }
  });
});

/** The one thing `tryMove` promises that nothing above measures: a long step cannot skip a wall. */
describe('a step longer than the thing it is walking into', () => {
  it('is still stopped by it', () => {
    const { world, box } = standing(PropKind.Fence, 0);
    const thickness = Math.min(box.hw, box.hd) * 2;
    expect(thickness, 'a fence rail is not thin any more').toBeLessThan(0.9);
    const e = walker('hero', -3, 0);
    // one move the length of the whole bench, which is six times the rail's thickness
    tryMove(world, e, 6, 0);
    expect(world.blocked(e.x, e.z), 'ended up inside the rail').toBe(false);
    expect(e.x, 'stepped clean over a fence').toBeLessThan(0);
  });
});

/*
 * Indoors is the same bench with a different list of what stops you.
 *
 * How big a thing is, is a fact about its mesh; whether you can walk through it is a decision, and
 * the decision is different in different rooms — nothing blocks with a bed on a hillside and
 * indoors a bed is the thing you have been walking through. So the furniture gets the same
 * treatment as the trees.
 */
describe('the furniture of a room, against everything that walks', () => {
  const EVERY_STICK = [...FURNITURE_BLOCKS].filter((kind) => propFootprints().get(kind) !== undefined);

  it('stops whoever walks into it, from every side', () => {
    expect(EVERY_STICK.length, 'no furniture is solid at all').toBeGreaterThan(6);
    const failures: string[] = [];
    let cases = 0;
    for (const kind of EVERY_STICK) {
      const stops = blocking(propFootprints(), FURNITURE_BLOCKS);
      const solids = new Solids();
      solids.put('room', boxesFrom([{ kind, x: 0, z: 0, rot: 0 }], stops));
      const world = field(solids);
      const box = propFootprints().get(kind)!;
      for (const id of ['hero', 'villager', 'wolf']) {
        for (const [dx, dz] of APPROACHES.slice(0, 4)) {
          cases++;
          const e = walker(id, -dx * 4, -dz * 4);
          const through = passedThrough({ hw: Math.max(box.hw, MIN_BLOCK), hd: Math.max(box.hd, MIN_BLOCK) }, 0,
            walkAt(world, e, dx, dz, 1 / 60, 1), !squareOn(dx, dz));
          if (through) {
            failures.push(`${id} went through furniture ${kind} on move ${through.at}, `
              + `${through.from.x.toFixed(2)},${through.from.z.toFixed(2)} to ${through.to.x.toFixed(2)},${through.to.z.toFixed(2)}, from ${dx},${dz}`);
          }
          const wall = reach({ hw: Math.max(box.hw, MIN_BLOCK), hd: Math.max(box.hd, MIN_BLOCK) }, 0, -dx, -dz)
            + reach(bodyOf(KINDS[id]), -e.yaw, -dx, -dz);
          const got = -(e.x * dx + e.z * dz);
          if (got > wall + 0.45) failures.push(`${id} held ${got.toFixed(2)} off furniture ${kind}, whose edge is at ${wall.toFixed(2)}`);
        }
      }
    }
    report({
      verdict: failures.length === 0 ? 'PASS' : 'FAIL',
      count: cases,
      what: `three bodies walked into every one of ${EVERY_STICK.length} solid sticks of furniture`,
      detail: failures.slice(0, 4),
    });
    expect(failures.slice(0, 6), `${failures.length} of ${cases}`).toEqual([]);
  });

  it('and a bed is longer than the tile it stands on, which is the whole of that fault', () => {
    const bed = propFootprints().get(PropKind.Bed);
    expect(bed, 'a bed is not measured at all').toBeTruthy();
    expect(Math.max(bed!.hw, bed!.hd), 'a bed that fits inside one tile').toBeGreaterThan(0.5);
  });
});

describe('a dressed dungeon floor, which is furniture and walls together', () => {
  /**
   * The bench's answer to the fault this suite exists for, one floor down.
   *
   * Indoors a table stopped you and underground the identical table did not, because a dungeon's
   * furniture had never been measured — `DungeonWorld.blocked` knew about chests and nothing else.
   * A castle's great hall could be walked end to end as though it were furnished with photographs,
   * and that is why a chamber was only nine per cent furniture: a room full of things you walk
   * through looks worse than an empty one.
   *
   * Measured here rather than in `dungeon/`, because it is the same question this whole file asks
   * of everything else — can a body get through a thing it should not — and the answer has to come
   * from the same walk. What the castle's own tests keep is the other half: that the floor is still
   * finishable once the furniture is solid.
   */
  const FLOORS = [3, 11, 29].flatMap((seed) => [1, 3].map((floor) => ({ seed, floor })));

  it('stops whoever walks into what is standing in it', () => {
    const failures: string[] = [];
    let cases = 0, solid = 0;
    for (const { seed, floor } of FLOORS) {
      const map = generateCastle(seed, floor);
      const world = new DungeonWorld(map, 'bench', 'castle', propFootprints());
      world.unlocked = true;
      const sticks = map.furniture.filter((f) => FURNITURE_BLOCKS.has(f.kind) && propFootprints().get(f.kind));
      solid += sticks.length;
      // a handful per floor, spread through the list rather than the first few, which would be
      // whatever the dressing happened to lay out first
      for (let n = 0; n < sticks.length; n += Math.max(1, Math.floor(sticks.length / 24))) {
        const f = sticks[n];
        const box = propFootprints().get(f.kind)!;
        for (const [dx, dz] of APPROACHES.slice(0, 4)) {
          // only from a side with floor to walk over: a wall behind the barrel proves nothing
          const fromX = f.x + 0.5 - dx * 2.5, fromZ = f.z + 0.5 - dz * 2.5;
          if (world.heightAt(fromX, fromZ) === null) continue;
          /*
           * and only over ground with nothing else standing on it.
           *
           * A dressed hall is crowded, and the run-up to one table can have a weapon rack and a
           * barrel standing in it — measured, seed 11 floor 1, where the approach to the table at
           * 40,68 crosses both. The hero then meets those instead, slides off one of them, and
           * clips the corner of the table he never actually walked at. That is the sweep working;
           * reported as "walked through the table" it is the bench asking a question it did not
           * mean to ask. The subject has to be the only thing on the line.
           */
          const crossed = [1, 2].some((back) => {
            const cx = f.x - dx * back, cz = f.z - dz * back;
            // a tile either side of the line as well, because a thing is not the size of its tile:
            // a long table is three tiles across, so one standing a tile off the run-up still has
            // its box in it, and that is the case this missed on seed 29
            return map.furniture.some((g) => g !== f && FURNITURE_BLOCKS.has(g.kind)
              && Math.abs(g.x - cx) <= 1 && Math.abs(g.z - cz) <= 1);
          });
          if (crossed) continue;
          cases++;
          const e = walker('hero', fromX - (f.x + 0.5), fromZ - (f.z + 0.5));
          e.x = fromX; e.z = fromZ;
          const trace = walkAt(world, e, dx, dz, 1 / 60, 1);
          // `passedThrough` measures against a box at the origin, and this one is out on a floor,
          // so the walk is read in the furniture's own frame rather than the map's
          const moved = trace.map((at) => ({ x: at.x - (f.x + 0.5), z: at.z - (f.z + 0.5) }));
          const through = passedThrough({ hw: Math.max(box.hw, MIN_BLOCK), hd: Math.max(box.hd, MIN_BLOCK) },
            f.rot, moved, !squareOn(dx, dz));
          if (through) {
            failures.push(`hero walked through ${nameOf(f.kind)} at ${f.x},${f.z} on seed ${seed} floor ${floor}, from ${dx},${dz}`);
          }
        }
      }
    }
    report({
      verdict: failures.length === 0 ? 'PASS' : 'FAIL',
      count: cases,
      what: `a hero walked into the furniture of ${FLOORS.length} dressed castle floors carrying ${solid} solid sticks between them`,
      detail: failures.slice(0, 4),
    });
    expect(solid, 'no castle floor has any solid furniture on it at all').toBeGreaterThan(200);
    expect(failures.slice(0, 6), `${failures.length} of ${cases}`).toEqual([]);
  });

  it('is still a floor you can walk all of, which is the price of making it solid', () => {
    for (const { seed, floor } of FLOORS) {
      const map = generateCastle(seed, floor);
      const offered = floorThePlanOffers(map, CASTLE.HERO_CLIMB);
      const taken = new Set<number>([
        ...map.chests.map((c) => c.z * map.size + c.x),
        ...map.furniture.filter((f) => FURNITURE_BLOCKS.has(f.kind)).map((f) => f.z * map.size + f.x),
      ]);
      const held = reachable(map, map.entrance, true, CASTLE.HERO_CLIMB, taken);
      const lost: string[] = [];
      for (let i = 0; i < offered.length; i++) {
        if (offered[i] === 1 && held[i] === 0 && !taken.has(i)) {
          const x = i % map.size;
          lost.push(`${x},${(i - x) / map.size}`);
        }
      }
      expect(lost, `seed ${seed} floor ${floor}: the dressing shut off ${lost.length} tiles at ${lost.slice(0, 6).join(' ')}`).toEqual([]);
    }
  });
});

/*
 * And the pairs that never move.
 *
 * Two trees standing in each other is what a wood is: props are placed a tile at a time and
 * jittered, an oak's crown is nearly two tiles across, and canopies that overlap are the difference
 * between a wood and an orchard. Measured on a real world, four pairs in nine chunks, all of them
 * crowns.
 *
 * A building is a different promise, and it has to be stated carefully. A tree beside a cottage
 * leans over the roof, and its box — which is its crown, because that is what stands in the band a
 * walker meets — covers ground the cottage is standing on. That is a tree next to a house, and it
 * is right. What is wrong is a tree *planted* in the floor of one: three of the thirty-seven
 * buildings in this piece of seed 3 have a crown over them and none has anything growing inside it.
 *
 * So the question is where things are planted, not whether their boxes touch.
 */
describe('the things that do not move, against each other', () => {
  it('never puts a building inside anything else', () => {
    const sampler = new TerrainSampler(generateWebGraph(3));
    const stops = blocking(propFootprints(), BLOCKS_WALKING);
    const CS = 16;
    const inside: string[] = [];
    let buildings = 0;
    for (let cz = 3; cz <= 6; cz++) {
      for (let cx = 7; cx <= 10; cx++) {
        const chunk = sampler.generateChunk(cx, cz);
        // a structure sits on its tile middle and carries a rotation; everything that grows is
        // jittered off the middle and says so by having none
        const props = [...propsOf(chunk, sampler.seed)];
        const boxes = props.map((p) => ({ p, box: boxesFrom([p], stops)[0] })).filter((b) => b.box);
        // a structure sits on its tile middle unscaled and unstretched; everything that grows is
        // varied in both, which is what tells the two apart without asking the tile grid again
        const isBuilding = (p: PropAt) => p.scale === 1 && p.stretch === 1;
        for (const a of boxes) {
          if (!isBuilding(a.p)) continue;
          buildings++;
          for (const b of boxes) {
            if (a === b) continue;
            // where the other thing is planted, rather than how far it leans
            if (pointInBox(a.box, b.p.x, b.p.z)) {
              inside.push(`prop ${b.p.kind} is planted inside a building at ${a.p.x.toFixed(1)},${a.p.z.toFixed(1)}`);
            }
          }
        }
      }
    }
    report({
      verdict: inside.length === 0 ? 'PASS' : 'FAIL',
      count: buildings,
      what: 'buildings in a real village, checked for anything planted inside them',
      detail: inside.slice(0, 4),
    });
    expect({ enough: buildings > 5, inside: inside.slice(0, 5) }, `${buildings} buildings, ${inside.length} of them inside something`)
      .toEqual({ enough: true, inside: [] });
    expect(CS).toBe(16);
  });
});

/**
 * What the run covered, said out loud.
 *
 * Last on purpose: by the time this runs, every case above has reported what it walked. A green
 * suite that has quietly stopped testing thirty creatures is worse than a red one, so the run
 * prints its own scope and fails if the scope has collapsed.
 */
describe('what this bench covered', () => {
  it('says so, plainly, and is still the size it should be', () => {
    const walked = covered.filter((l) => l.verdict === 'PASS' || l.verdict === 'FAIL');
    const walks = walked.reduce((sum, l) => sum + l.count, 0);
    const failed = covered.filter((l) => l.verdict === 'FAIL');
    const sunk = covered.find((l) => l.verdict === 'INTERSECTED');

    /*
     * Written to a file rather than logged, because a passing test's output is swallowed and the
     * whole point of this is the run that passed. `chore collisions` prints it, and the pipeline
     * keeps it, so whoever picks it up an hour later can read what was signed off without running
     * anything.
     *
     * Verdict first, then a number, then what it was: nobody reads a paragraph to find out whether
     * their branch broke the walls.
     */
    const pad = (word: string) => word.padEnd(11);
    const lines = [
      `COLLISION BENCH — ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${new Date().toISOString()}`,
      '',
      `  ${walks.toLocaleString()} walks. Nothing may pass through anything: that is the whole of PASS and FAIL.`,
      '  TOUCHING and INTERSECTED are about the models rather than the arithmetic — how far the body',
      `  a creature is drawn as ends up inside what it stopped against, as a share of itself: over`,
      `  ${GRAZE * 100}% is touching, over ${SUNK * 100}% is intersected. Neither is a failure; both are watched.`,
      '',
    ];
    for (const line of covered) {
      lines.push(`  ${pad(line.verdict)} ${String(line.count).padStart(6)}  ${line.what}`);
      for (const detail of line.detail ?? []) lines.push(`  ${' '.repeat(11)}         ${detail}`);
    }
    lines.push(
      '',
      '  Named like Oak(1)? Those are PropKind, defined in src/world/biomes.ts.',
      `  Written by src/world/collisions.test.ts to ${REPORT}. Run it again with: chore collisions`,
      '',
    );
    writeFileSync(REPORT, lines.join('\n'));

    expect(covered.length, 'the bench stopped reporting what it did').toBeGreaterThan(20);
    expect(walks, 'the bench has shrunk to nothing').toBeGreaterThan(5000);
    expect(failed.map((l) => l.what), 'something walked through something').toEqual([]);
    expect(sunk, 'the model overlap is no longer being watched at all').toBeTruthy();
  });
});

/*
 * The risk that comes with stopping bodies rather than points: a wood that closes.
 *
 * Every box is now met by the walker's own width, so every gap in the world is that much narrower.
 * A wood is where that matters — trees are placed a tile at a time and jittered, so the gaps are
 * about a tile already — and "I cannot get through this wood any more" is the same complaint as an
 * invisible wall, arriving from the other side.
 *
 * Measured on four chunks of seed 3, in straight lanes half a tile apart, walking east twelve
 * tiles without steering:
 *
 *   as a point    hero 6 of 24    bear 6 of 24
 *   as a body     hero 5 of 24    bear 3 of 24
 *
 * Two things in that. A straight lane through woodland was always rare, because it is woodland; and
 * the cost of the change is one lane for a man and half of them for a bear, which is about the size
 * of a bear. Nobody walks in a straight line through a wood, so the number that matters is not the
 * proportion but whether it goes to nought — a wood you must go round is a wall.
 *
 * The fence is set below what the country gives today, so it catches a wood closing rather than the
 * weather.
 */
describe('a wood, after everything got wider', () => {
  it('can still be walked through', () => {
    const sampler = new TerrainSampler(generateWebGraph(3));
    const stops = blocking(propFootprints(), BLOCKS_WALKING);
    const solids = new Solids();
    let trees = 0;
    for (let cz = 4; cz <= 5; cz++) {
      for (let cx = 8; cx <= 9; cx++) {
        const boxes = boxesFrom(propsOf(sampler.generateChunk(cx, cz), sampler.seed), stops);
        trees += boxes.length;
        solids.put(`${cx},${cz}`, boxes);
      }
    }
    expect(trees, 'nothing is growing on this ground at all').toBeGreaterThan(40);
    const world = field(solids);

    for (const [id, fewest] of [['hero', 3], ['bear', 2]] as const) {
      let through = 0;
      const lanes = 24;
      for (let lane = 0; lane < lanes; lane++) {
        const e = walker(id, 128.5, 64.5 + lane * 0.5);
        walkAt(world, e, 1, 0, 1 / 60, 1);
        if (e.x > 140) through++;                    // twelve tiles of country, give or take a tree
      }
      report({
        verdict: through >= fewest ? 'PASS' : 'FAIL',
        count: through,
        what: `lanes of ${lanes} straight across four chunks of real woodland that a ${id} can walk`,
      });
      expect(through, `a ${id} cannot get through this country any more`).toBeGreaterThanOrEqual(fewest);
    }
  });
});
