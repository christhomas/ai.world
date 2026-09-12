import { describe, expect, it } from 'vitest';
import { BEASTS_PER_FARM } from './holdings';
import {
  BYRE, STABLES, beastsAt, costOfAStable, herdRoomFor, holdingOfWork, isAStable, oneSizeUp,
  stableAt, stableOfWork, timberForAStable, workOf,
} from './stables';

/**
 * The first money in this game that buys capacity rather than a thing.
 *
 * Everything gold has ever bought here is an object you can walk up to — a house, a boat, a pool, a
 * jetty. A stable is a larger number: the farm looks much the same from the road and keeps twice
 * the beasts. These are about the three properties that make that safe to have — that it is a
 * ladder rather than a menu, that it survives a village being re-lived from its founding, and that
 * a farm nobody has built anything for is exactly the farm this world has always had.
 */

const ASHFORD = 'Ashford-farm-1';
const OTHER = 'Ashford-farm-2';

describe('what a farm can keep', () => {
  it('starts at the six every farm in this world has always had', () => {
    /*
     * The join that matters, and the reason it is a test rather than an import. `holdings.ts` owns
     * `BEASTS_PER_FARM` and says in as many words why it must not ask this file anything — a
     * holding is a fact about an owner and a stable is a fact about a building, and the two files
     * point one way. So the number is written twice on purpose, and this is what stops the two
     * copies drifting.
     */
    expect(BYRE.beasts).toBe(BEASTS_PER_FARM);
    expect(beastsAt([], ASHFORD), 'a farm nobody has built anything for changed').toBe(BEASTS_PER_FARM);
  });

  it('climbs a rung at a time and stops at the top', () => {
    // `roofs.ts`'s argument, and it holds for the same reason: a list you may skip about in is not
    // a ladder, so a farmer who wanted a barn and could afford a stable builds the stable
    const climbed = STABLES.map((stable) => oneSizeUp(stable).id);
    expect(climbed).toEqual(['stable', 'barn', 'steading', 'steading']);
    for (let at = 1; at < STABLES.length; at++) {
      expect(STABLES[at].beasts, `${STABLES[at].name} holds no more than ${STABLES[at - 1].name}`)
        .toBeGreaterThan(STABLES[at - 1].beasts);
    }
  });

  it('writes the size and the farm into the ledger, and reads both back', () => {
    /*
     * What makes a stable survive a village being re-lived from its founding without anything new
     * being stored: it goes into `works`, which is already replayed on every machine, and it is
     * `roofs.ts`'s trick with one more part. A village has one set of roofs; it may have four farms,
     * and a barn on one of them says nothing whatever about the other three.
     */
    const barn = workOf(STABLES[2], ASHFORD);
    expect(isAStable(barn)).toBe(true);
    expect(stableOfWork(barn).id).toBe('barn');
    expect(holdingOfWork(barn)).toBe(ASHFORD);
    expect(isAStable('house:longhouse'), 'a roof was counted as a stable').toBe(false);
  });

  it('keeps one farm out of the books of the farm next door', () => {
    const built = [workOf(STABLES[3], OTHER)];
    expect(beastsAt(built, OTHER)).toBe(STABLES[3].beasts);
    expect(beastsAt(built, ASHFORD), 'a steading next door made this farm bigger').toBe(BYRE.beasts);
  });

  it('takes the best thing on a farm rather than the last', () => {
    // you do not lose a building by putting a smaller one beside it, and a ledger that is replayed
    // had better not depend on the order it is replayed in
    const built = [workOf(STABLES[2], ASHFORD), workOf(STABLES[1], ASHFORD)];
    expect(stableAt(built, ASHFORD).id).toBe('barn');
    expect(stableAt([...built].reverse(), ASHFORD).id, 'the answer depended on the order').toBe('barn');
  });

  it('reads a size this build has never heard of as the byre it began with', () => {
    // the same courtesy `roofOfWork` pays a bare `house`: a save written by a later build has to
    // come out holding the beasts it held rather than none at all
    expect(stableOfWork(`stable:hangar:${ASHFORD}`).id).toBe('byre');
  });

  it('adds a village up out of its farms, which is what the herd cap wants', () => {
    /*
     * The number that replaces `farmers * BEASTS_PER_FARM` in `aDayOfCattle`. A village whose farms
     * are all byres comes out exactly where it is today, which is what makes this safe to land
     * before anybody has built anything — and a village with a barn on one farm comes out larger,
     * which is the whole of item 33.
     */
    const farms = [ASHFORD, OTHER];
    expect(herdRoomFor([], farms)).toBe(BEASTS_PER_FARM * 2);
    expect(herdRoomFor([workOf(STABLES[2], ASHFORD)], farms))
      .toBe(STABLES[2].beasts + BEASTS_PER_FARM);
    expect(herdRoomFor([], []), 'a village with no farms had room for cattle').toBe(0);
  });
});

describe('what a stable costs', () => {
  it('is quoted off the same day of building a village pays for its own roofs', () => {
    /*
     * Taken from `costOfARoof` rather than written out again, because two prices for one day's work
     * is how a builder ends up worth more to a family than to a farmer for the same morning. What is
     * checked here is only that the division came out as money: a constant that read another
     * module's constant while both were initialising is exactly the arithmetic that once handed
     * every village in the world a bill of `NaN`.
     */
    for (const stable of STABLES) {
      expect(Number.isFinite(costOfAStable(stable)), `${stable.name} costs NaN`).toBe(true);
      expect(costOfAStable(stable)).toBeGreaterThan(0);
    }
  });

  it('costs more for more room, and never less', () => {
    for (let at = 1; at < STABLES.length; at++) {
      expect(costOfAStable(STABLES[at])).toBeGreaterThan(costOfAStable(STABLES[at - 1]));
      expect(timberForAStable(STABLES[at])).toBeGreaterThan(timberForAStable(STABLES[at - 1]));
    }
  });

  it('wants wood as well as gold, which is the half a purse cannot argue with', () => {
    /*
     * The question this item was handed with, answered. A stable is posts and beams and boards and
     * almost nothing else, so it is the building that would be strangest without a timber price —
     * and a rich farmer on a bare rock with no logger in the village should not be able to double
     * his herd by being wealthy, which is the whole of what `timber.ts` was built to make true.
     */
    // a stable for twelve wants more wood than a house wants for four, which is forty — and
    // cheaper per beast than a house is per person, because a stall is smaller than a room
    expect(timberForAStable(STABLES[1])).toBeGreaterThan(40);
    expect(timberForAStable(STABLES[1]) / STABLES[1].beasts).toBeLessThan(40 / 4);
    // and it is the wooden building: nearly all of what it costs is timber rather than stone,
    // thatch and glazing, which is what makes a village with no logger unable to raise one
    expect(timberForAStable(STABLES[1]) * 5).toBeGreaterThan(costOfAStable(STABLES[1]) * 0.6);
  });
});
