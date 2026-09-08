import { describe, expect, it } from 'vitest';
import { Solids, solidsFrom } from './solids';
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
describe('a turned box', () => {
  const long = () => {
    const s = new Solids(0, 0);
    // three times longer than wide, in the middle of chunk 0,0
    s.add({ x: 8, z: 8, hw: 1.5, hd: 0.5, rot: 0 });
    return s;
  };

  it('is long the way it is pointing and narrow across', () => {
    const s = long();
    expect(s.at(9.2, 8), 'along its length').toBe(true);
    expect(s.at(8, 9.2), 'across its width').toBe(false);
    expect(s.at(9.6, 8), 'past its end').toBe(false);
  });

  it('turns its length with it', () => {
    const s = new Solids(0, 0);
    // the same building, put down facing the other way
    s.add({ x: 8, z: 8, hw: 1.5, hd: 0.5, rot: Math.PI / 2 });
    expect(s.at(9.2, 8), 'no longer long this way').toBe(false);
    expect(s.at(8, 9.2), 'long this way instead').toBe(true);
  });

  it('is still solid when it lies across a diagonal', () => {
    const s = new Solids(0, 0);
    s.add({ x: 8, z: 8, hw: 1.5, hd: 0.5, rot: Math.PI / 4 });
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
    const half = solidsFrom(0, 0, [{ kind: PropKind.Oak, x: 8, z: 8, rot: 0, scale: 0.5 }]);
    const twice = solidsFrom(0, 0, [{ kind: PropKind.Oak, x: 8, z: 8, rot: 0, scale: 2 }]);
    const oak = FOOTPRINTS.get(PropKind.Oak)!;
    // a point beyond the small one and inside the big one: the same tree, drawn at two sizes
    const between = 8 + oak.hw * 1.2;
    expect(half.at(between, 8), 'clear of the sapling').toBe(false);
    expect(twice.at(between, 8), 'inside the big one').toBe(true);
  });
});
