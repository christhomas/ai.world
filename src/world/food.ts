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
   * And what a hunter carries back out of the woods, in meals.
   *
   * Below a farmer, which is the right way round: a field is worked every day and a wood is
   * walked, and some days there is nothing in it. Three is about a deer every other day once the
   * bad days are averaged in, which is what the trade's own behaviour tree already does in front
   * of a player — out to the woods, stalk something, carry it to the market and sell it. This is
   * the same day for the hunters nobody is watching, and it must stay near what the watched one
   * actually manages or the two halves of the world tell different stories about the same man.
   */
  PER_HUNTER: 3,
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
  /**
   * How many hearts a villager has to lose before hunger has killed them.
   *
   * Sixty, which is the `villager` body's own hit points in `properties/people.json`, and that is
   * the point of the number rather than a coincidence. Hunger *is* heart loss: a villager who does not
   * eat loses a heart a day, and when the last one goes he is dead of it. One thing, counted once,
   * so the bar over his head and the line in the register cannot disagree about how near the end he
   * is.
   *
   * It replaced a `STARVES_AFTER` of seven days, which was the same idea with a different number
   * and no connection to anything anybody could see. How long a heart takes to go is
   * `HEART_EVERY`.
   */
  HEARTS: 60,
  /**
   * How many days without food one heart costs.
   *
   * Five. It was a heart a day, which made hunger a crisis that arrived and killed inside a week —
   * and a crisis is the wrong shape for it. Hunger is meant to be the pressure *under* the economy,
   * the reason a man who cannot earn has to do something about it, and something that kills in six
   * days is not a pressure, it is an emergency that either never happens or ends the village.
   *
   * At five days a heart, six hearts is a month of not eating before it is fatal. A villager who
   * misses a few dinners in a bad week is visibly worse off and has time to fix it — which is the
   * whole point, because fixing it is what makes him go mining, or hunting, or take somebody's coin
   * to walk into a fight. A famine still empties a village; it takes a season rather than a week.
   */
  HEART_EVERY: 5,
  /**
   * And how few hearts left before he goes looking for food rather than getting on with his day.
   *
   * Thirty, which is half of them. He *wants* full hearts always — nobody turns down dinner — but
   * what this decides is when he stops doing his trade and does something about it, and that has
   * to be late enough that a village is not a crowd of people queuing at the market all morning,
   * and early enough that he has days in hand to fix it. Half the way down, with three days left,
   * is a man who has noticed.
   */
  SEEKS_AT: 30,
  /** A village cellar holds this many days of food for its size; the rest goes to market. */
  KEEPS_DAYS: 12,
  /**
   * What the next valley pays for a meal this one cannot keep.
   *
   * The number that makes growing food worth doing. A village grows forty-six meals a day and eats
   * twenty-six — every village, every day, for the whole life of the game — and for as long as the
   * cellar simply capped, twenty of those meals were thrown on the ground every morning. That is
   * why hunting did not pay: a hunter carried three meals a day into a place already drowning in
   * food, and the only money he could be paid out of was what his neighbours spent on their own
   * dinner. A trade whose product is free is a trade nobody should be doing.
   *
   * Under what a meal costs at home rather than over it, and deliberately. This is a glut being
   * shifted — everybody's fields come in at once — and it has to be carried to somebody else's
   * market by somebody. What it has to buy is that a surplus is worth *something*, which is the
   * difference between a farm and a hobby.
   *
   * Measured rather than chosen: see `livelihoods.test.ts`, which holds every trade in the game to
   * clearing what a day costs it, and `prosperity.ts`, whose two thresholds moved with it.
   */
  ABROAD: 0.45,
} as const;

/**
 * What one person puts on the village's table today.
 *
 * Named and exported rather than folded into the sum below, because it is now asked twice and the
 * two askings must never disagree. The larder wants the total; the market wants each person's
 * share of it, since what somebody is paid for dinner is what they put into it. A second
 * expression of "what a farmer grows" living in `livelihoods.ts` would be a farmer who is fed by
 * one number and paid by another.
 *
 * Everybody's own garden is in it, children included: a kitchen garden feeds a household rather
 * than a wage-earner. Counting only the working adults leaves a village of two dozen growing
 * sixteen dinners a night, and it dies of arithmetic within the season.
 */
export function broughtIn(person: Person): number {
  if (person.trade === 'farmer') return FOOD.PER_HEAD + FOOD.PER_FARMER;
  if (person.trade === 'hunter') return FOOD.PER_HEAD + FOOD.PER_HUNTER;
  return FOOD.PER_HEAD;
}

/**
 * What a village grew today: the gardens, the fields, the woods, and whatever came off the herd.
 *
 * `fromHerd` is handed in rather than worked out, because a herd is a thing a village owns and
 * this file knows about food. What breeds, what is kept back and what goes to the butcher is
 * `livelihoods.ts`, which hands the meat over already counted.
 */
export function grownInADay(people: readonly Person[], pressure: number, fromHerd = 0): number {
  if (pressure > FOOD.UNTROUBLED) return 0;
  return people.reduce((sum, person) => sum + broughtIn(person), 0) + fromHerd;
}

/** The most a village will hold before the rest spoils. */
export function cellarCap(people: readonly Person[]): number {
  return Math.max(FOOD.KEEPS_DAYS, people.length * FOOD.KEEPS_DAYS);
}

/**
 * How many hearts somebody has left, given how long it is since they ate.
 *
 * The one expression of it, because three things ask: the register, which buries whoever runs out;
 * the body standing in the street, whose bar is this number; and his own behaviour tree, which is
 * what sends him looking for food before it is too late. Written down twice it would be a man who
 * looks half dead standing about as though nothing were wrong.
 */
export function heartsLeft(person: Pick<Person, 'hungry'>): number {
  const lost = Math.floor((person.hungry ?? 0) / FOOD.HEART_EVERY);
  return Math.max(0, FOOD.HEARTS - lost);
}

/** Is this somebody who has noticed they are hungry and would do something about it? */
export function lookingForFood(person: Pick<Person, 'hungry'>): boolean {
  return heartsLeft(person) <= FOOD.SEEKS_AT;
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
    // nothing to eat, or nothing to buy it with. A day without costs a heart, and the last one
    // costs him the rest
    person.hungry = (person.hungry ?? 0) + 1;
    meal.hungry++;
    if (heartsLeft(person) <= 0) meal.starved.push(person);
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
