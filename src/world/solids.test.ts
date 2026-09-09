import { describe, expect, it } from 'vitest';
import { Solids, boxesFrom, pointInBox, segmentHitsBox, type Solid } from './solids';
import { mulberry32 } from '../core/rng';
import { PropKind } from './biomes';
import { propFootprints } from '../entities/props';

/**
 * A long thing, turned.
 *
 * The point of a box rather than a tile is that a building three times longer than it is wide can
 * be put down facing any way and still behave in a way you can predict — you walk along its length
 * on one side and round its end on the other, and turning the house turns that too. A tile grid
 * cannot express it and a circle cannot either.
 */
/** One or more hand-made boxes standing in the world, as a chunk would put them there. */
function standing(...boxes: Solid[]): Solids {
  const s = new Solids();
  s.put('one chunk', boxes);
  return s;
}

describe('a turned box', () => {
  // three times longer than wide
  const long = () => standing({ x: 8, z: 8, hw: 1.5, hd: 0.5, rot: 0 });

  it('is long the way it is pointing and narrow across', () => {
    const s = long();
    expect(s.at(9.2, 8), 'along its length').toBe(true);
    expect(s.at(8, 9.2), 'across its width').toBe(false);
    expect(s.at(9.6, 8), 'past its end').toBe(false);
  });

  it('turns its length with it', () => {
    // the same building, put down facing the other way
    const s = standing({ x: 8, z: 8, hw: 1.5, hd: 0.5, rot: Math.PI / 2 });
    expect(s.at(9.2, 8), 'no longer long this way').toBe(false);
    expect(s.at(8, 9.2), 'long this way instead').toBe(true);
  });

  it('is still solid when it lies across a diagonal', () => {
    const s = standing({ x: 8, z: 8, hw: 1.5, hd: 0.5, rot: Math.PI / 4 });
    // a point a tile out along the diagonal is inside it; the same distance across is not
    const d = 1.0 / Math.SQRT2;
    expect(s.at(8 + d, 8 + d), 'along the diagonal').toBe(true);
    expect(s.at(8 - d, 8 + d), 'across it').toBe(false);
  });

  it('reaches into every tile it overlaps, not just the one it stands on', () => {
    // this is what a market stall needed: it is drawn wider than a tile, so it has to be found
    // from the tiles either side or you walk through the half of it that is not on its own tile
    const s = long();
    for (const x of [6.6, 7.2, 8, 8.8, 9.4]) expect(s.at(x, 8), `at x=${x}`).toBe(true);
  });

  it('scales a prop box with the prop', () => {
    const half = standing(...boxesFrom([{ kind: PropKind.Oak, x: 8, z: 8, rot: 0, scale: 0.5 }], propFootprints()));
    const twice = standing(...boxesFrom([{ kind: PropKind.Oak, x: 8, z: 8, rot: 0, scale: 2 }], propFootprints()));
    const oak = propFootprints().get(PropKind.Oak)!;
    // a point beyond the small one and inside the big one: the same tree, drawn at two sizes
    const between = 8 + oak.hw * 1.2;
    expect(half.at(between, 8), 'clear of the sapling').toBe(false);
    expect(twice.at(between, 8), 'inside the big one').toBe(true);
  });
});

/*
 * The fault these were written for: collision asked whether the far end of a step was inside
 * something. A hero on a courser covers nearly five tiles in one server step — a cottage is 2.5
 * across — so the far end was on the other side of the house, standing on clear grass, and he went
 * there. It was reported as walking through walls "sometimes", because whether it happened at all
 * depended on how long the frame was.
 */
describe('crossing a solid rather than landing in one', () => {
  it('catches a step that goes clean over a box', () => {
    const solids = standing(...boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 8.5, rot: 0 }], propFootprints()));
    // both ends outside the house, the line straight through the middle of it
    expect(solids.at(5, 8.5), 'the near end is clear ground').toBe(false);
    expect(solids.at(12, 8.5), 'and so is the far end').toBe(false);
    expect(solids.crosses(5, 8.5, 12, 8.5), 'walked through a house').toBe(true);
  });

  it('lets a step past that misses', () => {
    const solids = standing(...boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 8.5, rot: 0 }], propFootprints()));
    expect(solids.crosses(5, 4, 12, 4), 'stopped by a house four tiles away').toBe(false);
  });

  it('turns with the box, so a long house is crossed the way it lies', () => {
    const along = { kind: PropKind.Stall, x: 8.5, z: 8.5, rot: 0 };
    const across = { ...along, rot: Math.PI / 2 };
    // a stall is 1.8 x 1.08: a step over its middle is a crossing whichever way it faces
    expect(standing(...boxesFrom([along], propFootprints())).crosses(6, 8.5, 11, 8.5)).toBe(true);
    expect(standing(...boxesFrom([across], propFootprints())).crosses(6, 8.5, 11, 8.5)).toBe(true);
    // but a step 0.8 of a tile to the side passes its narrow way round and not its long one
    expect(standing(...boxesFrom([along], propFootprints())).crosses(6, 9.3, 11, 9.3), 'the narrow way round').toBe(false);
    expect(standing(...boxesFrom([across], propFootprints())).crosses(6, 9.3, 11, 9.3), 'the long way round').toBe(true);
  });

  it('catches a corner clipped between two samples', () => {
    const solids = standing(...boxesFrom([{ kind: PropKind.Boulder, x: 8.5, z: 8.5, rot: 0 }], propFootprints()));
    // a diagonal that grazes the corner of the box: sampling a step every fifth of a tile can step
    // over this, which is why the line itself is tested rather than points along it
    const x0 = 8.5 - 1.07, z0 = 8.5 - 0.79 - 0.6;
    expect(solids.crosses(x0, z0, x0 + 1.4, z0 + 1.4)).toBe(true);
  });
});

/*
 * The fault this was written for, reported as walking through a house and nothing else. The boxes
 * were kept per chunk in a grid of that chunk's own sixteen tiles, and a cottage is two and a half
 * tiles across: the part of its box that lay over a chunk boundary was registered in no grid at
 * all — its own chunk would not take a tile outside itself and the chunk next door had never heard
 * of the house. Trees went on working, because a tree is under a tile wide.
 */
describe('a box that lies across a chunk boundary', () => {
  it('is solid on both sides of the line', () => {
    const world = new Solids();
    // a cottage on the last tile of chunk 0: its box reaches 1.26 either way, so a quarter of it
    // hangs over into the chunk above
    world.put('0,0', boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 15.5, rot: 0 }], propFootprints()));
    expect(world.at(8.5, 15.5), 'the middle of the house').toBe(true);
    expect(world.at(8.5, 16.2), 'the wall over the boundary').toBe(true);
    expect(world.at(8.5, 16.9), 'and clear ground past it').toBe(false);
    expect(world.crosses(8.5, 17.5, 8.5, 15.5), 'walked in from the next chunk').toBe(true);
  });

  it('goes away with the chunk that put it down', () => {
    const world = new Solids();
    world.put('0,0', boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 15.5, rot: 0 }], propFootprints()));
    world.drop('0,0');
    expect(world.count, 'boxes left behind by an unloaded chunk').toBe(0);
    expect(world.at(8.5, 15.5), 'still solid where the house was').toBe(false);
    expect(world.at(8.5, 16.2), 'and over the boundary too').toBe(false);
  });

  it('keeps the neighbours when one chunk is dropped', () => {
    const world = new Solids();
    world.put('0,0', boxesFrom([{ kind: PropKind.Oak, x: 4.5, z: 4.5, rot: 0 }], propFootprints()));
    world.put('1,0', boxesFrom([{ kind: PropKind.Oak, x: 20.5, z: 4.5, rot: 0 }], propFootprints()));
    world.drop('1,0');
    expect(world.at(4.5, 4.5), 'the tree in the chunk that stayed').toBe(true);
    expect(world.at(20.5, 4.5), 'the tree in the chunk that went').toBe(false);
  });
});

/*
 * The buckets are an index and nothing else.
 *
 * Both walk-through faults were the index disagreeing with the boxes rather than the boxes being
 * wrong: a chunk-local grid clipped a cottage at a boundary, and before that a mover asked about
 * one point instead of the line it was walking. Neither could have survived this, which asks the
 * same questions of the index and of every box in the world and demands the same answer.
 */
describe('the index against the boxes themselves', () => {
  const CS = 16;
  /** A patch of world: boxes of every shape, sitting anywhere, including over chunk boundaries. */
  const patch = () => {
    const rng = mulberry32(7);
    const boxes: Solid[] = [];
    for (let n = 0; n < 120; n++) {
      boxes.push({
        x: rng() * CS * 3, z: rng() * CS * 3,
        hw: 0.1 + rng() * 1.6, hd: 0.1 + rng() * 1.6, rot: rng() * Math.PI * 2,
      });
    }
    const world = new Solids();
    // spread them over chunks the way the real thing does, by which chunk each middle falls in
    const byChunk = new Map<string, Solid[]>();
    for (const box of boxes) {
      const key = `${Math.floor(box.x / CS)},${Math.floor(box.z / CS)}`;
      byChunk.set(key, [...(byChunk.get(key) ?? []), box]);
    }
    for (const [key, held] of byChunk) world.put(key, held);
    return { world, boxes };
  };

  it('answers about a point exactly as every box would', () => {
    const { world, boxes } = patch();
    const rng = mulberry32(11);
    let inside = 0;
    for (let n = 0; n < 6000; n++) {
      const x = rng() * CS * 3, z = rng() * CS * 3;
      const brute = boxes.some((b) => pointInBox(b, x, z));
      if (brute) inside++;
      expect(world.at(x, z), `at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(brute);
    }
    expect(inside, 'the points all missed: this proved nothing').toBeGreaterThan(200);
  });

  it('answers about a step exactly as every box would', () => {
    const { world, boxes } = patch();
    const rng = mulberry32(13);
    let crossed = 0;
    for (let n = 0; n < 6000; n++) {
      const x0 = rng() * CS * 3, z0 = rng() * CS * 3;
      // steps of every length a mover could take, up to a mounted hero's longest
      const far = 0.02 + rng() * 4.8, angle = rng() * Math.PI * 2;
      const x1 = x0 + Math.cos(angle) * far, z1 = z0 + Math.sin(angle) * far;
      const brute = boxes.some((b) => segmentHitsBox(b, x0, z0, x1, z1));
      if (brute) crossed++;
      expect(world.crosses(x0, z0, x1, z1), `from ${x0.toFixed(2)},${z0.toFixed(2)} to ${x1.toFixed(2)},${z1.toFixed(2)}`).toBe(brute);
    }
    expect(crossed, 'no step crossed anything: this proved nothing').toBeGreaterThan(200);
  });
});
