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
 * What it costs a village, per day, to keep one of its own buildings standing — as a share of what
 * the building cost to raise.
 *
 * Item 82, and the argument for it is already written above about the watchman: a tower with nobody
 * on it is scenery, so the village carries a wage for as long as it wants to be watched. That was
 * called *"the first standing cost this economy has ever had"*, and it should not have stayed the
 * only one. A well silts up. A bath house burns fuel. A market hall's roof wants mending after a
 * winter. None of those is a thing you buy once.
 *
 * What it fixes is measured rather than supposed. A hall's list of wants is **finite** — six things
 * and then nothing — so a mature village gains 143 to 188 gold a day with nothing whatever to spend
 * it on, where at a hundred days it was gaining six. That is the whole of why 60% of the coin in
 * the world ends up in treasuries: not a tax rate, a hall with an empty shopping list.
 *
 * The money is not destroyed and that is the point. It goes to whoever is working in the village,
 * the way every other village-wide payment does, so a well being kept in repair is a villager being
 * paid to keep it — which is money going back round rather than money going away. A village that
 * cannot pay lets things go, which is `whoStandsWatch`'s rule applied to everything else.
 *
 * **The hall keeps up what the hall built, and no more.** A house is the householder's to mend. A
 * village does not re-roof its own cottages out of the treasury, and a rule that said otherwise
 * would make a growing village poorer for growing, which is the wrong way round.
 *
 * What is *owed* is worked out here and what is *paid* is worked out in `growth.ts`, beside every
 * other coin that moves in a village's morning. Not tidiness: `founding.ts` already imports this
 * file, so reaching back for its crew rule would close a cycle — and a cycle in this corner is how
 * a roof once came to cost `NaN`, which every village could afford.
 */
export const UPKEEP_SHARE = 0.006;

/** What this village owes today for keeping its own buildings up, and nothing for what it has not built. */
export function upkeepOf(built: readonly string[]): number {
  let owed = 0;
  for (const work of WORKS) if (built.includes(work.id)) owed += work.costs * UPKEEP_SHARE;
  return Math.round(owed * 100) / 100;
}

/**
 * The jobs a village's own buildings make, and what the hall pays to have them done.
 *
 * The heart of item 82, and the answer to the thing that was actually wrong: a hall's shopping list
 * is six items long and then empty for ever, so a treasury fills up no matter what the tax rate is.
 * The pot is never full and should not be — a hall that stopped collecting because it was rich
 * would be a tax rate that depends on a treasury balance, which is not a thing a village does.
 * Something has to be worth buying *for ever*, and a building is not: it is bought once.
 *
 * A **job** is. The watchtower has said so since the day it went in — *"a tower with nobody on it
 * is scenery, so the village carries a wage for as long as it wants to be watched"*, called there
 * the first standing cost this economy ever had. It should never have stayed the only one. What a
 * village hall does with money, once it has built what it needs, is **put work out to contract**: a
 * watch that is a rota rather than one man, somebody to keep the bath house, a warden on the
 * market. Money going back into the purses it was taxed out of, for work the village wanted done.
 *
 * It is still a contract, and that is the part worth being exact about. Nothing here is a person
 * hiring another person — the hall is not somebody's household and the mayor is not paying out of
 * his own pocket. The hall *itself* is the party: the one purse in a village that belongs to
 * nobody, contracting for work on the village's behalf. That is what makes it different in kind
 * from every other wage in this world, all of which are one man paying another, and it is why the
 * deed reads hall-to-purse rather than purse-to-purse.
 *
 * Three things fall out of it that no amount of tax-tuning would have given:
 *
 * - **It scales the way the income does.** Tax grows with the number of people; so does a watch,
 *   because a bigger village has more road to watch and more nights to cover. A sink that does not
 *   scale with its source is not a sink, it is a delay.
 * - **A villager with no trade has a living.** Before this, somebody the register never gave a
 *   trade earned nothing at all and ate out of a purse that only went down. Now the village pays
 *   them for a job the village wanted done, which is a better answer than charity and a much better
 *   one than starving.
 * - **The hall stops being a builder and becomes a standing party to contracts.** A village that
 *   has built everything is not finished, it is staffed — and one that falls on hard times stops
 *   renewing, which is a thing you can see from the road when the tower is empty.
 */
export const POSTS: ReadonlyArray<{ of: string; job: string; wage: number; per: number }> = [
  /*
   * The watch, which is a rota and not a man.
   *
   * One per twenty souls, because what a watch covers is the place rather than the tower: a hamlet
   * needs somebody up there at night and a town of ninety needs somebody up there all night, which
   * is three people taking turns. `whoStandsWatch` named exactly one and that is what it stays for
   * — the man on the tower *now*, for whoever is asking who to talk to — while this is the payroll.
   */
  { of: 'watchtower', job: 'watchman', wage: WATCH_WAGE, per: 20 },
  /* Somebody has to draw the water, sweep the yard and mend the rope. One is enough for anywhere. */
  { of: 'well', job: 'water carrier', wage: 6, per: 60 },
  /* A bath house is fires, water and a floor to mop, and it is open every day it is not frozen. */
  { of: 'bathhouse', job: 'bath keeper', wage: 8, per: 35 },
  /* A market wants somebody to say where the stalls go and settle what a thing is worth. */
  { of: 'markethall', job: 'market warden', wage: 10, per: 45 },
  /* And water brought from the hills is a channel somebody walks the length of, looking for cracks. */
  { of: 'aqueduct', job: 'water warden', wage: 10, per: 40 },
];

/** How many of a post a village of this size keeps: one, and another for every `per` souls over. */
export function postsFor(post: typeof POSTS[number], souls: number): number {
  return Math.max(1, Math.ceil(souls / post.per));
}

/** What this village's payroll comes to today, before it is discovered who can be paid. */
export function payrollOf(built: readonly string[], souls: number): number {
  let owed = 0;
  for (const post of POSTS) {
    if (!built.includes(post.of)) continue;
    owed += postsFor(post, souls) * post.wage;
  }
  return Math.round(owed * 100) / 100;
}

/**
 * Who the hall has on its payroll this morning, and what it costs.
 *
 * Staffed from whoever holds no trade, which is the same group `whoStandsWatch` draws from and
 * deliberately: a village does not take its smith off the forge to watch a road. Where there are
 * not enough of those to fill the posts, the rest go unfilled — a village of tradesmen has nobody
 * spare, which is a real thing about a place rather than a shortfall to paper over.
 *
 * Oldest first, because the ones least able to go and find something else are the ones a village
 * puts on its own books, and because an order settled by the register would differ between two
 * machines reading the same village.
 *
 * And it pays what it can. A hall short of money fills the posts it can afford in the order they
 * are listed — the watch before the bath house, which is the same "safety before comfort" the
 * buying list is ordered by — and the rest of the jobs simply are not done that day.
 */
export function whoTheHallEmploys(
  purse: number, built: readonly string[], people: readonly Person[],
): { paid: Map<string, number>; costs: number; jobs: number; watch: string } | null {
  /*
   * Who the village puts on its own books, in the order it would.
   *
   * Whoever holds no trade first, oldest of them first — a village does not take its smith off the
   * forge to watch a road, and the ones least able to go and find something else are the ones it
   * keeps. But that is a preference and not a rule: a village where everybody holds a trade still
   * wants a watch, and it falls to the youngest, which is the same answer `whoStandsWatch` has
   * always given and for the same reason anybody would.
   *
   * The ordering is settled on the id where two people match, because an order left to the roll
   * would differ between two machines reading the same village.
   */
  const spare = [
    ...people.filter((person) => person.trade === '')
      .sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : 1)),
    ...people.filter((person) => person.trade !== '')
      .sort((a, b) => b.born - a.born || (a.id < b.id ? -1 : 1)),
  ];
  if (spare.length === 0) return null;

  const paid = new Map<string, number>();
  let costs = 0;
  let at = 0;
  // who is actually on the tower, which used to be asked separately and answered by a different
  // rule. It is the first watchman the payroll reaches, so the man who is paid and the man anybody
  // walking up would find are the same man by construction rather than by agreement
  let watch = '';
  for (const post of POSTS) {
    if (!built.includes(post.of)) continue;
    for (let n = 0; n < postsFor(post, people.length); n++) {
      if (at >= spare.length) break;
      if (costs + post.wage > purse) return finish(paid, costs, watch);
      paid.set(spare[at].id, Math.round(((paid.get(spare[at].id) ?? 0) + post.wage) * 100) / 100);
      costs = Math.round((costs + post.wage) * 100) / 100;
      if (post.of === 'watchtower' && watch === '') watch = spare[at].id;
      at++;
    }
  }
  return finish(paid, costs, watch);
}

function finish(
  paid: Map<string, number>, costs: number, watch: string,
): { paid: Map<string, number>; costs: number; jobs: number; watch: string } | null {
  return paid.size === 0 ? null : { paid, costs, jobs: paid.size, watch };
}

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

  /*
   * Who is up the tower, which is a question and no longer a payment.
   *
   * The watchman used to be paid here, and he is on the hall's payroll now along with everybody
   * else the village has work out to — see `whoTheHallEmploys`, which is where item 82 put every
   * standing cost a hall carries. Paying him in both places would be paying him twice, and a coin
   * that arrives twice for one day's work is exactly the thing the deed layer exists to catch.
   *
   * The naming stays, because it is a different question with a different answer: the payroll knows
   * how many watchmen a village keeps and this knows which of them anybody walking up to the tower
   * would find standing on it.
   */
  const watch = whoStandsWatch(purse, built, people);


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