import { describe, expect, it } from 'vitest';
import { holds } from './deeds';
import { commission, cutOf, owing, settle, type Work } from './works';

/**
 * A purchase with a lead time.
 *
 * The distinction is the point: an ordinary purchase is settled the moment it happens and this is
 * not. You pay, he builds, and two months later you are handed a house — so there is a stretch in
 * the middle where each of you owes the other something, and the two moments money moves are
 * ordering it and settling up. They follow deliberately opposite rules.
 */

const job = (price: number, paid = 0): Work => ({ price, paid });

describe('what is still owed', () => {
  it('is the price less what has been handed over', () => {
    expect(owing(job(420, 100))).toBe(320);
  });

  it('is never negative, because it goes straight into a sentence', () => {
    expect(owing(job(420, 500))).toBe(0);
  });
});

describe('ordering a thing that has to be made', () => {
  it('hands over the deposit and remembers it against the job', () => {
    const hero = { gold: 500 };
    const builder = { gold: 0 };
    const house = job(420);
    expect(commission(holds(hero), holds(builder), house, 100).afforded).toBe(true);
    expect(hero.gold).toBe(400);
    expect(builder.gold).toBe(100);
    expect(owing(house)).toBe(320);
  });

  it('is all or nothing, because nobody lays four fifths of a foundation', () => {
    const hero = { gold: 40 };
    const builder = { gold: 0 };
    const house = job(420);
    expect(commission(holds(hero), holds(builder), house, 100)).toEqual({ paid: 0, afforded: false });
    expect(hero.gold, 'a payer who could not strike the bargain was charged anyway').toBe(40);
    expect(house.paid).toBe(0);
  });

  it('will not take more than the job is worth, however generous the caller', () => {
    // an overpayment is money the books cannot account for afterwards
    const hero = { gold: 5000 };
    const builder = { gold: 0 };
    const house = job(420);
    commission(holds(hero), holds(builder), house, 1000);
    expect(builder.gold).toBe(420);
    expect(owing(house)).toBe(0);
  });

  it('does nothing for a job already paid for', () => {
    const hero = { gold: 500 };
    const house = job(420, 420);
    expect(commission(holds(hero), holds({ gold: 0 }), house, 100)).toEqual({ paid: 0, afforded: true });
    expect(hero.gold).toBe(500);
  });
});

describe('settling up', () => {
  it('clears the balance when it can be covered', () => {
    const hero = { gold: 500 };
    const builder = { gold: 0 };
    const house = job(420, 100);
    expect(settle(holds(hero), holds(builder), house).afforded).toBe(true);
    expect(builder.gold).toBe(320);
    expect(owing(house)).toBe(0);
  });

  it('pays down what it can when it cannot, which is the opposite rule to ordering it', () => {
    /*
     * A bargain you cannot afford is one you do not strike; a debt you cannot cover is one you pay
     * down. A house half paid for is a house standing there with a balance on it and a village that
     * hears about it every day — which is a far better thing for a game to do with a debt than to
     * refuse the money.
     */
    const hero = { gold: 50 };
    const builder = { gold: 0 };
    const house = job(420, 100);
    expect(settle(holds(hero), holds(builder), house)).toEqual({ paid: 50, afforded: false });
    expect(hero.gold).toBe(0);
    expect(owing(house)).toBe(270);
  });

  it('asks nothing of somebody who owes nothing', () => {
    const hero = { gold: 500 };
    expect(settle(holds(hero), holds({ gold: 0 }), job(420, 420)).paid).toBe(0);
    expect(hero.gold).toBe(500);
  });

  it('never loses a coin between the two of them, however it is paid', () => {
    const hero = { gold: 300 };
    const builder = { gold: 17 };
    const house = job(420);
    const before = hero.gold + builder.gold;
    commission(holds(hero), holds(builder), house, 100);
    settle(holds(hero), holds(builder), house);
    expect(hero.gold + builder.gold).toBe(before);
    expect(house.paid).toBe(300);
  });
});

describe('a share of the takings', () => {
  it('is a fraction of whatever turned up', () => {
    expect(cutOf(100, 0.25)).toBe(25);
  });

  it('leaves the odd penny with whoever won it', () => {
    // a share of one gold three ways is nothing each, which is what a share of one coin means
    expect(cutOf(1, 0.33)).toBe(0);
  });

  it('cannot be more than the whole of it, or less than nothing', () => {
    expect(cutOf(100, 5)).toBe(100);
    expect(cutOf(100, -2)).toBe(0);
    expect(cutOf(-100, 0.5)).toBe(0);
  });
});
