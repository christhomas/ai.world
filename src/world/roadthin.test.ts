import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';
import { countryOf, facesIn } from './localmesh';
import { junctionsOf, roadBetween, roadsOf, townAt, type Land } from './localroads';

/**
 * What thinning the web costs, measured rather than argued.
 *
 * Every border between two dry faces used to be a road. The faces are a Poisson-disc scatter and
 * the Voronoi diagram of one is a field of near-regular hexagons, so the complete dual of it read
 * as a honeycomb at map scale — which is what the polygon world was retired for, inherited.
 *
 * Thinning it is easy. Thinning it without cutting anything off, without asking a global question,
 * and without emptying the country of villages is what these hold.
 */

function country(seed: number): Land {
  const shape = new Simplex2D(seed);
  const grain = new Simplex2D(seed ^ 0x1234);
  return {
    ...countryOf(seed, (x, z) => (grain.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 6, far: 14, tries: 6 }),
    land: (x, z) => shape.fbm(x * 0.0018, z * 0.0018, 3) > -0.15,
  };
}

const world = country(20260909);
/** Big enough that a share means something: five hundred faces and a thousand junctions. */
const WIDE = { x0: 200, z0: 200, x1: 600, z1: 600 };
const faces = facesIn(world, WIDE);

/** Every junction in the window, each counted once however many faces meet there. */
function junctions() {
  const seen = new Map<string, ReturnType<typeof junctionsOf>[number]>();
  for (const face of faces) for (const junction of junctionsOf(world, face)) seen.set(junction.id, junction);
  return [...seen.values()];
}

describe('what thinning the web costs', () => {
  it('leaves about half the borders, which is what stops it being a lattice', () => {
    let couldBe = 0, are = 0;
    for (const face of faces) {
      couldBe += face.neighbours.filter((id) => roadBetween(world, face, id) !== null).length;
      are += roadsOf(world, face).length;
    }
    const share = are / couldBe;
    expect(share, 'too much gone and the country is a set of islands').toBeGreaterThan(0.35);
    expect(share, 'too little gone and it is still a honeycomb').toBeLessThan(0.6);
  });

  it('strands nothing, which is the whole reason the rule is per face', () => {
    /*
     * A face keeps its two most-wanted borders and a border survives if either side kept it, so
     * every face that could have a road has one. No traversal, no spanning tree, no global
     * question — the property falls out of the rule rather than being checked for afterwards.
     */
    for (const face of faces) {
      const possible = face.neighbours.filter((id) => roadBetween(world, face, id) !== null).length;
      if (possible === 0) continue;                 // an island face, which had no roads before either
      expect(roadsOf(world, face).length, `${face.id} was cut off`).toBeGreaterThan(0);
    }
  });

  it('keeps the country as full of villages as it was', () => {
    /*
     * The half of this that would have gone unnoticed. Fewer roads at a junction meant a third as
     * many villages under the old `0.18 + 0.09 * roads`, which is not a quieter country but the
     * same country with most of its content removed. `SETTLED_AT` and `PER_ROAD` are the answer and
     * this is the measurement they were tuned against: 296 before, and no fewer than nine tenths of
     * that after.
     */
    const towns = junctions().filter((junction) => townAt(world, junction) !== null);
    expect(towns.length).toBeGreaterThan(265);
  });

  it('gives the country more than one size of village, which it never had', () => {
    /*
     * Not a consequence: a fault this uncovered. `level` asked for four roads at a junction to make
     * a market town, and a junction is where three faces meet — so it can have three roads at most
     * and a market town was unreachable. Measured on the old rule, 295 of 296 villages were the
     * same size and the other was the only hamlet in the country.
     */
    const levels = new Map<number, number>();
    for (const junction of junctions()) {
      const town = townAt(world, junction);
      if (town) levels.set(town.level, (levels.get(town.level) ?? 0) + 1);
    }
    expect([...levels.keys()].sort(), 'all three sizes should exist').toEqual([1, 2, 3]);
    for (const [level, many] of levels) {
      expect(many, `only ${many} of level ${level}`).toBeGreaterThan(10);
    }
  });
});
