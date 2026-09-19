import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { HoldingBook, type HoldingDay } from './holdingbook';
import { ownerFromSave } from './holdings';
import { purseOf } from './deeds';
import { PROSPER } from './prosperity';
import type { Person } from './people';

/**
 * The daily book of what a holding paid for — #264's fourth line.
 *
 * *"Keep every fact and bound nothing"*, keyed by the holding rather than by the person, folded
 * nowhere. The three tests that matter are that the two ways a village comes to exist write the
 * same book, that a morning is a row rather than an addition to a total, and that the thing the
 * issue warned about — a summed checkpoint — really would be wrong rather than merely inelegant.
 *
 * How big it gets is not asserted here. A bound written into a test is a bound somebody has decided
 * on, and the issue asked for the opposite: *"report the book's measured size after a hundred days
 * in the bench rather than arguing about it"*. `chore test economy` prints it.
 */

const TRADES = ['farmer', 'seller', 'builder', 'hunter', 'woodcutter'];

/** Lived forward a day at a time, which is what a page that was there does. */
const livedForward = (seed: number, to: number): Register => {
  const book = new Register(seed, 1);
  book.settle('Ashford', 6, TRADES);
  for (let day = 2; day <= to; day++) book.advance(day);
  return book;
};

/** Founded once and caught up inside `settle`, which is what `relive` does. */
const relived = (seed: number, to: number): Register => {
  const book = new Register(seed, to);
  book.settle('Ashford', 6, TRADES);
  return book;
};

/** Every morning every holding in the village ever posted anybody, flattened for comparison. */
const wholeBook = (register: Register): unknown[] => (register.madeOf('Ashford').holdings ?? [])
  .flatMap((holding) => register.holdingsBook.on(holding.id));

describe('the book a village keeps of its holdings', () => {
  /*
   * Seed 7 rather than any seed: it was scanned for one where posts actually stand, because a
   * village that hired nobody in a hundred days would give two empty books and an assertion that
   * cannot fail. On seed 7 over 120 days the book holds 243 mornings across 6 of the village's 15
   * holdings — every one of them a yard, because a farm posts a gate only under a band and nothing
   * leans on this village.
   */
  const SEED = 7;
  const DAYS = 120;

  it('replays identically, whichever way the village was lived', () => {
    const there = wholeBook(livedForward(SEED, DAYS));
    const after = wholeBook(relived(SEED, DAYS));
    expect(there.length, 'nobody stood a post in this village at all').toBeGreaterThan(0);
    expect(after).toEqual(there);
  });

  it('keeps a row for each morning rather than a running total', () => {
    const register = livedForward(SEED, DAYS);
    const holdings = register.madeOf('Ashford').holdings ?? [];
    const busiest = holdings
      .map((holding) => register.holdingsBook.on(holding.id))
      .sort((one, two) => two.length - one.length)[0];

    // the precondition: a holding that posted somebody on more than one morning, or "not folded"
    // is a claim about a list of one and proves nothing
    expect(busiest.length, 'no holding posted anybody twice').toBeGreaterThan(1);
    const days = busiest.map((fact) => fact.day);
    expect(new Set(days).size, 'two rows share a morning').toBe(days.length);
    expect([...days].sort((one, two) => one - two), 'the mornings are out of order').toEqual(days);
    expect(busiest.every((fact) => fact.holding === busiest[0].holding)).toBe(true);
  });

  /*
   * A village is re-founded and lived again whenever anybody learns something late about its past,
   * and `foundOn` re-founds one whenever a page and the world disagree about which trades a place
   * supports. Both walk mornings the book already has. Keyed by holding and morning, so writing one
   * twice is writing it once — added rather than set, a village re-lived twice would have paid its
   * builders twice over and nothing would have said so.
   */
  it('is the same book after the same village is founded a second time', () => {
    const register = relived(SEED, DAYS);
    const once = wholeBook(register);
    register.foundOn('Ashford', 6, [...TRADES, 'fisherman']);   // a different list, so it re-founds
    register.foundOn('Ashford', 6, TRADES);                     // and back, which lives it again
    expect(wholeBook(register)).toEqual(once);
  });

  /*
   * That a morning is a morning, which is the property the whole replay rests on and which the
   * register-level comparison above cannot see on its own: both ways of living a village were
   * equally wrong before, so a book that answered "the last thing I was told about this man"
   * satisfied them both. Asked of the book directly there is nowhere for that to hide.
   */
  it('answers about the morning asked for and not the last one it was told about', () => {
    const book = new HoldingBook();
    const fact = (day: number, wage: number): HoldingDay => ({
      day, holding: 'y1', kind: 'crew', who: 'bob', funder: ownerFromSave('rich'), wage, paid: wage,
    });

    book.stood('Ashford', 5, [fact(5, 12)], new Map([[ownerFromSave('bob'), 12]]));
    expect(book.paidTo('bob', 5)).toBe(12);
    expect(book.paidTo('bob', 6), 'yesterday\'s wage answered for today').toBe(0);

    // and a morning that stood a post but moved no money reads as nought rather than as yesterday
    book.stood('Ashford', 6, [fact(6, 12)], new Map());
    expect(book.paidTo('bob', 6), 'a morning nothing moved on answered with an older one').toBe(0);
    expect(book.on('y1').map((one) => one.day), 'both mornings are facts about the yard').toEqual([5, 6]);
  });

  /*
   * Why the book may not keep a total, which is the part of #264 that is an argument rather than a
   * feature. Written as a test because it is a claim about `deeds.ts` and claims about other files
   * go stale: if the cap is ever lifted, this goes red and somebody gets to decide again rather
   * than discovering a checkpoint that mints money.
   */
  it('could not be summed, because a purse is clamped at both ends', () => {
    const rich = { purse: PROSPER.MOST - 100 } as Person;
    const purse = purseOf(rich);
    purse.give(200);
    purse.take(200);
    expect(rich.purse, 'the cap no longer binds; re-argue the book').toBe(PROSPER.MOST - 200);
    expect(rich.purse, 'a sum of the two days would have said this').not.toBe(PROSPER.MOST - 100);
  });
});
