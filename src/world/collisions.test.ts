import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd, bodyOf, canStand, spaceNear, tryMove, type Crowd, type TileWorld } from '../entities/entity';
import { stride } from '../entities/stride';
import { propFootprints } from '../render/props';
import { BLOCKS_WALKING, PropKind } from './biomes';
import { MIN_BLOCK, blocking } from './footprints';
import { Solids, boxesFrom, pointInBox } from './solids';
import { inTheWay } from './tiles';
import { FURNITURE_BLOCKS } from '../interior/generate';
import { propsOf, type PropAt } from './propstream';
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
const covered: string[] = [];
const report = (line: string): void => { covered.push(line); };

/** Where the run leaves its account of itself. Printed by `pnpm collisions`. */
const REPORT = '.collisions.txt';

/** Ground that goes on for ever at one height, with whatever has been put on it. */
function field(solids: Solids): TileWorld {
  return {
    heightAt: () => 1,
    waterAt: () => null,
    blocked: (x, z) => solids.at(x, z),
    // a road, because one creature in the game only walks on roads and would otherwise stand still
    // through every case below and pass them all by never moving
    isRoad: () => true,
    crosses: (x0, z0, x1, z1) => solids.crosses(x0, z0, x1, z1),
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

/**
 * How deeply two turned boxes are inside each other, in tiles.
 *
 * Nought when they are apart or exactly touching. Otherwise the least distance either of them would
 * have to move to be apart again — the separating axis theorem, on the four axes two rectangles
 * have between them, which is exact for rectangles.
 *
 * This is the measurement the eye makes. The engine collides a walker as a *point*, so a horse
 * nearly two tiles long stops with its middle at the wall and its nose in the plaster: the point is
 * outside and the model is not. Both are worth knowing and they are different questions, so this
 * answers the second one and `wentInto` answers the first.
 */
function overlap(
  a: { hw: number; hd: number }, ax: number, az: number, aRot: number,
  b: { hw: number; hd: number }, bx: number, bz: number, bRot: number,
): number {
  const axes = [aRot, aRot + Math.PI / 2, bRot, bRot + Math.PI / 2];
  const dx = bx - ax, dz = bz - az;
  let least = Infinity;
  for (const angle of axes) {
    const ux = Math.cos(angle), uz = Math.sin(angle);
    // each box's reach along this axis, and how far apart their middles are along it
    const reachA = Math.abs(a.hw * Math.cos(aRot - angle)) + Math.abs(a.hd * Math.sin(aRot - angle));
    const reachB = Math.abs(b.hw * Math.cos(bRot - angle)) + Math.abs(b.hd * Math.sin(bRot - angle));
    const apart = Math.abs(dx * ux + dz * uz);
    const into = reachA + reachB - apart;
    if (into <= 0) return 0;                 // a gap on any axis is a gap
    least = Math.min(least, into);
  }
  return least;
}

/**
 * What a pair did to each other: nothing, a graze, or one standing in the other.
 *
 * Low-polygon models are not their boxes and a hair of overlap is what standing next to something
 * looks like, so a little is `touching` and is reported rather than failed. Deep is `intersected`,
 * which is two models sitting on top of each other, and that is a fault whatever the arithmetic
 * says.
 */
const TOUCH = 0.06;
const SUNK = 0.3;

type Verdict = 'passed' | 'touching' | 'intersected';

function verdictOf(depth: number): Verdict {
  if (depth <= TOUCH) return 'passed';
  return depth <= SUNK ? 'touching' : 'intersected';
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
  { what: 'a church, which is the biggest thing anybody walks up to', kind: PropKind.ChurchPlains },
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
              const wall = reach(box, rot, -dx, -dz);
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
        report(`${WALKERS.length * APPROACHES.length * SPEEDS.length} walks: ${what}, turned ${Math.round((rot * 180) / Math.PI)}°, eight sides, three speeds`);
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
          for (const at of trace) worst = Math.max(worst, overlap(body, at.x, at.z, e.yaw, box, 0, 0, 0));
          const verdict = verdictOf(worst);
          models[verdict]++;
          if (verdict === 'intersected' && sunk.length < 200) {
            sunk.push({ mover: id, into: kind, depth: worst, from: `${dx},${dz}` });
          }
          const wall = reach(box, 0, -dx, -dz);
          const got = -(e.x * dx + e.z * dz);
          if (got > wall + 0.45) failures.push(`${id} held ${got.toFixed(2)} off prop ${kind} whose wall is at ${wall.toFixed(2)}`);
        }
      }
    }
    report(`${cases} walks: every one of ${EVERY_MOVER.length} movers into every one of ${EVERY_SOLID.length} solids, from four sides`);
    report(`  of those, as models rather than points: ${models.passed} passed, ${models.touching} touching, ${models.intersected} intersected`);
    /*
     * The second number is a fact about the game rather than a fault in it, and it is written down
     * here so that it cannot get quietly worse.
     *
     * A walker collides as a *point*. Its middle is stopped at the wall and the model it is drawn
     * as goes on into the plaster: a bear is 1.2 tiles across the shoulders, so a bear standing
     * against an oak is a bear a fifth of the way inside it. Nothing walks *through* anything —
     * that is what the point tests above prove — but plenty of things stand in each other.
     *
     * Fixing it is one line of arithmetic in the wrong direction: stopping a body rather than a
     * point means growing every box by the walker's own width, which is the difference between a
     * wood you can pick your way through and a wood that is a wall. That is a change to how the
     * game feels and it belongs to whoever is playing it, not to a test. So the test holds the
     * line: this may not get worse without somebody saying so.
     */
    expect(models.intersected, 'more models are standing inside things than were').toBeLessThanOrEqual(3128);
    expect(sunk.reduce((most, one) => Math.max(most, one.depth), 0), 'and none of them deeper')
      .toBeLessThanOrEqual(1.3);
    if (sunk.length > 0) {
      const worst = [...sunk].sort((a, b) => b.depth - a.depth).slice(0, 6);
      for (const one of worst) {
        report(`  deepest: a ${one.mover} sank ${one.depth.toFixed(2)} tiles into prop ${one.into} coming from ${one.from}`);
      }
    }
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
    report(`${EVERY_MOVER.length ** 2 * 2} walks: every mover into every mover, from two sides`);
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
          const wall = reach({ hw: Math.max(box.hw, MIN_BLOCK), hd: Math.max(box.hd, MIN_BLOCK) }, 0, -dx, -dz);
          const got = -(e.x * dx + e.z * dz);
          if (got > wall + 0.45) failures.push(`${id} held ${got.toFixed(2)} off furniture ${kind}, whose edge is at ${wall.toFixed(2)}`);
        }
      }
    }
    report(`${cases} walks: three bodies into every one of ${EVERY_STICK.length} solid sticks of furniture`);
    expect(failures.slice(0, 6), `${failures.length} of ${cases}`).toEqual([]);
  });

  it('and a bed is longer than the tile it stands on, which is the whole of that fault', () => {
    const bed = propFootprints().get(PropKind.Bed);
    expect(bed, 'a bed is not measured at all').toBeTruthy();
    expect(Math.max(bed!.hw, bed!.hd), 'a bed that fits inside one tile').toBeGreaterThan(0.5);
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
    report(`${buildings} buildings checked for anything planted inside them`);
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
  it('says so, and is still the size it should be', () => {
    const walks = covered
      .map((line) => Number(line.match(/^(\d+) walks/)?.[1] ?? 0))
      .reduce((a, b) => a + b, 0);
    /*
     * Written to a file rather than logged, because a passing test's output is swallowed and the
     * whole point of this is the run that passes. `pnpm collisions` prints it; a pipeline can keep
     * it as the artefact that says what was signed off.
     */
    writeFileSync(REPORT, [
      `collision bench — ${walks} walks`,
      ...covered.map((l) => `  · ${l}`),
      '',
    ].join('\n'));
    expect(covered.length, 'the bench stopped reporting what it did').toBeGreaterThan(20);
    expect(walks, 'the bench has shrunk to nothing').toBeGreaterThan(5000);
  });
});
