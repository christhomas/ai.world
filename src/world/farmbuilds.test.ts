import { describe, expect, it } from 'vitest';
import { BYRE, STABLES, beastsAt, oneSizeUp, workOf } from './stables';
import { costOfAStable, timberForAStable } from './growth';
import { whichFarmerBuilds } from './farmbuilds';

/**
 * A farmer pays a builder for a bigger stable.
 *
 * The ladder and its prices are old, and these examples keep the spending rule separate from its
 * daily committing edge: who qualifies, which rung they get, and what remains in their purse are
 * questions that should not need a whole village to answer.
 *
 * The decision is here rather than in the day for the same reason the hall's is in `growth.ts`: what
 * a farmer will and will not spend on is a rule, and a rule is a thing you can put a number into.
 */
describe('which farmer builds a bigger stable', () => {
  const A_FARM = 'Ashford-farm-1';
  const flush = { purse: 5000 };

  const asking = (over: Partial<Parameters<typeof whichFarmerBuilds>[0]> = {}) => whichFarmerBuilds({
    farms: [{ holding: A_FARM, worker: 'p1' }],
    purseOf: () => flush.purse,
    built: [],
    herd: BYRE.beasts,          // a full byre, which is the reason to build
    room: BYRE.beasts,
    timber: 1000,
    ...over,
  });

  it('is nobody, until a farm is actually full', () => {
    expect(asking({ herd: 1 })).toBeNull();
  });

  it('is the farmer whose byre is full and who can pay for the next rung', () => {
    const built = asking()!;
    expect(built.holding).toBe(A_FARM);
    expect(built.stable.id).toBe(oneSizeUp(BYRE).id);
    expect(built.gold).toBe(costOfAStable(oneSizeUp(BYRE)));
    expect(built.timber).toBe(timberForAStable(oneSizeUp(BYRE)));
  });

  it('is nobody where the village has no wood, however rich the farmer', () => {
    /*
     * The whole reason a stable is priced in timber as well as gold. A rich farmer will always find
     * four hundred coins; a village on a bare rock with no woodcutter in it should not be able to
     * double its herd by being wealthy.
     */
    expect(asking({ timber: 0 })).toBeNull();
    expect(asking({ timber: timberForAStable(oneSizeUp(BYRE)) - 1 })).toBeNull();
  });

  it('is nobody where the farmer cannot pay, however much wood is stacked', () => {
    expect(asking({ purseOf: () => 1 })).toBeNull();
  });

  it('leaves him something to live on', () => {
    // a farmer who spent his last coin on rails has bought a bigger shed and nothing to put in it
    const exactly = costOfAStable(oneSizeUp(BYRE));
    expect(asking({ purseOf: () => exactly })).toBeNull();
  });

  it('stops at the top of the ladder', () => {
    const top = STABLES[STABLES.length - 1];
    expect(asking({ built: [workOf(top, A_FARM)], herd: top.beasts, room: top.beasts })).toBeNull();
  });

  it('builds one a day and no more, whoever else is ready', () => {
    const two = asking({
      farms: [{ holding: 'f1', worker: 'p1' }, { holding: 'f2', worker: 'p2' }],
      herd: BYRE.beasts * 2,
      room: BYRE.beasts * 2,
    });
    expect(two).not.toBeNull();
    expect(two!.holding).toBe('f1');       // one answer, not a list
  });

  it('picks the fullest farm when two are ready', () => {
    const bigger = STABLES[1];
    const chosen = whichFarmerBuilds({
      farms: [{ holding: 'roomy', worker: 'p1' }, { holding: 'cramped', worker: 'p2' }],
      purseOf: () => 5000,
      built: [workOf(bigger, 'roomy')],
      herd: bigger.beasts + BYRE.beasts,
      room: bigger.beasts + BYRE.beasts,
      timber: 1000,
    })!;
    expect(beastsAt([workOf(bigger, 'roomy')], chosen.holding)).toBe(BYRE.beasts);
  });

});
