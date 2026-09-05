import { describe, expect, it } from 'vitest';
import { PROSPER, earnedInADay, feeFor, luxuryFor, saidOfWealth, storeysFor } from './prosperity';
import type { Person } from './people';

const person = (trade: string): Person => ({
  id: 'x', name: 'Maren', village: 'Ashford', trade, born: -30, lives: 70,
  mother: '', father: '', knows: [], memories: [], purse: 0,
});

/**
 * Money went into the economy and nothing ever came of it: a villager's purse lived on the entity
 * in the street and emptied the moment the player walked away. These pin the rules that make a
 * village's wealth something that accumulates, that the player can protect, and that shows.
 */
describe('what a village is worth', () => {
  it('pays the trades that handle everybody else money best', () => {
    expect(earnedInADay(person('shopkeeper'), 0)).toBeGreaterThan(earnedInADay(person('farmer'), 0));
  });

  it('pays a child nothing, because a trade is what starts a purse', () => {
    expect(earnedInADay(person(''), 0)).toBe(0);
  });

  it('stops the money entirely while the place is being raided', () => {
    expect(earnedInADay(person('shopkeeper'), 0.9)).toBe(0);
    expect(earnedInADay(person('shopkeeper'), 0)).toBeGreaterThan(0);
  });

  it('puts a second storey on a house once its owner can afford one', () => {
    expect(storeysFor(0)).toBe(1);
    expect(storeysFor(PROSPER.STOREY - 1)).toBe(1);
    expect(storeysFor(PROSPER.STOREY)).toBe(2);
  });

  it('builds nothing grand until the whole village can afford it between them', () => {
    expect(luxuryFor(PROSPER.STOREY, 1)).toBe('none');
    expect(luxuryFor(PROSPER.LUXURY, 0)).not.toBe('none');
  });

  it('charges a visitor for the luxury and nothing for a village without one', () => {
    expect(feeFor('none')).toBe(0);
    expect(feeFor('sauna')).toBeGreaterThan(0);
  });

  it('describes a village rather than quoting a number at anybody', () => {
    expect(saidOfWealth(0, 10)).toContain('poor');
    expect(saidOfWealth(PROSPER.STOREY * 20, 10)).toContain('very well');
  });

  it('takes a real stretch of quiet days to build anything', () => {
    // a fortnight of peace should not turn a farmer into a landlord
    expect(storeysFor(earnedInADay(person('farmer'), 0) * 14)).toBe(1);
  });
});
