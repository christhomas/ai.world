import { describe, expect, it } from 'vitest';
import { WATCH_WAGE, WORKS, mayorOf, nextWork, whatTheHallBuys, whoStandsWatch } from './hall';
import { Register } from './register';
import { isARoof } from './roofs';
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
    // the houses a growing village raises go into the same list — see `growth.ts` — and they are
    // not on the hall's wish list at all: a roof is a need and this is the order the wants come in.
    // They carry the size they came out at, so they are recognised rather than spelled out here
    expect(works.filter((work) => !isARoof(work))[0]).toBe(WORKS[0].id);
  });
});

/**
 * The man on the tower.
 *
 * A watchtower is the only thing a hall buys that goes on costing after it is built, which is what
 * makes it interesting rather than decorative: a well is dug and then it is simply a well, and a
 * tower with nobody on it is scenery. So the village carries a wage for as long as it wants to be
 * watched, and this is the first standing cost this economy has ever had.
 */
describe('who is on the tower', () => {
  const aged = (id: string, born: number): Person => ({ id, trade: '', born } as Person);

  it('is nobody at all until the village has built one', () => {
    expect(whoStandsWatch(1e6, [], [aged('a', 0)])).toBeNull();
    expect(whoStandsWatch(1e6, ['well', 'storey'], [aged('a', 0)])).toBeNull();
  });

  it('is somebody with no trade of their own, because a smith is not taken off the forge', () => {
    const people = [worker('smith'), aged('idle', 5)];
    expect(whoStandsWatch(1e6, ['watchtower'], people)?.who).toBe('idle');
  });

  it('is the youngest when everybody has a trade, the way any village would decide it', () => {
    const old = { ...worker('old'), born: 0 } as Person;
    const young = { ...worker('young'), born: 20 } as Person;
    expect(whoStandsWatch(1e6, ['watchtower'], [old, young])?.who).toBe('young');
  });

  it('is nobody on a morning the village cannot pay him', () => {
    // an empty tower is exactly what running out of money looks like, and it is honest to show it
    expect(whoStandsWatch(WATCH_WAGE - 0.01, ['watchtower'], [aged('a', 0)])).toBeNull();
    expect(whoStandsWatch(WATCH_WAGE, ['watchtower'], [aged('a', 0)])?.wage).toBe(WATCH_WAGE);
  });

  it('is the same man every morning while nothing about the village changes', () => {
    // derived rather than appointed: two asks of the same village give the same answer, which is
    // what lets a village re-lived from its founding arrive where everybody else already is
    const people = [aged('b', 3), aged('a', 9)];
    expect(whoStandsWatch(1e6, ['watchtower'], people)?.who)
      .toBe(whoStandsWatch(1e6, ['watchtower'], [...people].reverse())?.who);
  });
});

describe('a village with a tower to man', () => {
  it('pays the man on it out of the treasury, day after day', () => {
    const register = new Register(4, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter', 'soldier']);
    // long enough to raise a well, a second storey and a tower, and then to stand somebody on it
    register.advance(1200);
    expect(register.worksOf('Testing'), 'the village never got as far as a tower').toContain('watchtower');
    const manned = register.watchOf('Testing');
    expect(manned, 'a tower was built and nobody was ever stood on it').not.toBe('');
    expect(register.hallPaid(manned), 'the watchman worked for nothing').toBeGreaterThan(0);
  });
});

describe('who speaks for the village', () => {
  const settled = (id: string, born: number, trade = 'farmer'): Person => ({ id, born, trade } as Person);

  it('is the longest-settled of the people who hold a trade', () => {
    const people = [settled('young', 20), settled('old', 2), settled('middling', 9)];
    expect(mayorOf(people)?.id).toBe('old');
  });

  it('is never a child, because a village is not spoken for by its children', () => {
    const people = [settled('child', 0, ''), settled('grown', 14)];
    expect(mayorOf(people)?.id).toBe('grown');
  });

  it('is the same man on two machines reading the same village', () => {
    // the tie falls on the id rather than on the order of the roll, which is not the same order
    // everywhere: a village re-lived from its founding arrives at its people in its own sequence
    const people = [settled('b', 4), settled('a', 4)];
    expect(mayorOf(people)?.id).toBe(mayorOf([...people].reverse())?.id);
  });

  it('is nobody at all in a village with nobody in it', () => {
    expect(mayorOf([])).toBeNull();
    expect(mayorOf([settled('child', 0, '')])).toBeNull();
  });

  it('is somebody else the morning after he dies, without anything having to notice', () => {
    const register = new Register(88, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter']);
    const was = register.mayorOf('Testing');
    expect(was).not.toBeNull();
    register.bury(was!.id, 31);
    const now = register.mayorOf('Testing');
    expect(now).not.toBeNull();
    expect(now!.id).not.toBe(was!.id);
  });

  it('is a real villager rather than a body in a coat', () => {
    // which is the whole point: the man behind the desk of the building that holds a village's
    // money now has a name, a family, a purse and a trade, like everybody else who lives there
    const register = new Register(88, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter']);
    const mayor = register.mayorOf('Testing')!;
    expect(register.find(mayor.id)).toBeDefined();
    expect(mayor.name).toMatch(/\S+ \S+/);
  });
});
