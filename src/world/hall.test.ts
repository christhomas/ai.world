import { describe, expect, it } from 'vitest';
import { WORKS, nextWork, whatTheHallBuys } from './hall';
import { Register } from './register';
import type { Person } from './people';

/**
 * What the hall does with what it has taken.
 *
 * The treasury's whole point. A pot that never spends will always out-accumulate every person in
 * the village, because a person has to buy dinner and a treasury does not — `chore sanity` measured
 * the hole at sixty-two per cent of all the money in the world after four hundred and fifty days,
 * and that is not a tax rate problem. Lowering the rate only slows it down.
 *
 * So the hall buys things and the money goes back to the people who raised it. What is pinned here
 * is that it buys what it can afford and no more, that it buys one thing at a time, that it saves
 * for the next thing rather than skipping to a cheaper one it has already built, and — the one that
 * the audit cares about — that every coin it spends lands in somebody's purse.
 */

const worker = (id: string): Person => ({ id, trade: 'farmer' } as Person);
const idle = (id: string): Person => ({ id, trade: '' } as Person);
const paid = (wages: Map<string, number>): number =>
  Math.round([...wages.values()].reduce((sum, much) => sum + much, 0) * 100) / 100;

describe('what a hall can afford', () => {
  it('buys nothing until it can pay outright, because a village does not borrow', () => {
    expect(nextWork(WORKS[0].costs - 1, [])).toBeNull();
    expect(nextWork(WORKS[0].costs, [])?.id).toBe(WORKS[0].id);
  });

  it('buys the cheapest thing it has not got, and saves for it rather than skipping ahead', () => {
    /*
     * The alternative — take whatever is affordable from the whole list — is a village that builds
     * a bath house while it still has no well, because the well happened to be bought last year and
     * the list is not a ladder. Cheapest-first with saving is what makes it a ladder.
     */
    const rich = WORKS[WORKS.length - 1].costs * 2;
    expect(nextWork(rich, [])?.id).toBe(WORKS[0].id);
    expect(nextWork(rich, [WORKS[0].id])?.id).toBe(WORKS[1].id);
    expect(nextWork(WORKS[0].costs, [WORKS[0].id]), 'it skipped to something it cannot pay for').toBeNull();
  });

  it('runs out when everything is built', () => {
    expect(nextWork(1e9, WORKS.map((w) => w.id))).toBeNull();
  });
});

describe('paying for it', () => {
  it('hands out exactly what the work cost, to the coin', () => {
    // the audit's whole complaint if this is wrong: money appearing in purses with nothing in any
    // book to explain it
    const bought = whatTheHallBuys(WORKS[0].costs, [], [worker('a'), worker('b'), worker('c')]);
    expect(bought).not.toBeNull();
    expect(paid(bought!.wages)).toBe(WORKS[0].costs);
  });

  it('gives the odd penny to somebody rather than losing it', () => {
    // three ways into nine hundred divides; seven does not, and dust is money the world invented
    const seven = Array.from({ length: 7 }, (_, n) => worker(`p${n}`));
    const bought = whatTheHallBuys(WORKS[0].costs, [], seven);
    expect(paid(bought!.wages)).toBe(WORKS[0].costs);
  });

  it('pays the people who work, and not the ones who do not', () => {
    const bought = whatTheHallBuys(WORKS[0].costs, [], [worker('a'), idle('b')]);
    expect([...bought!.wages.keys()]).toEqual(['a']);
  });

  it('builds nothing at all in a village with nobody to build it', () => {
    // a village of children and the very old does not raise a well by wishing
    expect(whatTheHallBuys(1e9, [], [idle('a'), idle('b')])).toBeNull();
  });
});

describe('a village that has been saving', () => {
  it('spends what it took, so the treasury is not a hole money falls into', () => {
    const register = new Register(4, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter', 'soldier']);
    // long enough to raise the price of the first thing on the list several times over
    register.advance(400);
    const works = register.worksOf('Testing');
    expect(works.length, 'four hundred days of taxes and the hall never bought anything').toBeGreaterThan(0);
    expect(works[0]).toBe(WORKS[0].id);
  });
});
