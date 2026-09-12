import { PROSPER } from './prosperity';
import { LIVELIHOOD } from './livelihoods';
import type { Person } from './people';
import { atLeast, type Rank } from './rank';

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
export const WORKS: ReadonlyArray<{ id: string; costs: number; note: string; needs?: Rank }> = [
  { id: 'well', costs: 900, note: 'A well on the square: the first thing a village buys, and the one every village wants.' },
  { id: 'storey', costs: 2600, note: 'A second storey on the houses, which is the village saying it means to stay.' },
  { id: 'watchtower', costs: 3800, note: 'A watchtower, and a man on it: the first thing a village buys that it would rather not have needed.' },
  { id: 'bathhouse', costs: 6200, note: 'A bath house, which is what a village builds when it has run out of things it needs.' },
  /*
   * And two that a place has to have grown into, rather than saved up for.
   *
   * This is the whole of what a rank is allowed to do (`rank.ts`): unlock things a smaller place has
   * not got, never make its numbers bigger. A market hall is a town's — a village's market is
   * stalls on the square, and a roof over it is what a place builds when the stalls stopped being
   * enough. An aqueduct is a city's, and a city is years of building away: nobody has seen one yet,
   * which is precisely the point of having something at the top of a ladder.
   *
   * They are reachable by money *and* by growing, and both conditions are honest: a rich hamlet
   * cannot buy its way into being a town, and a big poor town cannot wish an aqueduct into being.
   */
  { id: 'markethall', costs: 9400, needs: 'town', note: 'A roof over the market, which is what a village builds when its stalls have stopped being enough.' },
  { id: 'aqueduct', costs: 21000, needs: 'city', note: 'Water brought in from the hills, which nobody has ever needed before and no village could ever pay for.' },
];

/**
 * What the village pays the man on the tower, a day.
 *
 * A watchtower is the only thing in this list that goes on costing after it is built, and that is
 * the point of it being here. Everything else a hall buys is paid for once — a well is dug and then
 * it is simply a well — but a tower with nobody on it is scenery, so the village carries a wage for
 * as long as it wants to be watched. It is the first standing cost this economy has ever had.
 *
 * Twelve gold, which is a little over a farmhand's day and a little under a tradesman's: standing
 * on a platform in the rain is not skilled work, but nobody does it for less than they would earn
 * in a field. A village that cannot pay it stands nobody up there, and the tower waits.
 */
export const WATCH_WAGE = 12;

/**
 * Who the village has standing on its tower this morning, and what it costs to keep him there.
 *
 * Nothing is remembered between days: the man is chosen again from the people who are there, so a
 * village that buries its watchman puts somebody else up the tower the next morning without
 * anything having to notice that the first one is gone. That is the same trick the rest of this
 * simulation runs on — derived rather than stored — and it is what makes a village re-lived from
 * its founding arrive at the village everybody else is looking at.
 *
 * Who it falls to is whoever has no trade of their own, because a village does not take its smith
 * off the forge to watch a road. If everybody has a trade it is the youngest of them, on the same
 * reasoning any village would use. And a village that cannot pay the wage this morning has nobody
 * up there this morning, which is honest: the tower is only worth what the village can afford.
 */
export function whoStandsWatch(
  purse: number, built: readonly string[], people: readonly Person[],
): { who: string; wage: number } | null {
  if (!built.includes('watchtower')) return null;
  if (purse < WATCH_WAGE) return null;
  if (people.length === 0) return null;
  const spare = people.filter((p) => p.trade === '');
  const chosen = spare.length > 0
    ? spare.reduce((first, p) => (p.id < first.id ? p : first))
    : people.reduce((youngest, p) => (p.born > youngest.born ? p : youngest));
  return { who: chosen.id, wage: WATCH_WAGE };
}

/** What the hall can afford next, or nothing: the cheapest thing it has not already raised. */
export function nextWork(
  purse: number, built: readonly string[], rank: Rank = 'city',
): typeof WORKS[number] | null {
  for (const work of WORKS) {
    if (built.includes(work.id)) continue;
    // a thing the place is not big enough for is skipped rather than saved for, which is the one
    // exception to the rule below and has to be: a village saving for a market hall it cannot have
    // would never buy its bath house, and would sit on the money until it had grown into a town
    if (work.needs && !atLeast(rank, work.needs)) continue;
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
  purse: number, built: readonly string[], people: readonly Person[], rank: Rank = 'city',
): { work: string; costs: number; wages: Map<string, number> } | null {
  const work = nextWork(purse, built, rank);
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

/**
 * Everything the hall spends this morning, in one answer.
 *
 * Two kinds of spending that have to happen in one order and share one purse: the man on the tower
 * is paid first, and whatever is left decides what can be built. A wage comes before a purchase for
 * the reason a household's dinner does — it is owed — and a village that spent its last thousand on
 * a bath house and then could not pay its watchman would have done things in the wrong order.
 *
 * Handed back as one map of who gets what, because that is what the register applies: a coin
 * leaving the hall has to arrive in somebody's purse in the same act, and two calls would be two
 * chances for one of them to be forgotten.
 */
export function whatTheHallSpends(
  purse: number, built: readonly string[], people: readonly Person[], rank: Rank = 'city',
): { wages: Map<string, number>; spent: number; work: string | null; watch: string } {
  const wages = new Map<string, number>();
  let spent = 0;

  const watch = whoStandsWatch(purse, built, people);
  if (watch) {
    wages.set(watch.who, watch.wage);
    spent = watch.wage;
  }

  const bought = whatTheHallBuys(Math.round((purse - spent) * 100) / 100, built, people, rank);
  if (bought) {
    for (const [id, much] of bought.wages) {
      wages.set(id, Math.round(((wages.get(id) ?? 0) + much) * 100) / 100);
    }
    spent = Math.round((spent + bought.costs) * 100) / 100;
  }
  return { wages, spent, work: bought?.work ?? null, watch: watch?.who ?? '' };
}

/**
 * Who speaks for the village, which is the last thing item 24 asked for and the oldest gap in it.
 *
 * A town hall has always had somebody behind its desk, and he has always been a clerk — an
 * anonymous body with the mayor's coat on, because the mayor's body was the one made for a town
 * hall and nobody had ever been elected to wear it. So the building that holds a village's money
 * was staffed by a person who does not exist on the register, in a game where every other villager
 * has a name, a family, a purse and a trade.
 *
 * The rule is the one this simulation uses for everything: derived, never appointed. It falls to
 * whoever has lived here longest of the people who hold a trade — the one everybody has known
 * longest, which is how a small place actually decides these things, and which needs no election
 * machinery, no term of office and nothing stored. A mayor who dies is replaced the next morning by
 * the next-longest, without anything having to notice that the first one is gone.
 *
 * The tie is broken on the id rather than left to the order of the roll, so two machines reading
 * the same village elect the same man.
 */
export function mayorOf(people: readonly Person[]): Person | null {
  let mayor: Person | null = null;
  for (const person of people) {
    if (person.trade === '') continue;          // a village is not spoken for by its children
    if (mayor === null || person.born < mayor.born
      || (person.born === mayor.born && person.id < mayor.id)) mayor = person;
  }
  return mayor;
}