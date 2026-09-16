import { describe, expect, it } from 'vitest';
import { ITEMS, mealsIn } from './items';

/**
 * What an edible is worth in the unit the village counts its cellar in.
 *
 * `items.ts` prices an apple at 5 and bread at 8; the sim counts a cellar in meals and `FOOD.MEAL`
 * is one of them. Two different units for the same substance, and item #231 is where the join has
 * to exist — a shelf that takes from the village's store cannot take *gold* out of a larder.
 *
 * Without it the hero's shelf and the village's larder go on counting different things, which is
 * how the two halves of this world have disagreed before: `soldAtMarket` exists because a watched
 * hunter and an unwatched one were paid out of two different economies for the same deer.
 *
 * Gear says nothing, deliberately. A sword has no maker until #232, so it keeps its infinite shelf
 * and its constant price, and `mealsIn` says nought for it rather than guessing.
 */
describe('what an edible is worth in meals', () => {
  it('says nothing for gear, which has no maker and no larder behind it', () => {
    expect(mealsIn(ITEMS.sword)).toBe(0);
    expect(mealsIn(ITEMS.lantern)).toBe(0);
  });

  it('says what a loaf is worth, so buying one can take it out of a cellar', () => {
    expect(mealsIn(ITEMS.bread)).toBeGreaterThan(0);
  });

  it('is a whole number of meals, because a cellar is counted in whole ones', () => {
    for (const item of Object.values(ITEMS)) {
      const meals = mealsIn(item);
      expect(Number.isInteger(meals), item.id).toBe(true);
      expect(meals >= 0, item.id).toBe(true);
    }
  });

  it('is worth more the more it heals, so a stew is not a windfall against an apple', () => {
    expect(mealsIn(ITEMS.stew)).toBeGreaterThanOrEqual(mealsIn(ITEMS.apple));
  });

  it('gives every edible a worth, so none of them is free food from nowhere', () => {
    const edible = Object.values(ITEMS).filter((i) => i.effect?.type === 'heal');
    expect(edible.length).toBeGreaterThan(0);
    for (const item of edible) expect(mealsIn(item), item.id).toBeGreaterThan(0);
  });

  it('says nothing for a bed, which is a night rather than a meal', () => {
    expect(mealsIn(ITEMS.room)).toBe(0);
  });
});
