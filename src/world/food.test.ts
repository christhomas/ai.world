import { describe, expect, it } from 'vitest';
import { FOOD, cellarCap, eat, grownInADay, saidOfFood } from './food';
import type { Person } from './people';

const soul = (trade: string, purse = 50): Person => ({
  id: `p${Math.random()}`, name: 'Maren', village: 'Ashford', trade, born: -30, lives: 70,
  mother: '', father: '', knows: [], memories: [], purse, hungry: 0,
});

/**
 * The drain the economy needed. Gold matters because bread costs money, and a village's
 * prosperity matters because a poor village buries people. Two of these came from failures that
 * killed every village in the world, and both are the sort of thing arithmetic does quietly.
 */
describe('eating', () => {
  it('feeds everybody when there is plenty', () => {
    const folk = [soul('farmer'), soul('miner'), soul('smith')];
    const meal = eat(folk, 10);
    expect(meal.fed).toBe(3);
    expect(meal.hungry).toBe(0);
  });

  it('takes money for it, which is where most of the world’s gold goes', () => {
    const folk = [soul('farmer', 10)];
    const meal = eat(folk, 5);
    expect(meal.spent).toBe(FOOD.MEAL);
    expect(folk[0].purse).toBe(10 - FOOD.MEAL);
  });

  it('feeds children without charging them', () => {
    // every village in the world died out before this: a child has no trade, so no income, so no
    // way to buy bread, and starved at a week old while the adults around them ate
    const child = soul('', 0);
    const meal = eat([child], 5);
    expect(meal.fed).toBe(1);
    expect(child.hungry).toBe(0);
    expect(meal.spent).toBe(0);
  });

  it('leaves out whoever cannot pay when there is not enough', () => {
    const rich = soul('smith', 40), poor = soul('farmer', 0);
    eat([rich, poor], 1);
    expect(rich.hungry).toBe(0);
    expect(poor.hungry).toBe(1);
  });

  it('kills somebody who has gone without for long enough, and not before', () => {
    const p = soul('farmer', 0);
    for (let day = 1; day < FOOD.STARVES_AFTER; day++) {
      expect(eat([p], 0).starved).toEqual([]);
    }
    expect(eat([p], 0).starved).toEqual([p]);
  });

  it('forgets the hunger of anybody who gets a meal', () => {
    const p = soul('farmer', 40);
    eat([p], 0); eat([p], 0);
    expect(p.hungry).toBe(2);
    eat([p], 5);
    expect(p.hungry).toBe(0);
  });
});

describe('what a village grows', () => {
  const village = (farmers: number, others: number, children = 0): Person[] => [
    ...Array.from({ length: farmers }, () => soul('farmer')),
    ...Array.from({ length: others }, () => soul('smith')),
    ...Array.from({ length: children }, () => soul('')),
  ];

  it('feeds itself with no farmers at all, and no more', () => {
    // a fishing hamlet on a rock survives and never prospers. Counting only working adults left a
    // village of two dozen growing sixteen dinners a night, and it died of arithmetic in a season
    const folk = village(0, 16, 8);
    expect(grownInADay(folk, 0)).toBeGreaterThanOrEqual(folk.length);
  });

  it('makes a real surplus once somebody farms', () => {
    expect(grownInADay(village(4, 12, 8), 0)).toBeGreaterThan(village(0, 16, 8).length * 1.5);
  });

  it('grows nothing at all while the place is being raided', () => {
    expect(grownInADay(village(6, 10), 0.9)).toBe(0);
  });

  it('cannot bank a good decade against a bad year', () => {
    expect(cellarCap(village(4, 12))).toBeLessThan(16 * FOOD.KEEPS_DAYS + 1);
  });

  it('says something only when the store is running out', () => {
    const folk = village(2, 6);
    expect(saidOfFood(100, folk)).toBe('');
    expect(saidOfFood(0, folk)).toContain('nothing');
  });
});
