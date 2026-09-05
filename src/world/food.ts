import type { Person } from './people';

/**
 * Eating, and not eating.
 *
 * The economy had a source once the mines went in and nowhere for the money to go. This is the
 * drain, and it is the one that gives every other number its stakes: gold matters because bread
 * costs money, and a village's prosperity matters because a poor village buries people.
 *
 * Food is magicked into the world at a rate and no further questions are asked. There is no crop
 * growth here, no breeding pairs, no seed ledger — going down that road ends at how long a cow is
 * pregnant, which is not worth simulating and would not change a single thing the player can see.
 * A village with farmers grows so much food a day. That is all.
 *
 * What is *not* hand-waved is the part the player can act on: who eats when there is not enough,
 * how long somebody lasts without, and what it does to a village when the answer is nobody and
 * not long. A raided village stops farming, a poor villager cannot buy what there is, and the
 * register buries whoever runs out. All three are things a player can turn around.
 */

export const FOOD = {
  /** What one farmer puts on the table in a day, in meals. */
  PER_FARMER: 4,
  /**
   * And what everybody else manages for themselves — a kitchen garden, a few hens.
   *
   * Set at one meal a head on purpose: a village with no fields and no farmers feeds itself and
   * no more. It survives and never prospers, which is the right answer for a fishing hamlet on a
   * rock. Farmers are what make a surplus, and a surplus is what a village can sell or store
   * against a bad month.
   */
  PER_HEAD: 1,
  /**
   * Nobody farms while the place is being raided. Same threshold the purses use, and for the same
   * reason: people who are being buried are not out in the fields.
   */
  UNTROUBLED: 0.25,
  /**
   * What a day's food costs the person eating it.
   *
   * Below what even the idlest working day brings in, and deliberately so: at two — above the
   * subsistence rate — every village in the world starved inside a season, because people were
   * being asked to pay more for bread than they could earn. Eating is meant to be the floor that
   * money sits on, not a race nobody can win.
   */
  MEAL: 1,
  /** How long somebody lasts on an empty stomach before it kills them. */
  STARVES_AFTER: 7,
  /** A village cellar holds this many days of food for its size; the rest spoils. */
  KEEPS_DAYS: 12,
} as const;

/** What a village grew today. */
export function grownInADay(people: readonly Person[], pressure: number): number {
  if (pressure > FOOD.UNTROUBLED) return 0;
  const farmers = people.filter((p) => p.trade === 'farmer').length;
  // counted over everybody, children included: a kitchen garden feeds a household rather than a
  // wage-earner. Counting only the working adults leaves a village of two dozen growing sixteen
  // dinners a night, and it dies of arithmetic within the season.
  return farmers * FOOD.PER_FARMER + people.length * FOOD.PER_HEAD;
}

/** The most a village will hold before the rest spoils. */
export function cellarCap(people: readonly Person[]): number {
  return Math.max(FOOD.KEEPS_DAYS, people.length * FOOD.KEEPS_DAYS);
}

/** What happened at dinner. */
export interface Meal {
  /** How many ate. */
  fed: number;
  /** How many did not, either because there was none or because they could not pay for it. */
  hungry: number;
  /** Food taken out of the store. */
  eaten: number;
  /** Money that changed hands for it, which leaves the eaters and is the economy's main drain. */
  spent: number;
  /** Who has now gone long enough without to have died of it. */
  starved: Person[];
}

/**
 * Feed a village, richest first.
 *
 * Richest first is the uncomfortable part and it is deliberate: when there is not enough, the
 * people who go without are the ones who could not pay, which is what makes a purse the
 * difference between eating and not. It also means a village's poor die first, so a place that has
 * been robbed or raided loses the people least able to leave.
 *
 * Mutates `hungry` and `purse` on the people it feeds, and hands back who died so the register can
 * bury them properly rather than having them vanish.
 */
export function eat(people: readonly Person[], store: number): Meal {
  const meal: Meal = { fed: 0, hungry: 0, eaten: 0, spent: 0, starved: [] };
  let left = store;

  const order = [...people].sort((a, b) => b.purse - a.purse);
  for (const person of order) {
    // A child is fed by whoever is raising them and does not buy their own dinner. Without this
    // every village in the world dies out: children have no trade, so no income, so no way to pay
    // for bread, and they starve at seven days old while the adults around them eat.
    const dependent = !person.trade;
    const canPay = dependent || person.purse >= FOOD.MEAL;
    if (left >= 1 && canPay) {
      left -= 1;
      if (!dependent) { person.purse -= FOOD.MEAL; meal.spent += FOOD.MEAL; }
      person.hungry = 0;
      meal.fed++;
      meal.eaten += 1;
      continue;
    }
    // nothing to eat, or nothing to buy it with
    person.hungry = (person.hungry ?? 0) + 1;
    meal.hungry++;
    if (person.hungry >= FOOD.STARVES_AFTER) meal.starved.push(person);
  }
  return meal;
}

/** How a village's larder reads out loud. Silence when there is enough, which is most of the time. */
export function saidOfFood(store: number, people: readonly Person[]): string {
  const days = people.length > 0 ? store / people.length : 0;
  if (days < 1) return 'There is nothing in the store. People are going without.';
  if (days < 3) return 'The store is nearly out. They are counting the days.';
  return '';
}
