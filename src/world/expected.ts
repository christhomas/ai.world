import { FOOD, cellarCap } from './food';
import { priceOfAMeal } from './prices';
import { aDaysTrade, paidForFood, pitchFor } from './livelihoods';
import { spentOnLiving } from './prosperity';
import { ownedBy, type Owner, type Standing } from './holdings';
import type { Person } from './people';

/**
 * What a day is *expected* to pay, as against what a day did.
 *
 * Out of `livelihoods.ts` because it is a different question asked of the same arithmetic. That file
 * answers "what happened in this village today" and moves the money; this answers "what would a day
 * pay each of these people", which is what a book has to say *before* the day happens — the hall's
 * roll quotes a figure against every name and a player pays a clerk for it.
 *
 * It has to be the whole of what somebody earns, now that most of a villager's income is other
 * villagers' money, or the roll quotes the smallest part of a wage and calls it the wage.
 *
 * The split is also the 700-line cap doing its job: `livelihoods.ts` went over while a farm learned
 * to hold what its buildings hold, and the honest answer to that is a cut rather than a seventh
 * round of shaving prose out of a file whose prose is most of its value. See item 77.
 */

/**
 * What a day is expected to pay each person, for a book that has to say so before the day happens.
 *
 * The town hall's roll quotes a figure against every name — what they take in a day — and a player
 * pays a clerk for it. It has to be the whole of what somebody earns now that most of a villager's
 * income is other villagers' money, or the roll is quoting the smallest part of a wage and calling
 * it the wage.
 *
 * It is a forecast, and it is held to being an exact one. Everything a day pays follows from what
 * the village looked like the evening before — who is alive, what they hold, what is in the larder
 * and what is in the paddock — so a book written on that evening can be right to the coin about the
 * morning, and `chore test economy` audits a hundred days of exactly that. The two places it can
 * still be wrong are the two places the evening genuinely does not know the morning: somebody born
 * or come of age overnight, and a village whose larder runs out in the middle of dinner. Both are
 * news rather than noise, which is the right thing for a ledger to be wrong about.
 *
 * `store` is what is in the cellar, because whether the food runs out decides whether the farmers
 * are paid for it. Left out, it assumes there is enough, which is what a caller with no village
 * behind it wants.
 */
export function aDaysIncome(
  people: readonly Person[], herd: number, pressure: number, store = Infinity,
  /**
   * The village itself, when the caller has it, because a coast earns from the water.
   *
   * Optional for the same reason it is optional on `aDaysTrade`: a caller with only a list of
   * people gets the inland answer, which is what every caller got before there was a catch. Left
   * out where a village *does* fish, the roll under-reports every fisherman's day — and the audit
   * reads that row, so the money would arrive in purses with nothing in any book to explain it.
   */
  village?: Parameters<typeof aDaysTrade>[3],
): Map<Owner, number> {
  const day = aDaysTrade(people, herd, pressure, village);
  const income = new Map(day.paid);

  /*
   * What dinner will come to, by the same rule `eat` uses.
   *
   * Asked whatever is going on outside the village, and that is not an oversight: nobody farms
   * while the place is being raided, but the cellar is still there and people still eat out of it
   * and still pay each other for it. A forecast that stopped at the same threshold the *work*
   * stops at would have the whole village down as earning nothing on a day when the last of the
   * store was changing hands.
   *
   * Two things decide it and both have to be asked in the right order. Who can pay is asked of the
   * purse a person will have when they sit down, which is after the morning's work has been paid
   * — asking it of last night's purse puts anybody who was broke at bedtime down as going hungry
   * on a day they were paid before dinner. And how many of them get any is capped by what is
   * actually in the larder, because `eat` goes richest first: the people who can pay are at the
   * front of the queue, so the pool is the smaller of how many can pay and how much there is.
   */
  /*
   * What the cellar will hold, worked out before anybody is asked whether they can pay, because
   * since item 138 the price depends on it. The morning reads exactly this number and charges
   * `priceOfAMeal` off it, so a forecast still quoting `FOOD.MEAL` disagreed with the morning by
   * the dearness of the day — which the economy bench reports as coin appearing and vanishing with
   * nothing in any book to explain it.
   *
   * A caller with no village behind it gets the reference price. `FOOD.MEAL` is what a meal is
   * worth before a cellar is consulted; assuming a full one would quote a glut on no evidence.
   */
  const known = Number.isFinite(store);
  const larder = known ? Math.min(cellarCap(people), store + day.grown) : Infinity;
  const price = known ? priceOfAMeal(larder, people) : FOOD.MEAL;

  const canPay = people.filter(
    (p) => p.trade && p.purse + (day.paid.get(ownedBy(p)) ?? 0) >= price,
  ).length;
  /*
   * A caller with no village behind it says nothing about the store, and that has to mean "assume
   * there is enough" rather than "assume an infinite glut". Left as arithmetic on `Infinity` it
   * came out as a surplus of infinity, a pool of infinity, and every share in the village NaN —
   * which is what the test that guards this found within a minute of the surplus going in.
   */
  const pool = Math.min(canPay, Math.floor(Math.min(larder, canPay))) * price;
  // plus what the cellar will not hold, which goes to the next valley rather than on the ground
  const spare = known ? Math.max(0, store + day.grown - larder) : 0;

  for (const [id, much] of paidForFood(people, pool + spare * FOOD.ABROAD, day.meat)) {
    income.set(id, (income.get(id) ?? 0) + much);
  }
  // the keep and the pitch are both in `paid` as debits, which is where they belong: the roll says
  // what a day takes in and what it costs on separate lines, and this is the taking-in line
  for (const one of people) {
    income.set(ownedBy(one), (income.get(ownedBy(one)) ?? 0) + spentOnLiving(one) + pitchFor(one));
  }
  return income;
}

/**
 * What the roll should say a villager will pay for dinner tomorrow morning.
 *
 * The same reading `aDaysIncome` makes above, exported so that `records.ts` quotes the number the
 * forecast used rather than one of its own. A roll whose food line and earnings line disagree is
 * a roll the economy bench reads as coin appearing from nowhere.
 */
export function priceTheRollQuotes(
  people: readonly Person[], herd: number, pressure: number, store = Infinity,
  village?: Parameters<typeof aDaysTrade>[3],
): number {
  if (!Number.isFinite(store)) return FOOD.MEAL;
  const grown = aDaysTrade(people, herd, pressure, village).grown;
  return priceOfAMeal(Math.min(cellarCap(people), store + grown), people);
}
