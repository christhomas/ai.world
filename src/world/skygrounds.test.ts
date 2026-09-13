import { describe, expect, it } from 'vitest';
import { PATCH, Patchwork } from './patchwork';
import { growPatch } from './growworld';
import { skyGroundsIn } from './skygrounds';
import { planSkyIslands } from './skyisland';
import { rangesAsMassifs } from './ranges';
import type { Within } from './window';

const square = (px: number, pz: number): Within =>
  ({ x0: px * PATCH, z0: pz * PATCH, x1: (px + 1) * PATCH, z1: (pz + 1) * PATCH });

describe('where a country with no edge hangs a village in the clouds', () => {
  it('offers places with land under them, and none where there is none', () => {
    const everywhere = skyGroundsIn(7, square(0, 0), () => true);
    expect(everywhere.length).toBeGreaterThan(0);
    expect(skyGroundsIn(7, square(0, 0), () => false)).toEqual([]);
  });

  /*
   * The rule the whole endless country rests on: a patch is a function of the seed and of where it
   * is, and of nothing else. Grown twice, or grown on two machines, it has to be the same patch —
   * so the island hangs in the same place both times without a word crossing the wire.
   */
  it('draws the same places for the same square every time', () => {
    expect(skyGroundsIn(7, square(3, -2), () => true))
      .toEqual(skyGroundsIn(7, square(3, -2), () => true));
  });

  it('and different ones for a different square, and for a different seed', () => {
    const here = skyGroundsIn(7, square(0, 0), () => true);
    expect(skyGroundsIn(7, square(1, 0), () => true)).not.toEqual(here);
    expect(skyGroundsIn(8, square(0, 0), () => true)).not.toEqual(here);
  });

  /*
   * Inset from the edges, because an island straddling a boundary belongs to both squares: each
   * would plan it, each would build it, and a hero at the seam would walk under two of them.
   */
  it('keeps them clear of the square it is planning, so no two patches plan the same one', () => {
    for (const one of skyGroundsIn(7, square(0, 0), () => true)) {
      expect(one.x - one.radius).toBeGreaterThan(0);
      expect(one.x + one.radius).toBeLessThan(PATCH);
      expect(one.z - one.radius).toBeGreaterThan(0);
      expect(one.z + one.radius).toBeLessThan(PATCH);
    }
  });

  it('never offers the same spot twice', () => {
    const all = skyGroundsIn(7, square(0, 0), () => true);
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(100);
      }
    }
  });

  it('gives the planner a reach it can make both its smallest and its largest island out of', () => {
    const all = skyGroundsIn(7, square(0, 0), () => true);
    expect(all.every((one) => one.radius >= 62 && one.radius <= 108)).toBe(true);
  });

  /** And the whole point of it: an endless patch that had nothing above it now has something. */
  it('puts islands over real country, where before there were none at all', () => {
    const patches = new Patchwork(7, growPatch);
    const sampler = patches.at(20, 20);
    const land = (x: number, z: number): boolean => sampler.probe(x, z).land;
    const high = sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs;

    expect(sampler.graph.islands, 'a patch has no islands in the road-tree sense').toEqual([]);
    expect(planSkyIslands(7, sampler.graph.islands, high, land), 'which is why there were none')
      .toEqual([]);

    const grounds = skyGroundsIn(7, sampler.within!, land);
    expect(planSkyIslands(7, grounds, high, land).length).toBeGreaterThan(0);
  });
});
