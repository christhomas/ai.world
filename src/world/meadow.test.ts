import { describe, expect, it } from 'vitest';
import { GROUND_ALT_CHANCE } from './ground';
import { alternateGround } from './meadow';

/** Every tile of a square of country, as the answer this field gives for it. */
function field(seed: number, size: number, x0 = 0, z0 = 0): boolean[][] {
  const rows: boolean[][] = [];
  for (let z = 0; z < size; z++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(alternateGround(seed, x0 + x, z0 + z));
    rows.push(row);
  }
  return rows;
}

/** How often a tile disagrees with the tile east of it, which is what a checkerboard maximises. */
function edginess(rows: boolean[][]): number {
  let edges = 0, pairs = 0;
  for (const row of rows) {
    for (let x = 1; x < row.length; x++) {
      if (row[x] !== row[x - 1]) edges++;
      pairs++;
    }
  }
  return edges / pairs;
}

describe('which of a biome\'s two greens a tile is', () => {
  it('keeps the share of alternate ground it always had', () => {
    /*
     * Not only a colour: `props.ts` branches on `GroundAlt` and `landmarks.ts` accepts it as flat
     * land, so changing the *shape* of this decision must not change how much of the world it
     * covers. The threshold in `meadow.ts` is measured rather than derived, and this is the
     * measurement.
     */
    const rows = field(12345, 400);
    const alt = rows.flat().filter(Boolean).length / (400 * 400);
    expect(alt).toBeGreaterThan(GROUND_ALT_CHANCE - 0.03);
    expect(alt).toBeLessThan(GROUND_ALT_CHANCE + 0.03);
  });

  it('is blotched rather than chequered', () => {
    /*
     * The whole of the fault, as a number.
     *
     * A coin flip at `GROUND_ALT_CHANCE` disagrees with its eastern neighbour 2p(1-p) of the time —
     * 45.5% at p = 0.35 — and that is the checkerboard: nearly every second tile is a different
     * colour from the one beside it, at exactly the wavelength of the grid.
     *
     * A blotch eight tiles across crosses an edge roughly twice per blotch, so the answer should be
     * a small fraction of that. It is not zero and should not be: the dither at the join is what
     * keeps the boundary from being a smooth contour drawn in tiles, which is the grid showing
     * through by another route.
     */
    const rows = field(12345, 400);
    expect(edginess(rows)).toBeLessThan(0.2);
  });

  it('answers the same for the same place however often it is asked', () => {
    // a patch dropped and re-grown, or grown on another machine, has to come out the same
    for (const [x, z] of [[0, 0], [17, -412], [-9001, 2222], [512, 512]]) {
      expect(alternateGround(4, x, z)).toBe(alternateGround(4, x, z));
    }
  });

  it('gives two seeds two different meadows', () => {
    const one = field(1, 60).flat();
    const other = field(2, 60).flat();
    const same = one.filter((v, i) => v === other[i]).length / one.length;
    expect(same).toBeLessThan(0.9);
  });

  it('does not repeat itself across a patch boundary', () => {
    // the field is world-space, so a square of country a long way off is its own square rather
    // than the same one again — which is what a per-patch noise would give
    const here = field(7, 40).flat().filter(Boolean).length;
    const far = field(7, 40, 4096, -4096).flat().filter(Boolean).length;
    expect(here).not.toBe(far);
  });
});
