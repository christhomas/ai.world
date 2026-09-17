import { describe, expect, it } from 'vitest';
import { at, biggestPiece, GRID, readSeed, report } from './seedscore';

describe('what a seed is worth', () => {
  it('reads the same numbers off the same seed every time', () => {
    expect(readSeed(7)).toEqual(readSeed(7));
  });

  it('reads different numbers off a different seed', () => {
    expect(readSeed(7)).not.toEqual(readSeed(8));
  });

  it('answers in the units the report is written in', () => {
    const one = readSeed(7);
    expect(one.land).toBeGreaterThanOrEqual(0);
    expect(one.land).toBeLessThanOrEqual(1);
    expect(one.villages).toBeGreaterThanOrEqual(0);
    // a patch with fewer than two villages has no spread, and one with none has no walk to make
    expect(one.spread).toBeGreaterThanOrEqual(0);
    expect(one.villages >= 1 || one.home === Infinity).toBe(true);
  });

  it('probes the whole grid it says it does', () => {
    // the share of land can only land on a multiple of 1/samples if every sample was counted
    const land = readSeed(7).land * GRID * GRID;
    expect(Math.abs(land - Math.round(land))).toBeLessThan(1e-9);
  });

  describe('the place in a sorted list a share names', () => {
    const sorted = [1, 2, 3, 4, 5];
    it('gives the ends and the middle', () => {
      expect(at(sorted, 0)).toBe(1);
      expect(at(sorted, 0.5)).toBe(3);
      expect(at(sorted, 1)).toBe(5);
    });
    it('has nothing to say about nothing', () => expect(at([], 0.5)).toBeNaN());
  });


  describe('how much of the land is in one piece', () => {
    /** A square of land laid out by hand, `#` for dry, written as rows so the shape is readable. */
    const shaped = (rows: readonly string[]): boolean[] => {
      const side = rows.length;
      const land: boolean[] = [];
      for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) land[x * side + y] = rows[x][y] === '#';
      return land;
    };

    it('calls one continent whole', () => {
      expect(biggestPiece(shaped(['###', '###', '###']), 3)).toBe(1);
    });

    it('calls two equal islands half', () => {
      expect(biggestPiece(shaped(['#.#', '#.#', '#.#']), 3)).toBe(0.5);
    });

    it('does not join two islands that only touch at a corner', () => {
      // four-connected on purpose: a corner is not a place anybody walks across
      expect(biggestPiece(shaped(['##.', '##.', '..#']), 3)).toBe(4 / 5);
    });

    it('says a world with no land at all is whole, because it is not an archipelago', () => {
      expect(biggestPiece(shaped(['...', '...', '...']), 3)).toBe(1);
    });

    it('finds the biggest piece rather than the first one', () => {
      expect(biggestPiece(shaped(['#..', '...', '.##']), 3)).toBe(2 / 3);
    });
  });

  it('reads a share of land in one piece off a real seed', () => {
    const one = readSeed(7);
    expect(one.whole).toBeGreaterThan(0);
    expect(one.whole).toBeLessThanOrEqual(1);
  });

  it('writes a report that chooses no threshold, which is the whole point of it', () => {
    const text = report([readSeed(7), readSeed(8), readSeed(9)]);
    expect(text).toContain('No threshold is chosen here');
    for (const heading of ['land', 'whole', 'villages', 'spread', 'home']) expect(text).toContain(heading);
  });
});
