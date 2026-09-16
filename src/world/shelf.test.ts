import { describe, expect, it } from 'vitest';
import { Register } from './register';

/**
 * A shelf that can run out, which is what makes a map worth walking.
 *
 * A `ShopDef` was a list of item ids and nothing else: buy every loaf in a hamlet and the hamlet had
 * exactly as many loaves as it started with, and was exactly as well fed. With local prices (#230)
 * alone that gets *worse* rather than better — prices would differ between villages and nothing the
 * hero did could move them, so the map would have a shape he could read and never change.
 *
 * So the shelf is the village's own store. Buying takes from it, selling adds to it, and the loop
 * closes: the village he keeps buying from runs short and dear, the one he keeps selling to grows
 * full and cheap. Nothing has to forbid him doing it too much.
 *
 * `takeFromLarder` and `addToLarder` are that door, and this is what they must not do: hand out food
 * a village does not have, or quietly accept more than a cellar holds. Both are how a coin — or a
 * meal — gets minted out of nothing, which is the one thing this economy is audited against.
 */

const village = (food: number): Register => {
  const book = new Register(1, 1);
  book.settle('Ashford', 8, ['farmer', 'seller']);
  book.setLarder('Ashford', food);
  return book;
};

describe('taking food off a village shelf', () => {
  it('takes what was asked for when the cellar has it', () => {
    const book = village(20);
    expect(book.takeFromLarder('Ashford', 3)).toBe(3);
    expect(book.larderOf('Ashford')).toBe(17);
  });

  it('hands out only what is there, never more', () => {
    const book = village(2);
    expect(book.takeFromLarder('Ashford', 5)).toBe(2);
    expect(book.larderOf('Ashford')).toBe(0);
  });

  it('gives nothing from an empty cellar, and says so rather than going negative', () => {
    const book = village(0);
    expect(book.takeFromLarder('Ashford', 4)).toBe(0);
    expect(book.larderOf('Ashford')).toBe(0);
  });

  it('gives nothing from a village nobody has settled', () => {
    const book = village(20);
    expect(book.takeFromLarder('Nowhere', 3)).toBe(0);
  });

  it('refuses a nonsense amount rather than adding food by asking for less than none', () => {
    const book = village(10);
    expect(book.takeFromLarder('Ashford', -5)).toBe(0);
    expect(book.larderOf('Ashford')).toBe(10);
  });
});

describe('putting food back on a village shelf', () => {
  it('adds what was sold to it', () => {
    const book = village(5);
    expect(book.addToLarder('Ashford', 4)).toBe(4);
    expect(book.larderOf('Ashford')).toBe(9);
  });

  it('will not take more than the cellar holds, because a store has a size', () => {
    const book = village(0);
    const cap = book.cellarOf('Ashford');
    expect(cap).toBeGreaterThan(0);
    expect(book.addToLarder('Ashford', cap + 50)).toBe(cap);
    expect(book.larderOf('Ashford')).toBe(cap);
  });

  it('takes nothing for a village nobody has settled', () => {
    const book = village(5);
    expect(book.addToLarder('Nowhere', 3)).toBe(0);
  });

  it('is exactly reversible while there is room, so a round trip mints no meal', () => {
    const book = village(20);
    const took = book.takeFromLarder('Ashford', 6);
    expect(book.addToLarder('Ashford', took)).toBe(6);
    expect(book.larderOf('Ashford')).toBe(20);
  });
});

/*
 * And the same door from the shop's side: buying food is the village being a loaf shorter.
 *
 * Kept here rather than in `talk.test.ts` because what is being asserted is the *village's* books,
 * not the dialogue. The shop is one caller of a shelf that would still have to balance if somebody
 * wrote a second one.
 */
describe('a hero buying off the shelf', () => {
  it('leaves the village short by what he took', () => {
    const book = village(20);
    const before = book.larderOf('Ashford');
    const took = book.takeFromLarder('Ashford', 2);
    expect(took).toBe(2);
    expect(book.larderOf('Ashford')).toBe(before - 2);
  });

  it('cannot be sold a loaf a village has not got, and the refusal costs it nothing', () => {
    const book = village(1);
    // asking for two out of a cellar of one takes the one; a caller that cannot use a part
    // puts it back, which must leave the village exactly as it was
    const got = book.takeFromLarder('Ashford', 2);
    expect(got).toBe(1);
    book.addToLarder('Ashford', got);
    expect(book.larderOf('Ashford')).toBe(1);
  });
});
