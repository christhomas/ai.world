import { describe, expect, it } from 'vitest';
import { STABLES, herdRoomFor, workOf } from './stables';
import { aDayOfCattle } from './harvest';

/**
 * A herd is capped by the buildings standing on the farms, not by how many farms there are.
 *
 * The rest of item 33 (issue #5). `stables.ts` has the ladder — byre, stable, barn, steading, each
 * rung holding more than the last — and `herdRoomFor` already sums what a village's farms hold
 * between them. The sanity bench reads it. The simulation does not: `aDayOfCattle` caps at
 * `farms * HERD_PER_FARMER`, a flat constant, so a village that paid a builder to raise a barn
 * carries exactly as many beasts as one with two byres and the money went nowhere.
 *
 * That is the whole of what item 33 called "the first money in the game that buys *capacity* rather
 * than a thing" — and until this, it bought neither.
 */
describe('what a village can keep', () => {
  const barn = STABLES[2];
  const byre = STABLES[0];

  /**
   * Where a herd comes to rest, not what one morning does to it.
   *
   * A day sells a little off an over-full paddock rather than emptying it to the cap, so a single
   * call from four hundred beasts sheds the same amount whatever the cap is — which is what a first
   * version of this test asserted, and it failed for being about the wrong mechanism rather than
   * because the feature was missing. Run the days until it settles and the cap is what it settles
   * at.
   */
  const settles = (farms: string[], built: string[]): number => {
    // the room those farms hold between them, measured where the caller measures it — `aDayOfCattle`
    // takes the number rather than the works, to keep `harvest.ts` out of a module cycle
    const room = herdRoomFor(built, farms);
    let herd = 400;
    for (let day = 0; day < 600; day++) herd = aDayOfCattle(herd, farms, room).herd;
    return herd;
  };

  it('carries more when a farm has been built up than when it has not', () => {
    const twoByres = [workOf(byre, 'f1'), workOf(byre, 'f2')];
    const aBarnAndAByre = [workOf(barn, 'f1'), workOf(byre, 'f2')];
    expect(settles(['f1', 'f2'], aBarnAndAByre), 'a barn should hold more than the byre it replaced')
      .toBeGreaterThan(settles(['f1', 'f2'], twoByres));
  });

  it('settles at what the farms hold between them, which is the ladder added up', () => {
    expect(settles(['f1', 'f2'], [workOf(byre, 'f1'), workOf(byre, 'f2')]))
      .toBeCloseTo(byre.beasts * 2, 0);
    expect(settles(['f1', 'f2'], [workOf(barn, 'f1'), workOf(byre, 'f2')]))
      .toBeCloseTo(barn.beasts + byre.beasts, 0);
  });

  it('still answers for a village whose farms have no buildings recorded at all', () => {
    // every farm in every world before stables existed, and every farm the morning it is founded
    expect(settles(['f1', 'f2'], [])).toBeCloseTo(byre.beasts * 2, 0);
  });

  it('keeps nothing where there are no farms, however many buildings are standing', () => {
    expect(aDayOfCattle(400, [], herdRoomFor([workOf(barn, 'f1')], [])).herd).toBe(0);
  });
});
