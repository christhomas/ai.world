import { describe, expect, it } from 'vitest';
import { FOOD } from './food';
import { PRICES, coverOf, dearnessOfFood, priceOfAMeal } from './prices';
import type { Person } from './people';

const soul = (trade = 'farmer'): Person => ({
  id: `p${Math.random()}`, name: 'Maren', village: 'Ashford', sex: 'woman', trade, born: -30, lives: 70,
  mother: '', father: '', knows: [], memories: [], opinions: [], purse: 50, hungry: 0,
});

describe('what a meal costs where it is eaten', () => {
  const five = [soul(), soul(), soul(), soul(), soul()];

  it('reads cover as the store against what a cellar holds', () => {
    expect(coverOf(60, five)).toBeCloseTo(1);   // 5 people x 12 days
    expect(coverOf(30, five)).toBeCloseTo(0.5);
    expect(coverOf(0, five)).toBe(0);
  });

  it('is cheapest where the cellar is full', () => {
    expect(priceOfAMeal(60, five)).toBeCloseTo(FOOD.MEAL * PRICES.CHEAP);
  });

  it('is dearest where there is nothing', () => {
    expect(priceOfAMeal(0, five)).toBeCloseTo(FOOD.MEAL * PRICES.DEAR);
  });

  it('never goes below the floor however full the cellar is', () => {
    expect(priceOfAMeal(6000, five)).toBeCloseTo(FOOD.MEAL * PRICES.CHEAP);
  });

  it('falls as the cellar fills, with no step anywhere in it', () => {
    let last = Infinity;
    for (let store = 0; store <= 60; store += 5) {
      const now = priceOfAMeal(store, five);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });

  it('answers for a village with nobody in it rather than dividing by nought', () => {
    expect(Number.isFinite(priceOfAMeal(0, []))).toBe(true);
  });

  it('reports dearness as what a meal costs against what it costs at even cover', () => {
    expect(dearnessOfFood(0, five)).toBeCloseTo(PRICES.DEAR);
    expect(dearnessOfFood(60, five)).toBeCloseTo(PRICES.CHEAP);
  });
});
