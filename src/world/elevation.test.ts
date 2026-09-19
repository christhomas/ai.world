import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { Elevations, inOrder } from './elevation';
import { partsOf, rebuildPatch } from './endless';
import { highlandAt, highlandRidges, type Highland } from './highland';
import { countryStamp, growPatch } from './growworld';
import type { RoadGraph } from './graph';
import type { TerrainSampler } from './terrain';

/**
 * The layers a world carries, and the three things that have to be true of them.
 *
 * They sum where the high country of a range takes the largest, they are part of what a patch is a
 * function of, and the fingerprint two halves compare on join covers them. The last is the one
 * worth the most: a stamp that hashed the graph and not the layers would report agreement between
 * two worlds whose ground is at different heights, which is the exact failure the stamp exists to
 * catch and the one it would be silent about.
 */

const layer = (x: number, z: number, reach: number, lift: number): Highland => ({ x, z, reach, lift });

/** Two layers a hundred tiles apart, each reaching far enough to cover the other's middle. */
const ONE = layer(0, 0, 400, 20);
const TWO = layer(100, 0, 400, 20);

/** A country with nothing in it, for the questions that are about the layers and not the roads. */
const empty: RoadGraph = {
  seed: 7, radius: 100, nodes: [], edges: [], towns: [], islands: [],
  mainlandNodes: 0, sectors: [], sectorOffset: 0,
};

describe('the elevation layers of a world', () => {
  it('sums its components where a range takes the largest of its swells', () => {
    /*
     * The whole of #307's argument in two numbers. `highlandAt` maxes, and its comment is right to:
     * two shoulders of two different ranges overlapping make a saddle at the height of the higher
     * one, and summing them would pile two ranges into one impossible mountain. Components of the
     * *same* mountain are the other case, and one basis function maxed with its neighbours can only
     * ever make a mesa — which is what the spike on `task/mountains-are-ground` photographed.
     */
    const ridges = highlandRidges(1);
    const alone = new Elevations([ONE]).liftAt(50, 0);
    expect(alone, 'a layer with nothing else about lifts the ground on its own').toBeGreaterThan(1);

    const both = new Elevations([ONE, TWO]).liftAt(50, 0);
    expect(both).toBeCloseTo(alone * 2, 6);

    // and the same two read as high country rather than as layers stay at the height of one
    const swell = highlandAt([ONE, TWO], ridges, 50, 0) / highlandAt([ONE], ridges, 50, 0);
    expect(swell).toBeCloseTo(1, 6);
  });

  it('is nothing at all outside a layer, and nothing at all with no layers', () => {
    expect(new Elevations([ONE]).liftAt(0, 4000)).toBe(0);
    expect(new Elevations([]).liftAt(0, 0)).toBe(0);
    expect(Elevations.none.liftAt(0, 0)).toBe(0);
  });

  it('answers the same as the loop it replaces, wherever it is asked', () => {
    /*
     * The index is the thing that makes a long authored list affordable and it is also the thing
     * that could quietly answer a different country. So it is held to the naive sum — every layer,
     * every time — over a spread of layers wide enough that most questions miss most of them.
     */
    let n = 1;
    const roll = (): number => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };
    const many = Array.from({ length: 200 }, () => layer(
      (roll() - 0.5) * 4000, (roll() - 0.5) * 4000, 60 + roll() * 400, 4 + roll() * 30,
    ));
    const indexed = new Elevations(many);
    const naive = (x: number, z: number): number =>
      many.reduce((sum, hill) => sum + new Elevations([hill]).liftAt(x, z), 0);

    let touched = 0;
    for (let i = 0; i < 400; i++) {
      const x = (roll() - 0.5) * 4000, z = (roll() - 0.5) * 4000;
      const was = naive(x, z);
      if (was > 0) touched++;
      expect(indexed.liftAt(x, z)).toBeCloseTo(was, 9);
    }
    expect(touched, 'a comparison where every answer was nought proves nothing').toBeGreaterThan(100);
  });

  it('does not depend on the order the list happens to be in', () => {
    // a Map restored from a save and a list built from a seed need not agree about order, and the
    // ground must not have an opinion about which one it was handed
    const forwards = new Elevations([ONE, TWO]);
    const backwards = new Elevations([TWO, ONE]);
    expect(backwards.liftAt(50, 0)).toBe(forwards.liftAt(50, 0));
    expect(inOrder([TWO, ONE])).toEqual(inOrder([ONE, TWO]));
  });
});

describe('the fingerprint of a country covers its layers', () => {
  it('says two worlds differ when only their layers do', () => {
    /*
     * The failure this is written against: a page and a world with the same seed, the same graph
     * and different layer lists agree on eight hex characters and disagree about the height of
     * every tile under a mountain. `countryStamp` is the only thing either half asks before it
     * believes the other, so the list has to be in it.
     */
    const none = countryStamp(empty);
    expect(countryStamp(empty, [ONE])).not.toBe(none);
    expect(countryStamp(empty, [ONE, TWO])).not.toBe(countryStamp(empty, [ONE]));
    expect(countryStamp(empty, [layer(0, 0, 400, 21)])).not.toBe(countryStamp(empty, [ONE]));
    expect(countryStamp(empty, [layer(1, 0, 400, 20)])).not.toBe(countryStamp(empty, [ONE]));
  });

  it('says two worlds agree when their layers are the same list in a different order', () => {
    expect(countryStamp(empty, [TWO, ONE])).toBe(countryStamp(empty, [ONE, TWO]));
  });

  it('is what it always was for a world with no layers', () => {
    // every world saved before today has an empty list, and its fingerprint must not move under it
    expect(countryStamp(empty, [])).toBe(countryStamp(empty));
  });
});

/**
 * And the whole of it, through the one call that grows a patch.
 *
 * The arithmetic above is worth nothing on its own: a layer that sums perfectly and never reaches
 * the ground is a layer nobody will ever stand on. So this grows real country twice — once as the
 * seed alone describes it and once with a range written into the world — and holds the difference
 * to three things: that it is there at all, that the water was planned against it rather than
 * against the ground underneath it, and that it is the same difference every time.
 *
 * The first of those is asserted before either of the others, deliberately. A determinism test that
 * passes because both sides computed nothing is the classic way to prove a feature that is not
 * wired up at all.
 *
 * A 128-tile window rather than a whole patch: it costs about two and a half seconds against
 * eighteen, and nothing here is about the size of a square.
 */
describe('a patch grown with the layers its world was authored with', () => {
  const WITHIN = { x0: 0, z0: 0, x1: 128, z1: 128 };
  const SEED = 11;
  /*
   * A land tile near the middle of the window, found by scanning outward from it rather than
   * chosen: a wet tile leaves `sampleTile` before the country's height is read at all, so a height
   * assertion on one would pass while proving nothing.
   */
  const AT = { x: 57, z: 55 };
  const LIFT = 24;
  const range: Highland[] = [{ x: AT.x, z: AT.z, reach: 300, lift: LIFT }];

  const heightAt = (sampler: TerrainSampler, x: number, z: number): number => {
    const tile = sampler.newSample();
    sampler.sampleTile(x, z, tile);
    return tile.height;
  };
  const coursesOf = (sampler: TerrainSampler): string =>
    sampler.hydro.rivers.map((river) => river.map((n) => `${n.x.toFixed(3)},${n.z.toFixed(3)}`).join('|')).join(' ');

  const bare = growPatch(SEED, WITHIN);
  const lifted = growPatch(SEED, WITHIN, range);

  it('stands the ground up where the layer is, and by what the layer says', () => {
    const was = heightAt(bare, AT.x, AT.z);
    expect(was, 'the tile the scan found is not dry after all').toBeGreaterThan(0);
    // the middle of a layer gets the whole of its lift, which is terraces, and a terrace is STEP
    expect(heightAt(lifted, AT.x, AT.z) - was).toBeCloseTo(LIFT * WORLD.STEP, 6);
  });

  it('plans its rivers against the layered ground rather than the ground underneath it', () => {
    /*
     * #322's first worry, in the smallest form it has here. The hydrology runs before the sampler
     * exists and the ground is cut down to the courses it chose, so a river planned without the
     * layer would be a river running through a hill that appeared after it was surveyed. On this
     * seed the layer is worth a whole extra river — eleven courses against twelve — which is the
     * planner demonstrably reading it.
     */
    expect(coursesOf(lifted)).not.toBe(coursesOf(bare));
    expect(lifted.hydro.rivers.length).not.toBe(bare.hydro.rivers.length);
  });

  it('grows the same country from the same list, every time it is asked', () => {
    const again = growPatch(SEED, WITHIN, range);
    expect(heightAt(again, AT.x, AT.z)).toBe(heightAt(lifted, AT.x, AT.z));
    expect(coursesOf(again)).toBe(coursesOf(lifted));
    expect(countryStamp(again.graph, range)).toBe(countryStamp(lifted.graph, range));
    // and a different country from a different list, which is what makes the list part of a world
    expect(countryStamp(bare.graph)).not.toBe(countryStamp(lifted.graph, range));
  });

  it('is put back together from its parts as the country it was grown as', () => {
    /*
     * The layers travel with the patch rather than being remembered separately by whoever rebuilds
     * one — see `PatchParts`. Rebuilt without them, this ground would be twelve units lower on the
     * page than in the worker that grew it, and nothing would say so.
     */
    const parts = partsOf(lifted);
    expect(parts.layers).toEqual(range);
    expect(heightAt(rebuildPatch(SEED, WITHIN, parts), AT.x, AT.z))
      .toBe(heightAt(lifted, AT.x, AT.z));
  });
});
