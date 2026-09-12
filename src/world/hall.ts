import { PROSPER } from './prosperity';
import { LIVELIHOOD } from './livelihoods';
import type { Person } from './people';

/**
 * The village's own money: what the hall takes, and what makes it different from a purse.
 *
 * `inheritance.ts` turned a treasury down when it went in, and said why in as many words — there
 * was no pot to bank anything in, and inventing one would have been inventing a thing nothing in
 * the game could see or spend. A hall is somewhere to keep it and a vote is something to spend it
 * on, so there is a pot now, and this is the whole of how it fills.
 *
 * Its own file rather than more of `livelihoods.ts`, because it is a different subject: that one is
 * the four ways a villager earns a living, and this is the one place money stops being anybody's.
 */

/**
 * What the hall takes, and from whom.
 *
 * A tax is not a new machine. Money already moves between villagers every day — a dinner paid for,
 * a keep bought, a beast sold — and it moves as a map of who gains and who loses that the register
 * applies in one place. This is another entry in that map, and the only new thing about it is where
 * the money goes: into the village rather than into another purse.
 *
 * Which is the whole point of it. What the hall holds is not anybody's. A mayor who dies leaves it
 * exactly where it was for whoever is elected next, where a *person's* purse is inherited by their
 * family the day they are buried — see `handOnWhatTheyHad`. Putting the treasury on the mayor would
 * be putting a village's harbour money into a dead man's estate.
 *
 * Taken off what somebody *holds* rather than what they earned, because a day's earnings can be
 * negative here and a tax that hands money back on a bad day is a subsidy. Above `KEEPS_BACK` only:
 * that reserve is a week of dinners, and a village that taxes its people into starving has
 * mistaken the point of having a village.
 */
export function taxOn(person: Person): number {
  const spare = person.purse - PROSPER.KEEPS_BACK;
  if (spare <= 0) return 0;
  // rounded to a hundredth, the way every other coin in this economy is, so that a village's purse
  // and the purses it came out of still add up to what they did this morning
  return Math.round(spare * LIVELIHOOD.TAX * 100) / 100;
}

export function taxedForTheHall(people: readonly Person[]): { owed: Map<string, number>; raised: number } {
  const owed = new Map<string, number>();
  let raised = 0;
  for (const person of people) {
    const much = taxOn(person);
    if (much <= 0) continue;
    owed.set(person.id, -much);
    raised += much;
  }
  return { owed, raised: Math.round(raised * 100) / 100 };
}


/**
 * What a village has paid to have built, and what it costs.
 *
 * The treasury's whole point, and the answer to the thing `chore sanity` measures: a pot that never
 * spends will always out-accumulate every person in the village, because a person has to buy dinner
 * and a treasury does not. Sixty-two per cent of all the money in the world was sitting in halls
 * after four hundred and fifty days. That is not a tax rate problem and lowering the rate only slows
 * it down.
 *
 * So the hall buys things, and the money goes back into the village that raised it. **Who it goes
 * to is the honest part**: a village's work is done by its own people, so the payment is shared out
 * the way every other village-wide payment is — among whoever is working. There is no builder on the
 * register yet (that is **25**), and when there is, this is the line that names him instead.
 *
 * Ordered cheapest first, and one a day at most. A village that emptied its treasury into four
 * buildings on one morning is a village nobody watched change.
 */
export const WORKS: ReadonlyArray<{ id: string; costs: number; note: string }> = [
  { id: 'well', costs: 900, note: 'A well on the square: the first thing a village buys, and the one every village wants.' },
  { id: 'storey', costs: 2600, note: 'A second storey on the houses, which is the village saying it means to stay.' },
  { id: 'bathhouse', costs: 6200, note: 'A bath house, which is what a village builds when it has run out of things it needs.' },
];

/** What the hall can afford next, or nothing: the cheapest thing it has not already raised. */
export function nextWork(purse: number, built: readonly string[]): typeof WORKS[number] | null {
  for (const work of WORKS) {
    if (built.includes(work.id)) continue;
    return purse >= work.costs ? work : null;   // cheapest first, and it saves up rather than skipping
  }
  return null;
}

/**
 * What the hall buys this morning, and who it pays.
 *
 * Pure, like everything else in this file: it is handed a purse, what has already been raised and
 * who lives there, and it says what changes. The register applies it, which is the one place a coin
 * is allowed to move.
 *
 * The shares are equal among whoever holds a trade, and the last one takes the rounding — the same
 * rule `shareOut` uses in `livelihoods.ts`, and for the same reason: a rounded share each leaves
 * dust, and dust is money the world invented.
 */
export function whatTheHallBuys(
  purse: number, built: readonly string[], people: readonly Person[],
): { work: string; costs: number; wages: Map<string, number> } | null {
  const work = nextWork(purse, built);
  if (!work) return null;
  const working = people.filter((p) => p.trade !== '');
  if (working.length === 0) return null;        // nobody to do the work, so nothing is built
  const each = Math.round((work.costs / working.length) * 100) / 100;
  const wages = new Map<string, number>();
  for (const person of working) wages.set(person.id, each);
  const dust = Math.round((work.costs - each * working.length) * 100) / 100;
  if (dust !== 0) {
    const last = working[working.length - 1];
    wages.set(last.id, Math.round(((wages.get(last.id) ?? 0) + dust) * 100) / 100);
  }
  return { work: work.id, costs: work.costs, wages };
}
