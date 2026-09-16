import { describe, expect, it } from 'vitest';
import { PICTURES, differenceBetween, tellsApart } from './pictures';

/**
 * Whether two pictures of the same place are the same picture.
 *
 * Nothing in this repository could answer that. `tools/shots.cjs` pins the world, the seed, the
 * camera and what has to happen first, so a shot can be retaken exactly — and then nothing reads two
 * of them. Not the script, and nothing in `checks.yml` looks at `docs/screenshots/` at all.
 *
 * That is the gap under every graphics item on the list. #249's acceptance is *"reference
 * screenshots before and after are identical"* and #250's is *"with the switch off, the G0 reference
 * screenshots are unchanged"* — and the risk #250 names is exactly the one a person is worst at
 * spotting by eye: **shared tuning**. The sun at 2.6, the ambient at 0.45, the shadow bias. Move one
 * for a new render path and the old path changes with it, by an amount nobody notices in two windows
 * an hour apart and everybody notices a fortnight later.
 *
 * So: a number, and a threshold with a reason.
 *
 * ## Why a share of pixels rather than a mean
 *
 * A mean hides the thing worth catching. One prop drawn in the wrong place is a handful of pixels
 * wrong by a lot, and it comes out in a mean as a rounding error against a million pixels that
 * agree. A share of pixels that moved *at all beyond a threshold* says "something is in a different
 * place"; a mean says "everything is very slightly different", which is the answer to a different
 * question.
 */

/** A picture as this compares them: raw RGBA, which is what a PNG decodes to. */
const picture = (...pixels: number[][]): { width: number; height: number; data: Uint8ClampedArray } => ({
  width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()),
});
const grey = (n: number) => [n, n, n, 255];

describe('comparing two pictures of the same place', () => {
  it('says nothing changed when nothing changed', () => {
    const one = picture(grey(10), grey(20), grey(30));
    expect(differenceBetween(one, one).share).toBe(0);
  });

  it('says everything changed when everything did', () => {
    const before = picture(grey(0), grey(0), grey(0));
    const after = picture(grey(255), grey(255), grey(255));
    expect(differenceBetween(before, after).share).toBe(1);
  });

  it('counts a pixel that moved, not how far the average moved', () => {
    // one pixel wrong by a lot, against two that agree: a third of the picture, not a rounding error
    const before = picture(grey(10), grey(10), grey(10));
    const after = picture(grey(250), grey(10), grey(10));
    expect(differenceBetween(before, after).share).toBeCloseTo(1 / 3, 5);
  });

  it('ignores a difference too small for anybody to see, because a compressor is not a change', () => {
    const before = picture(grey(100), grey(100));
    const after = picture(grey(100 + PICTURES.A_SHADE - 1), grey(100));
    expect(differenceBetween(before, after).share).toBe(0);
  });

  it('refuses to compare pictures of different sizes rather than guessing', () => {
    const before = picture(grey(1));
    const after = picture(grey(1), grey(1));
    expect(() => differenceBetween(before, after)).toThrow(/size/i);
  });
});

describe('whether that difference is worth failing over', () => {
  it('passes a picture that did not move', () => {
    expect(tellsApart(0)).toBe(false);
  });

  it('fails a picture where a visible share of it moved', () => {
    expect(tellsApart(0.5)).toBe(true);
  });

  it('has a threshold above nought, because a renderer is not deterministic to the bit', () => {
    // two runs of the same scene on the same machine differ slightly: antialiasing along an edge,
    // a float that rounded the other way. A threshold of exactly nought is a check that cries wolf
    // until somebody turns it off, which is the failure this repository names in three other places
    expect(PICTURES.TOO_MUCH).toBeGreaterThan(0);
    expect(PICTURES.TOO_MUCH, 'and small enough to catch a shifted prop').toBeLessThan(0.05);
  });
});
