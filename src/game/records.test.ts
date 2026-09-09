import { describe, expect, it } from 'vitest';
import { Register } from '../world/register';
import { FEES, theBirths, theCharges, theRoll, theStones, yearsOld } from './records';

/**
 * The records are a window on the simulation, so what they are tested for is whether the view
 * through them is the same as the thing behind them.
 *
 * These exist as much for whoever is checking that the economy works as for anybody reading them in
 * a game: a village that quietly stopped paying anybody, or buried people without writing it down,
 * or grew children who never aged, would look exactly like a working village from outside. The rows
 * are where that shows.
 */
describe('the books a village keeps', () => {
  /** A village, lived forward a while, so there is something in the books. */
  function lived(days: number): { register: Register; village: string } {
    const register = new Register(1234);
    register.settle('Stonemere', 6, ['farmer', 'smith', 'baker']);
    register.advance(days);
    return { register, village: 'Stonemere' };
  }

  it('counts the same souls the register has', () => {
    const { register, village } = lived(30);
    const roll = theRoll(register, village, 30);
    expect(roll.rows.length).toBe(register.living(village).length);
    expect(roll.rows.length, 'a village with nobody in it').toBeGreaterThan(0);
    expect(roll.gist.join(' ')).toContain(String(roll.rows.length));
  });

  it('shows what people earn and what they have put by', () => {
    const { register, village } = lived(60);
    const roll = theRoll(register, village, 60);
    const working = roll.rows.filter((row) => row.trade);
    expect(working.length, 'nobody in this village has a trade').toBeGreaterThan(0);
    // the whole point of the ledger: money moves, and the books say so
    expect(working.some((row) => row.earns > 0), 'nobody earns anything at all').toBe(true);
    expect(working.some((row) => row.purse > 0), 'sixty days of work and nobody has saved a coin').toBe(true);
    // and the line a player reads says the same number the row does
    const first = working[0];
    // the row keeps the pennies so the books can be added up; the sentence rounds them off
    expect(roll.detail.join('\n')).toContain(`${Math.round(first.purse)} gold put by`);
  });

  it('writes the dead down, with what took them', () => {
    const register = new Register(99);
    register.settle('Ashstead', 5, ['farmer']);
    register.advance(20);
    const somebody = register.living('Ashstead')[0];
    expect(somebody, 'nobody to bury').toBeTruthy();
    register.bury(somebody.id, 20);

    const stones = theStones(register, 'Ashstead', 22);
    expect(stones.rows.some((row) => row.name === somebody.name && row.cause === 'violence')).toBe(true);
    expect(stones.rows[0].daysAgo, 'buried two days ago').toBe(2);
    expect(stones.gist.join(' ')).toMatch(/killed/i);
    expect(register.living('Ashstead').some((p) => p.id === somebody.id), 'still walking about').toBe(false);
  });

  it('says nothing is worth paying for when there is nothing to read', () => {
    const register = new Register(5);
    register.settle('Newton', 4, ['farmer']);
    // nobody has died yet, so the churchyard is free, because a fee for an empty book is a swindle
    expect(theStones(register, 'Newton', 1).fee).toBe(0);
    expect(theStones(register, 'Newton', 1).rows).toEqual([]);
    // and the roll is worth paying for, because there are people on it
    expect(theRoll(register, 'Newton', 1).fee).toBe(FEES.ROLL);
  });

  it('keeps the charge sheet of the village it is asked about', () => {
    const charges = [
      { who: 'You', village: 'Stonemere', day: 8, hours: 6, fine: 20 },
      { who: 'Wren', village: 'Oakcross', day: 9, hours: 2, fine: 5 },
    ];
    const here = theCharges(charges, 'Stonemere', 10, true);
    expect(here.rows).toHaveLength(1);
    expect(here.rows[0].who).toBe('You');
    expect(here.gist.join(' '), 'the sergeant says nothing about you being wanted').toMatch(/yours/i);
    expect(theCharges(charges, 'Millvale', 10, false).fee, 'charging for an empty sheet').toBe(0);
  });

  it('ages people by the same clock the world uses', () => {
    const { register, village } = lived(90);
    const roll = theRoll(register, village, 90);
    for (const row of roll.rows) {
      expect(row.age).toBe(yearsOld(row.born, 90));
      expect(row.age, 'somebody born in the future').toBeGreaterThanOrEqual(0);
    }
    const births = theBirths(register, village, 90);
    expect(births.rows.length).toBeGreaterThan(0);
    expect(births.rows.every((row) => row.lives > 0), 'the books have the dead down as living').toBe(true);
  });
});
