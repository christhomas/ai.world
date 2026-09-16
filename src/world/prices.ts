import { FOOD, cellarCap } from './food';
import type { Person } from './people';

/**
 * What a meal costs where it is eaten, which until item 138 was the same number everywhere.
 *
 * `FOOD.MEAL` used to be what dinner cost. It is now what dinner costs at even cover — a full
 * cellar — and what is actually charged is this, read off the store the village is audited on
 * every morning anyway. Nothing new is measured here; a price simply stops being declared.
 *
 * Pure, and deliberately so. A price is a function of the register on the morning it is charged,
 * and `relive` rebuilds the register morning by morning, so a replayed village works out the same
 * prices without being told anything. See `docs/138-local-prices.md`.
 */
export const PRICES = {
  /** What a meal costs where the cellar is full, against `FOOD.MEAL`. */
  CHEAP: 0.6,
  /** And where there is nothing left. Both are measured against the bench, not chosen. */
  DEAR: 3,
} as const;

/** What a village holds against what its cellar is for: 1 is full, 0 is empty. */
export function coverOf(store: number, people: readonly Person[]): number {
  return Math.max(0, store) / cellarCap(people);
}

/** Smooth between the two ends, so no village crosses a cliff between two mornings. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * What one meal costs in this village today.
 *
 * Clamped at both ends on purpose: free food would be a source, and an unbounded price would
 * starve people for a reason that is not about food.
 */
export function priceOfAMeal(store: number, people: readonly Person[]): number {
  const cover = smoothstep(coverOf(store, people));
  return FOOD.MEAL * (PRICES.DEAR + (PRICES.CHEAP - PRICES.DEAR) * cover);
}

/**
 * The same reading as a multiplier, for the things priced off a catalogue rather than in meals.
 *
 * A loaf on a shop's shelf is not counted in meals until item 139 gives the shelf a bottom, so
 * what the hero pays moves with the village by the same factor the village's own dinner does.
 */
export function dearnessOfFood(store: number, people: readonly Person[]): number {
  return priceOfAMeal(store, people) / FOOD.MEAL;
}
