import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';
import { COUNTRY_WIDTH, acrossCountry, widthBeside } from './countryside';

/**
 * The strip of country beside a road, which decides how the ground between two roads is stepped.
 *
 * This is a rule that used to be written out twice, and the two copies disagreed in a way nothing
 * could see. A world with an edge writes the width of its countryside on each road; a country
 * without one cannot, because its land is a shape rather than a band, so `localgraph.ts` writes
 * `Infinity` and means it. One copy of the rule knew that and answered the fixed width; the other
 * took the edge at its word. Dividing by infinity gives nought, nought across the countryside means
 * no rise, and an endless world came out with every tile at the level of its nearest road — no
 * terraces stepping away from it, no high ground standing above them, a country drawn as one
 * rounded swell where the rest of this game is drawn in steps.
 *
 * So what is pinned here is small and load-bearing: the width of a shaped country does not depend
 * on the road, and the share across it never runs past one however far from a road you stand.
 */

const SOME_NOISE = new Simplex2D(4242);

/** A road in a country with no edge: a real surface, and no honest band to report either side. */
const SHAPED_EDGE = { roadWidth: 2.2, width: Infinity };

/** And one in a world that ends, where the width of the countryside is written on the road. */
const BOUNDED_EDGE = { roadWidth: 3, width: 30 };

describe('how wide the countryside beside a road is', () => {
  it('gives a shaped country a width of its own rather than the road\'s', () => {
    // the fault, stated as one line: an edge that says Infinity must never be the answer
    for (const [x, z] of [[0, 0], [120, -40], [-2000, 900]]) {
      expect(widthBeside(true, SHAPED_EDGE, SOME_NOISE, x, z)).toBe(COUNTRY_WIDTH);
    }
    expect(Number.isFinite(COUNTRY_WIDTH), 'the width of a patch is a number of tiles').toBe(true);
  });

  it('does not ask the road at all when the land is a shape', () => {
    // not merely "gives the same answer today": the edge is not consulted, so nothing anybody
    // writes on a road in a patchwork can leak back into the ground
    const absurd = { roadWidth: 900, width: Number.NaN };
    expect(widthBeside(true, absurd, SOME_NOISE, 10, 10)).toBe(COUNTRY_WIDTH);
  });

  it('lets a bounded world\'s countryside wander, and keeps a verge whatever it does', () => {
    let narrowest = Infinity, widest = 0;
    for (let x = 0; x < 400; x += 7) {
      const w = widthBeside(false, BOUNDED_EDGE, SOME_NOISE, x, x * 0.6);
      narrowest = Math.min(narrowest, w);
      widest = Math.max(widest, w);
      expect(w, 'the countryside is narrower than the road through it').toBeGreaterThan(BOUNDED_EDGE.roadWidth);
    }
    expect(widest - narrowest, 'a country exactly one width wide reads as a corridor').toBeGreaterThan(1);
  });
});

describe('how far across that countryside a point stands', () => {
  it('is nought at the verge and one at the far side', () => {
    expect(acrossCountry(BOUNDED_EDGE.roadWidth, BOUNDED_EDGE.roadWidth, 30)).toBe(0);
    expect(acrossCountry(30, BOUNDED_EDGE.roadWidth, 30)).toBe(1);
    expect(acrossCountry(16.5, BOUNDED_EDGE.roadWidth, 30)).toBeCloseTo(0.5, 5);
  });

  it('is held to one however far out in the open a road leaves you', () => {
    /*
     * A world with an edge never asks: past the far side of the band is sea, which is answered long
     * before this. A country whose land is a shape has roads sixty tiles apart over open ground, and
     * unclamped the same rule that gives a bounded world four terraces of relief gives an endless
     * one seventeen — a flight of stairs rather than stepped country.
     */
    for (const away of [COUNTRY_WIDTH, 40, 65, 300]) {
      expect(acrossCountry(away, 2.2, COUNTRY_WIDTH), `${away} tiles from a road`).toBe(1);
    }
  });

  it('gave nought for every tile of an endless world before the two halves of this agreed', () => {
    // the regression itself, kept because it is invisible from either call site alone: the width
    // came off the road, the road said Infinity, and the whole country went flat
    expect(acrossCountry(40, 2.2, SHAPED_EDGE.width)).toBe(0);
    expect(acrossCountry(40, 2.2, widthBeside(true, SHAPED_EDGE, SOME_NOISE, 0, 0))).toBe(1);
  });
});
