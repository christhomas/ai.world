import { describe, expect, it } from 'vitest';
import { Yard, type Stocking } from './yards';

/**
 * The mechanism a stack of something is, with the material taken out of it.
 *
 * `timber.ts` argued the case and every word of it is about *stacks* rather than about wood: a
 * history beside the stock, a standing week for a village nobody has looked at, a day's work
 * accounted through a morning that may have been missed, and a ceiling. Ore wants all four for a
 * smith, and copying two hundred lines to get them would be two hundred lines that then have to
 * agree with each other for ever.
 */
const A_STACK: Stocking = { A_DAY: 6, STANDING: 7, HOLDS: 240 };
const ASHFORD = 'Ashford';

describe('a village\'s stack of something', () => {
  it('starts a village that has people at work with what they have already done', () => {
    const yard = new Yard(A_STACK);
    yard.workedThrough(ASHFORD, 1, 1);
    // the standing week, and then the morning actually being lived: the first call is both the
    // opening of the yard and a day's work in it
    expect(yard.at(ASHFORD)).toBe(A_STACK.A_DAY * (A_STACK.STANDING + 1));
  });

  it('starts a village with nobody at work at nothing at all', () => {
    // the distinction the whole idea is about: a place on a bare rock differs from a place with a
    // wood behind it on the first afternoon rather than after one
    const yard = new Yard(A_STACK);
    yard.workedThrough('Stonedale', 0, 1);
    expect(yard.at('Stonedale')).toBe(0);
  });

  it('counts each missed morning rather than the interval as one day', () => {
    /*
     * The fault the day-keeping exists for. A fortnight away used to earn an afternoon's timber —
     * the first call accounted the whole interval and every call after it was a same-day no-op.
     */
    const yard = new Yard(A_STACK);
    yard.workedThrough(ASHFORD, 2, 1);
    const afterOne = yard.at(ASHFORD);
    for (let day = 2; day <= 11; day++) yard.workedThrough(ASHFORD, 2, day);
    expect(yard.at(ASHFORD) - afterOne, 'ten mornings of two workers').toBe(10 * 2 * A_STACK.A_DAY);
  });

  it('will not land the same day twice', () => {
    const yard = new Yard(A_STACK);
    yard.workedThrough(ASHFORD, 2, 5);
    const held = yard.at(ASHFORD);
    yard.workedThrough(ASHFORD, 2, 5);
    expect(yard.at(ASHFORD)).toBe(held);
  });

  it('stops at what it will hold', () => {
    const yard = new Yard(A_STACK);
    for (let day = 1; day < 500; day++) yard.workedThrough(ASHFORD, 2, day);
    expect(yard.at(ASHFORD)).toBe(A_STACK.HOLDS);
  });

  it('remembers what was carried in even after the stack is spent', () => {
    /*
     * A stock and a history are two different numbers, and the difference is a village that has
     * built something since. The wright pays back what somebody hauled in, not what is left.
     */
    const yard = new Yard(A_STACK);
    yard.brought(ASHFORD, 30);
    expect(yard.draw(ASHFORD, 30)).toBe(true);
    expect(yard.at(ASHFORD)).toBe(0);
    expect(yard.sold(ASHFORD), 'the hauling is not forgotten by the spending').toBe(30);
  });

  it('credits what was sold rather than what fitted', () => {
    // a seller whose logs meet a full yard has still been paid for them by a market that wanted them
    const yard = new Yard(A_STACK);
    yard.brought(ASHFORD, A_STACK.HOLDS + 100);
    expect(yard.at(ASHFORD)).toBe(A_STACK.HOLDS);
    expect(yard.sold(ASHFORD)).toBe(A_STACK.HOLDS + 100);
  });

  it('takes all of a job or none of it', () => {
    // half the timber for a house is a house nobody can start, and a yard emptied by a job that was
    // then refused is a village that lost its wood to a conversation
    const yard = new Yard(A_STACK);
    yard.land(ASHFORD, 20);
    expect(yard.draw(ASHFORD, 40)).toBe(false);
    expect(yard.at(ASHFORD), 'nothing was taken').toBe(20);
    expect(yard.shortBy(ASHFORD, 40)).toBe(20);
  });

  it('reads a save written before the days were kept, and dates it honestly', () => {
    /*
     * The only honest baseline is the day the save was written: the workers had worked up to then
     * and not past it. Without it the first morning back credits a single day however long the game
     * was shut.
     */
    const yard = new Yard(A_STACK, { [ASHFORD]: 60 }, 40);
    expect(yard.at(ASHFORD)).toBe(60);
    yard.workedThrough(ASHFORD, 1, 45);
    expect(yard.at(ASHFORD) - 60, 'five mornings, not one').toBe(5 * A_STACK.A_DAY);
  });

  it('round-trips through a save', () => {
    const yard = new Yard(A_STACK);
    yard.brought(ASHFORD, 25);
    yard.workedThrough(ASHFORD, 1, 3);
    const back = new Yard(A_STACK, yard.toJSON());
    expect(back.at(ASHFORD)).toBe(yard.at(ASHFORD));
    expect(back.sold(ASHFORD)).toBe(yard.sold(ASHFORD));
    // and the day comes with it, so reopening does not re-credit the morning already counted
    back.workedThrough(ASHFORD, 1, 3);
    expect(back.at(ASHFORD)).toBe(yard.at(ASHFORD));
  });
});
