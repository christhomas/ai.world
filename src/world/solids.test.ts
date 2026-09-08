import { describe, expect, it } from 'vitest';
import { Solids, boxesFrom, type Solid } from './solids';
import { PropKind } from './biomes';
import { FOOTPRINTS } from './footprints';

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
    const half = standing(...boxesFrom([{ kind: PropKind.Oak, x: 8, z: 8, rot: 0, scale: 0.5 }]));
    const twice = standing(...boxesFrom([{ kind: PropKind.Oak, x: 8, z: 8, rot: 0, scale: 2 }]));
    const oak = FOOTPRINTS.get(PropKind.Oak)!;
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
    const solids = standing(...boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 8.5, rot: 0 }]));
    // both ends outside the house, the line straight through the middle of it
    expect(solids.at(5, 8.5), 'the near end is clear ground').toBe(false);
    expect(solids.at(12, 8.5), 'and so is the far end').toBe(false);
    expect(solids.crosses(5, 8.5, 12, 8.5), 'walked through a house').toBe(true);
  });

  it('lets a step past that misses', () => {
    const solids = standing(...boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 8.5, rot: 0 }]));
    expect(solids.crosses(5, 4, 12, 4), 'stopped by a house four tiles away').toBe(false);
  });

  it('turns with the box, so a long house is crossed the way it lies', () => {
    const along = { kind: PropKind.Stall, x: 8.5, z: 8.5, rot: 0 };
    const across = { ...along, rot: Math.PI / 2 };
    // a stall is 1.8 x 1.08: a step over its middle is a crossing whichever way it faces
    expect(standing(...boxesFrom([along])).crosses(6, 8.5, 11, 8.5)).toBe(true);
    expect(standing(...boxesFrom([across])).crosses(6, 8.5, 11, 8.5)).toBe(true);
    // but a step 0.8 of a tile to the side passes its narrow way round and not its long one
    expect(standing(...boxesFrom([along])).crosses(6, 9.3, 11, 9.3), 'the narrow way round').toBe(false);
    expect(standing(...boxesFrom([across])).crosses(6, 9.3, 11, 9.3), 'the long way round').toBe(true);
  });

  it('catches a corner clipped between two samples', () => {
    const solids = standing(...boxesFrom([{ kind: PropKind.Boulder, x: 8.5, z: 8.5, rot: 0 }]));
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
    world.put('0,0', boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 15.5, rot: 0 }]));
    expect(world.at(8.5, 15.5), 'the middle of the house').toBe(true);
    expect(world.at(8.5, 16.2), 'the wall over the boundary').toBe(true);
    expect(world.at(8.5, 16.9), 'and clear ground past it').toBe(false);
    expect(world.crosses(8.5, 17.5, 8.5, 15.5), 'walked in from the next chunk').toBe(true);
  });

  it('goes away with the chunk that put it down', () => {
    const world = new Solids();
    world.put('0,0', boxesFrom([{ kind: PropKind.HousePlains, x: 8.5, z: 15.5, rot: 0 }]));
    world.drop('0,0');
    expect(world.count, 'boxes left behind by an unloaded chunk').toBe(0);
    expect(world.at(8.5, 15.5), 'still solid where the house was').toBe(false);
    expect(world.at(8.5, 16.2), 'and over the boundary too').toBe(false);
  });

  it('keeps the neighbours when one chunk is dropped', () => {
    const world = new Solids();
    world.put('0,0', boxesFrom([{ kind: PropKind.Oak, x: 4.5, z: 4.5, rot: 0 }]));
    world.put('1,0', boxesFrom([{ kind: PropKind.Oak, x: 20.5, z: 4.5, rot: 0 }]));
    world.drop('1,0');
    expect(world.at(4.5, 4.5), 'the tree in the chunk that stayed').toBe(true);
    expect(world.at(20.5, 4.5), 'the tree in the chunk that went').toBe(false);
  });
});
