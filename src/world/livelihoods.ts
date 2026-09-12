import { FOOD, broughtIn, cellarCap, eat } from './food';
import { PROSPER, TRADERS, earnedInADay, spentOnLiving } from './prosperity';
import { AWAY, buy, purseOf, sell } from './deeds';
import { BEASTS_PER_FARM } from './holdings';
import { aDayOfCattle, aDaysFishing, coastOf } from './harvest';
import type { Person } from './people';
import { ableToWork } from './wounds';

/**
 * The four ways a villager gets a coin, and the coin actually going from one hand to another.
 *
 * The economy had a source and a drain and nothing in between. `mines.ts` minted gold out of the
 * ground and shared it among a crew; `prosperity.ts` paid everybody else a flat daily float out of
 * nowhere at all; `food.ts` charged everybody for dinner and burnt the money. Add it up over a
 * hundred days and every purse in the world was filled by the same invisible hand and emptied into
 * the same invisible hole, and not one coin ever passed between two people. A village with a
 * market in it was richer than a village without one because a constant said so, not because
 * anybody had ever bought anything from anybody.
 *
 * So this is the middle. Four livelihoods, and each of them is somebody being paid by somebody:
 *
 * - **Dig gold.** A miner goes down the hole and comes back up with metal that was not in the
 *   village that morning. This is the one true source, and it is `mines.ts`'s and stays there —
 *   named here only because the other three are built in its image.
 * - **Keep cattle.** A farmer's herd calves, the surplus goes to the butcher, the meat feeds the
 *   village and what the village cannot eat is sold on to its neighbours. That last part is why
 *   cattle are worth having: it is the only way a village with no mine gets money from outside.
 * - **Sell a service.** A seller, an innkeeper and a doctor are paid by the people around them,
 *   out of the very upkeep those people were previously throwing away. That is what makes a
 *   market worth building: not a larger number on the shopkeeper's row, but everybody else's
 *   spending having somewhere to land.
 * - **Hunt.** A hunter walks into the woods, kills something and carries it to the market, where
 *   the village buys it. Exactly what the trade's behaviour tree already does in front of a
 *   player — `goTo woods`, `stalkQuarry`, `take`, `goTo market`, `sell` — and this is the same day
 *   for the hunters nobody happens to be watching.
 *
 * ## The rule the whole file is held to
 *
 * **A coin leaving one purse arrives in another.** Every function here that takes money from
 * somebody hands back who it goes to, and `livelihoods.test.ts` adds both sides up and holds them
 * equal to the coin. Money enters a village in exactly three places — the mine, the meat sold to
 * the next valley, and what a trade earns beyond the village — and it leaves in exactly one: a
 * village with nobody to buy from spends its keep on a passing pedlar and never sees it again.
 * Anything else would be the old invisible hand under a new name.
 */

export const LIVELIHOOD = {
  /**
   * The share of what a villager has spare that the hall takes each day.
   *
   * Three hundredths of whatever they hold above their week of dinners. Small on purpose: a village
   * of thirty people carrying a dozen gold apiece raises something like five a day, so a harbour is
   * a season's taxes rather than an afternoon's — which is what makes it a thing a village decides
   * to do rather than a thing that happens.
   *
   * It also has to be far under what a day earns, or the tax is the reason nobody in the country
   * can save. `PROSPER` has the arithmetic of a working day; this is a slice off the top of what is
   * left after it, and it stops entirely at `KEEPS_BACK`.
   *
   * A hundredth of that to start with, and the reason is the best kind: the bench said so within an
   * hour. At three hundredths the sum came out beautifully — 410 in the hall by day thirty, 3,700
   * by day a hundred — and `chore test economy` went red on a check nobody was thinking about:
   * **no village built anything any more.** Not a second storey, not a bath house, in a hundred
   * days across twenty-one villages. The surplus a village spends on building itself was exactly
   * the surplus the hall was taking.
   *
   * At a two-hundredth the world works and its people are better off than they were before there
   * was a tax at all: people hold 4,158 between them by day a hundred where three hundredths left
   * them 1,590, and the hall still gathers 1,142 — a harbour's worth in a season, which is the
   * thing this was for.
   *
   * What is still not answered, and is the argument for the vote rather than for any rate: nothing
   * spends it. By day four hundred the hall holds 11,532 against its people's 7,600, which is money
   * standing still. A treasury that only ever collects is a slow drain dressed up as a saving, and
   * the day a village can vote to spend it, this number can rise again.
   */
  TAX: 0.005,
  /**
   * How many beasts one farmer's paddocks hold, which is a fact about a farm and lives on one.
   *
   * The number and the argument for it are `BEASTS_PER_FARM` in `holdings.ts`, and it is named here
   * because everything that asks this question asks it of a livelihood. It reads across rather than
   * being written down twice, for the reason `settlement.ts` gives about houses: a number two files
   * keep is a number two files can disagree about.
   *
   * It is a cap per *farmer* here and a cap per *farm* there, and today those are the same thing
   * because a village has exactly as many farms as it has farmers. The morning a farmer can own two
   * farms they come apart, and this is the line that will have to say which of the two it meant.
   */
  HERD_PER_FARMER: BEASTS_PER_FARM,
  /**
   * What a farmer starts with when a village is founded.
   *
   * Four of the six a farmer's paddocks hold, which is a herd rather than a start on one.
   *
   * It was two, and two is what the arithmetic wants and what the picture does not. A village with
   * one farmer — which most of them have — put exactly two cows in its field on the morning a
   * player first walked into it, and two cows in a field read as a pair of strays rather than as
   * the thing the place lives off. Four reads as a herd from the road on the first day and still
   * has somewhere to go: eleven days to fill the paddocks, and a fortnight is exactly the sort of
   * gap a player leaves between visits.
   */
  FIRST_HERD: 4,
  /**
   * The share of a herd born again each day.
   *
   * Four hundredths, which is a calf per cow every twenty-five days. That is far faster than a
   * real cow and deliberately so: a game day is a day and nobody is going to wait nine months to
   * see a paddock fill. What it has to be is slow enough that a herd takes a month or two to reach
   * its cap — the thing worth coming back for — and fast enough that a herd wiped out by wolves or
   * by a player with a sword grows back inside a season rather than never.
   */
  CALVES: 0.04,
  /**
   * What one beast comes to at the butcher, in meals.
   *
   * Eight, so a herd at its cap of six per farmer yields about two meals a day per farmer on top
   * of the four the field gives — meat being the part of a farm that is worth money rather than
   * the part that feeds it. Larger and a single farmer feeds a village on his own and the fields
   * stop mattering; smaller and the herd is scenery.
   */
  MEALS_PER_BEAST: 8,
  /**
   * And what the next valley pays for the half of it this village cannot eat.
   *
   * The whole reason to keep cattle rather than only to grow corn. A field feeds the people who
   * work it and no more; a herd walks to the next market and comes back as coin. Nine a beast
   * against the eight meals it makes is the village selling meat at a shade over what it charges
   * itself for dinner, which is what a market town does and is the honest number: nobody carries
   * meat two valleys for less than it is worth at home.
   *
   * This is one of only three ways money enters a village at all, so it is worth saying what it is
   * doing to the world: a farming village that is left alone gets slowly, visibly better off, and
   * a farming village whose cattle are killed does not. Both of those are things a player can
   * cause.
   */
  PRICE_PER_BEAST: 9,
  /**
   * What it costs to sell for a living: a pitch at the market, and getting the goods to it.
   *
   * The cost the model did not have. A farmer and a hunter were being paid for what they produced
   * and charged nothing whatever for turning it into money — no stall, no carriage, no wastage —
   * while a miner's day was priced and a traveller's inn bill was priced. A trade with revenue and
   * no costs is not a trade, it is a tap.
   *
   * The rule this has to satisfy is the one that makes any of it worth doing: **what selling earns
   * has to beat what selling costs.** Named as a constant so the test can hold it to that rather
   * than take it on trust — `livelihoods.test.ts` puts every trade in the game through a day and
   * fails if any of them is a way of getting poorer.
   *
   * Charged to the three trades that take a pitch — the farmer, the hunter and the seller — and
   * paid into the same pool everybody's keep goes into, because a market belongs to the village
   * and the people who keep it are the people who are paid out of it. A seller pays her own pitch
   * and takes most of it back, which is what owning your pitch means.
   */
  SELLING: 0.4,
  /**
   * The share of a herd that goes to market rather than being kept back to breed.
   *
   * Only the surplus over what the paddocks hold, which is exactly the user's sentence: the cows
   * reproduce at the same rate they are eaten. A herd below its cap keeps every calf and grows; a
   * herd at its cap sells precisely what was born that morning and stays the size it is. Nothing
   * else needs saying, and no constant is needed for it — it falls out of the cap.
   */
} as const;

/**
 * The trades that make their living by selling something, and so pay for somewhere to sell it.
 *
 * The farmer and the hunter because their whole income is the market, and the seller because the
 * pitch is literally hers. Not the innkeeper or the doctor: an inn and a surgery are a room in a
 * building somebody already lives in, and charging them a market pitch would be charging them for
 * a stall they have never stood at.
 */
const SELL_FOR_A_LIVING: readonly string[] = ['farmer', 'hunter', 'seller'];

/**
 * What somebody pays today for somewhere to sell from, which is nothing for most people.
 *
 * Exported because three things have to agree about it and two of them are books: what a day
 * actually charges, what the roll says a day costs, and what the roll says a day pays. It was
 * charged and not reported for one run of the bench, and the bench found it immediately — a
 * village holding two hundred gold more than its own books could account for.
 *
 * Nobody pays a pitch out of their last week of dinners, the same reserve `spentOnLiving` keeps
 * back: a hunter down to his last few coins goes hunting to eat rather than to sell, which is the
 * other half of the trade and needs no market at all.
 */
export function pitchFor(person: Person): number {
  if (!SELL_FOR_A_LIVING.includes(person.trade)) return 0;
  return Math.min(LIVELIHOOD.SELLING, Math.max(0, person.purse - PROSPER.KEEPS_BACK));
}


/**
 * Hand a pool of money out in proportion to a set of shares.
 *
 * To the coin, and the last share takes the remainder, which is the same rule `mines.ts` shares a
 * day's gold by and is here for the same reason: a rounded share each leaves dust, and dust is
 * money the world invented. Nobody to share among means the money is not shared — the caller is
 * the one that knows whether that is a leak out of the village or a reason not to have collected
 * it in the first place.
 */
export function shareOut(pool: number, shares: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  let total = 0;
  for (const share of shares.values()) total += share;
  if (pool <= 0 || total <= 0) return out;

  let left = pool;
  const ids = [...shares.keys()];
  ids.forEach((id, n) => {
    const share = n === ids.length - 1 ? left : (pool * (shares.get(id) ?? 0)) / total;
    out.set(id, share);
    left -= share;
  });
  return out;
}

/**
 * Who put food on the village's table today, and how much of it.
 *
 * Only the working adults. A child's garden is their household's, and paying a four-year-old for
 * it would put money in a purse that is never spent and then hand it on when they inherit — a slow
 * leak that shows up as a village mysteriously getting richer the more children it has.
 *
 * The herd's meat is the farmers', shared between them: it came off their paddocks.
 */
export function whoFed(
  people: readonly Person[], fromHerd = 0, shore = false, fromBoats = 0,
): Map<string, number> {
  const shares = new Map<string, number>();
  const farmers = people.filter((p) => p.trade === 'farmer');
  const crews = people.filter((p) => p.trade === 'fisherman');
  for (const person of people) {
    if (!person.trade) continue;
    const meat = person.trade === 'farmer' && farmers.length > 0 ? fromHerd / farmers.length : 0;
    // the catch is the fishermen's, shared between them, for the reason the meat is the farmers':
    // it came off their boats. The shellfish is nobody's in particular and is already in `broughtIn`
    const fish = person.trade === 'fisherman' && crews.length > 0 ? fromBoats / crews.length : 0;
    shares.set(person.id, broughtIn(person, shore) + meat + fish);
  }
  return shares;
}

/**
 * What the village paid for its dinner, going to the people whose dinner it was.
 *
 * `spent` is what `eat` actually took out of purses, so on the day a village runs out of food the
 * pool runs out with it and the farmers earn nothing — which is exactly what a famine does to a
 * farmer and is worth having rather than smoothing over.
 */
export function paidForFood(
  people: readonly Person[], spent: number, fromHerd = 0, shore = false, fromBoats = 0,
): Map<string, number> {
  return shareOut(spent, whoFed(people, fromHerd, shore, fromBoats));
}

/**
 * What everybody's keep buys, going to the people who sold it to them.
 *
 * `spentOnLiving` has always been the mending, the drinking and the replacing that a life
 * involves, and for as long as this did not exist that money simply left the world. It is the
 * innkeeper's takings and the seller's stall and the doctor's fee, and now it goes to them.
 *
 * A village with none of those three keeps nothing: the money goes on a pedlar's cart and out of
 * the valley, which is the one place money leaves this economy and is why a village without a
 * market never gets rich however long it is left in peace.
 */
export function paidForService(people: readonly Person[], upkeep: number): Map<string, number> {
  const shares = new Map<string, number>();
  for (const person of people) {
    if (TRADERS.includes(person.trade)) shares.set(person.id, 1);
  }
  return shareOut(upkeep, shares);
}

/** What one day of one village's working life did to every purse in it. */
export interface Trading {
  /** The herd this evening. */
  herd: number;
  /** Meals into the larder: the gardens, the fields, the woods and the butcher. */
  grown: number;
  /**
   * How much of that came off the herd.
   *
   * Kept apart from the rest because the meat is the farmers' and the market has to know it: what
   * somebody is paid for the village's dinner is what they put into it, and a farmer put in his
   * field and his beasts. Folded into `grown` it would be food nobody grew and nobody was paid
   * for, which is a quiet way of taking money out of a farmer's pocket.
   */
  meat: number;
  /**
   * And how much came off the boats, kept apart for the reason the meat is.
   *
   * What somebody is paid for the village's dinner is what they put into it, and a fisherman put in
   * his boat. Folded into `grown` it would be food nobody landed and nobody was paid for, which is
   * the same quiet way of taking money out of a pocket — this time out of the pocket of the one
   * trade the harbour was built for.
   */
  fish: number;
  /**
   * Whether this village has a shore, carried along so the evening does not have to ask again.
   *
   * The shellfish are in everybody's share of the dinner money — they are food somebody gathered,
   * and the rule here is that what you are paid for the village's dinner is what you put into it.
   * `aDaysDinner` works out those shares hours after `aDaysTrade` has finished, and giving it the
   * coast on the day's own record is what saves the register from being handed the village twice.
   */
  shore: boolean;
  /** What each purse is owed for the day's work, before anybody has eaten. */
  paid: Map<string, number>;
}

/**
 * A village's working day, up to but not including dinner.
 *
 * Split there on purpose. What somebody earns for their labour is settled in the morning and does
 * not depend on whether there turns out to be anything in the larder; what they are paid for the
 * food they grew cannot be settled until the village has actually eaten, because the pool is what
 * was actually paid for it. Two halves, in that order, and the register runs them either side of
 * `eat`.
 *
 * Nobody works while the place is being raided — same threshold as the food and for the same
 * reason: people who are being buried are not out in the fields, down the hole or behind a stall.
 */
export function aDaysTrade(
  people: readonly Person[], herd: number, pressure: number,
  village: { trades?: readonly string[]; holdings?: readonly { kind: string }[] } = {},
): Trading {
  const coast = coastOf(village);
  const paid = new Map<string, number>();
  const add = (id: string, much: number): void => { paid.set(id, (paid.get(id) ?? 0) + much); };
  const keep = (): number => {
    let upkeep = 0;
    for (const person of people) {
      const spent = spentOnLiving(person);
      upkeep += spent;
      add(person.id, -spent);
    }
    return upkeep;
  };
  /*
   * A raided village earns nothing and still pays for its own keep, and that keep leaves the
   * valley.
   *
   * Both halves matter and the second one is the one that was nearly lost. Nobody is farming,
   * mining or standing behind a stall, so no money comes in — but a roof still leaks and a boot
   * still wears through, and with the village's own market shut whatever is spent on either goes
   * to whoever will come near the place. That is the only reason a band costs a village anything
   * at all now that money circulates: with the keep going round in a circle like everything else,
   * the bench measured a raided village as ending the fortnight worth exactly what it started it
   * worth, which made a warband a thing that happens to nobody.
   */
  if (pressure > PROSPER.UNTROUBLED) {
    keep();
    return { herd, grown: 0, meat: 0, fish: 0, shore: coast.shore, paid };
  }

  // a man who is laid up does not work, and his trade earns the village nothing while he is: see
  // `wounds.ts`. He still eats and still pays for his dinner, which is what makes a bad week
  // expensive rather than fatal
  const working = people.filter(ableToWork);
  const farmers = working.filter((p) => p.trade === 'farmer');
  const cattle = aDayOfCattle(herd, farmers.length);
  // and the boats, which are the coast's answer to the paddocks: see `aDaysFishing` for why the
  // two are the same shape and deliberately not the same behaviour
  const caught = aDaysFishing(coast.boats, working.filter((p) => p.trade === 'fisherman').length);

  // what a trade brings in from beyond the village: the seam, the sea, the road, the far country,
  // and what a traveller spends at an inn on his way through
  for (const person of working) add(person.id, earnedInADay(person, pressure));

  // the meat the next valley bought, which is the farmers' and is one of the three ways money
  // gets into a village at all
  for (const [id, much] of shareOut(cattle.gold, new Map(farmers.map((p) => [p.id, 1])))) {
    add(id, much);
  }
  /*
   * And the fish, the same way, which is the fourth — and the first one a village can *build*.
   *
   * A seam is where it is, a wood is where it is, and a road brings whoever it brings. A harbour is
   * the one source of outside money in this economy that somebody decided to have: three hundred
   * and forty gold and thirty lengths of timber, and a coast that had none now has one. That is
   * what item 41 means by a harbour being the first thing here that pays for itself.
   */
  const crews = working.filter((p) => p.trade === 'fisherman');
  for (const [id, much] of shareOut(caught.gold, new Map(crews.map((p) => [p.id, 1])))) {
    add(id, much);
  }

  /*
   * Everybody's keep, and the pitch money of whoever sells for a living, into the purses of the
   * people who keep the market and the inn.
   *
   * The two are collected together because they go to the same place and are the same kind of
   * thing: money spent inside the village on what the village provides. Splitting them would be
   * two pools with one set of claimants.
   */
  let pitches = 0;
  for (const person of people) {
    const pitch = pitchFor(person);
    pitches += pitch;
    add(person.id, -pitch);
  }
  for (const [id, much] of paidForService(people, keep() + pitches)) add(id, much);

  return {
    herd: cattle.herd,
    grown: people.reduce((sum, person) => sum + broughtIn(person, coast.shore), 0)
      + cattle.meals + caught.meals,
    meat: cattle.meals,
    fish: caught.meals,
    shore: coast.shore,
    paid,
  };
}

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
): Map<string, number> {
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
  const canPay = people.filter(
    (p) => p.trade && p.purse + (day.paid.get(p.id) ?? 0) >= FOOD.MEAL,
  ).length;
  /*
   * A caller with no village behind it says nothing about the store, and that has to mean "assume
   * there is enough" rather than "assume an infinite glut". Left as arithmetic on `Infinity` it
   * came out as a surplus of infinity, a pool of infinity, and every share in the village NaN —
   * which is what the test that guards this found within a minute of the surplus going in.
   */
  const known = Number.isFinite(store);
  const larder = known ? Math.min(cellarCap(people), store + day.grown) : Infinity;
  const pool = Math.min(canPay, Math.floor(Math.min(larder, canPay))) * FOOD.MEAL;
  // plus what the cellar will not hold, which goes to the next valley rather than on the ground
  const spare = known ? Math.max(0, store + day.grown - larder) : 0;

  for (const [id, much] of paidForFood(people, pool + spare * FOOD.ABROAD, day.meat)) {
    income.set(id, (income.get(id) ?? 0) + much);
  }
  // the keep and the pitch are both in `paid` as debits, which is where they belong: the roll says
  // what a day takes in and what it costs on separate lines, and this is the taking-in line
  for (const one of people) {
    income.set(one.id, (income.get(one.id) ?? 0) + spentOnLiving(one) + pitchFor(one));
  }
  return income;
}

/** What a village grew, what it ate, and who was paid for it. */
export interface Dinner {
  /** What is left in the store this evening. */
  food: number;
  /** Meals the cellar would not hold, which went to the next valley instead of on the ground. */
  sold: number;
  /** Who has now gone long enough without to have died of it. */
  starved: Person[];
  /** And what dinner cost, going to whoever's dinner it was — plus what the surplus fetched. */
  paid: Map<string, number>;
}

/**
 * A village's evening: the day's growing into the store, everybody fed out of it, and the money
 * that changed hands over it.
 *
 * The second half of a village's day, and the half that could not be settled in the morning. What
 * the fields and the woods and the herd are paid is a share of what was actually spent on dinner,
 * and what was actually spent is not known until the village has sat down: whoever could not pay
 * did not eat, and a village with an empty store pays its farmers nothing at all.
 *
 * Mutates the people it feeds — `eat` sets a purse and a hunger — and hands back everything else
 * for the register to act on, because burying somebody is the register's business.
 */
export function aDaysDinner(people: readonly Person[], store: number, work: Trading): Dinner {
  const all = store + work.grown;
  const food = Math.min(cellarCap(people), all);
  /*
   * What the cellar will not hold goes to market instead of on the ground.
   *
   * This is the line that makes growing food worth doing, and for the whole life of the game it
   * was a `Math.min` and nothing else. A village grows forty-six meals a day and eats twenty-six;
   * the cellar fills inside a fortnight and every morning after that threw twenty meals away. That
   * is why hunting cleared nineteen hundredths of a coin a day against a trade that pays two: not
   * because a hunter is bad at hunting, but because his product was free.
   *
   * The village's own store is filled first and the surplus is what is left after that, so a place
   * that is hungry sells nothing — which is the right way round, and means a bad season shows up
   * as a village that has stopped earning as well as one that has stopped eating.
   */
  const spare = Math.max(0, all - food);
  const meal = eat(people, food);
  const paid = paidForFood(people, meal.spent, work.meat, work.shore, work.fish);
  // and the money for it comes from the next valley, because that is where the food went
  for (const [id, much] of paidForFood(people, spare * FOOD.ABROAD, work.meat, work.shore, work.fish)) {
    paid.set(id, (paid.get(id) ?? 0) + much);
  }
  return { food: Math.max(0, food - meal.eaten), sold: spare, starved: meal.starved, paid };
}

/**
 * A sale in the street, made by somebody a player is actually watching.
 *
 * The one place the seen half of this world and the unseen half meet over money, and until now
 * they disagreed about it. A hunter you watch walks his deer to the market and `verbs.ts` credited
 * him what the meat was worth out of thin air; a hunter nobody watches is paid his share of what
 * the village spent on dinner. Same man, same deer, two different economies — and the visible one
 * was the one minting money, which is exactly backwards.
 *
 * So a sale is a transfer. Somebody in the village buys the deer, and it is their coin the hunter
 * walks away with. The market seller first, because that is her trade and buying what hunters and
 * farmers bring in is the whole of it; then the other trades whose business is other people; then
 * whoever in the village has the deepest purse, because a village with no stall still eats. Nobody
 * buys themselves out of their own reserve — a week of dinners is kept back, the same reserve
 * `spentOnLiving` will not spend below — so a poor village simply cannot afford the whole deer,
 * and the hunter gets what there is.
 *
 * That the hunter ends the day better off than an unwatched one is not a leak and is not smoothed
 * over. He really did carry a deer in while somebody was looking. What must not happen — and now
 * cannot — is the village as a whole being a coin richer for having been visited.
 *
 * Returns what actually changed hands, which the caller wants for the body standing in the street.
 */
export function soldAtMarket(
  people: readonly Person[], sellerId: string, coin: number, what = '',
): number {
  const seller = people.find((p) => p.id === sellerId);
  if (!seller || coin <= 0) return 0;
  const others = people.filter((p) => p.id !== sellerId && p.trade);
  /*
   * Whoever wants it most, and a hungry man wants dinner more than a shopkeeper wants stock.
   *
   * The buyer used to be ranked by trade and then by purse, which made every sale in the village a
   * sale to the richest person in it — and meant a hunter walking in with a deer past somebody who
   * had not eaten in three days sold it to the man behind the stall. Hunger outranks trade when
   * what is being carried is dinner, which is the whole of what makes a hunter's day worth
   * anything to anybody but himself.
   *
   * It stays ranked by trade for everything else. A pelt is stock, and stock goes to whoever deals
   * in it.
   */
  const feeds = DINNER.has(what);
  const rank = (p: Person): number => {
    if (feeds && (p.hungry ?? 0) > 0) return 3 + Math.min(1, (p.hungry ?? 0) / FOOD.HEARTS);
    return p.trade === 'seller' ? 2 : TRADERS.includes(p.trade) ? 1 : 0;
  };
  const buyer = [...others].sort((a, b) => rank(b) - rank(a) || b.purse - a.purse)[0];
  if (!buyer) return 0;

  // through the shared deed rather than by moving two numbers, because the hero sells things too
  // and a sale that meant one thing in the street and another in a menu is exactly the fault this
  // whole vocabulary was built to end. The reserve is a week of dinners: see `sell` — except when
  // dinner is what is being bought, because a starving man does not keep a week of dinners back
  // against the dinner in front of him
  const keeps = feeds && (buyer.hungry ?? 0) > 0 ? 0 : PROSPER.KEEPS_BACK;
  const paid = sell(purseOf(seller), purseOf(buyer), coin, keeps).paid;
  // and he bought it to eat it. This is the one place in the game a villager is fed by another
  // villager rather than out of the village store, and it is what a hunter's day is *for*
  if (paid > 0 && feeds) buyer.hungry = 0;
  return paid;
}

/**
 * The things that are somebody's dinner.
 *
 * A set here rather than a lookup in the item catalogue, because the catalogue is the game's and
 * this is the world's, and the world has no business knowing what an elixir does. What it has to
 * know is which of the things people carry about will stop somebody being hungry, which is a much
 * shorter list and changes far less often.
 *
 * `livelihoods.test.ts` holds it to the catalogue in both directions, the way `prosperity.test.ts`
 * holds `TRADERS` to the list of trades a villager is actually drawn from — a set naming things
 * that are not food, or missing things that are, is exactly how `TRADERS` came to name four jobs
 * nobody in this world can hold.
 */
export const DINNER: ReadonlySet<string> = new Set([
  'meat', 'roast', 'bread', 'stew', 'apple', 'wheat', 'turnip', 'pumpkin', 'minnow',
]);

/**
 * A villager buys something in their own village, from whoever sells it.
 *
 * The mirror of `soldAtMarket` and the other half of the same complaint. A village pays its
 * seller, its innkeeper and its doctor every single day in the books — that is what `paidForService`
 * is — and nobody has ever been seen handing over a coin for any of it. The evening at the inn was
 * a man walking to a door, standing there, and a number going down: `spend` in `verbs.ts` took the
 * money out of the body's own purse, which is destroyed the moment a player walks away, and gave it
 * to nobody at all.
 *
 * So it is a transfer, to the trade that sells the thing where the game knows which — a bed and a
 * drink are the innkeeper's, gear is the seller's — and to whichever trader is here when it does
 * not. A village with none of the three keeps nothing: the money goes on a pedlar's cart and out of
 * the valley, the same one honest leak `paidForService` has.
 *
 * A villager somebody watched does spend a little more than one nobody watched, exactly as a
 * watched hunter earns a little more, and for the same reason: he really did go to the pub. What
 * cannot happen is the village being a coin poorer for having been visited.
 */
export function boughtInTheVillage(
  people: readonly Person[], buyerId: string, coin: number, from?: string,
): number {
  const buyer = people.find((p) => p.id === buyerId);
  if (!buyer || coin <= 0) return 0;
  const named = from ? people.find((p) => p.trade === from && p.id !== buyerId) : undefined;
  const keeper = named ?? people.find((p) => TRADERS.includes(p.trade) && p.id !== buyerId);
  // nobody here sells anything, so it is bought off whoever is passing and leaves the valley
  const till = keeper ? purseOf(keeper) : AWAY;
  return buy(purseOf(buyer), till, coin).paid;
}

/**
 * As much of the register as a body standing in the street needs.
 *
 * Structural rather than the class, so nothing in `entities/` has to import the register to hand a
 * sale to it, and so a test can stand a village up as an array. `Register` satisfies it as it is.
 */
export interface Books {
  find(id: string): Person | undefined;
  living(village: string): readonly Person[];
}

/**
 * A sale made in the street, reaching the register.
 *
 * The two lines that used to sit in the entity manager, moved here because they are about who is
 * paid rather than about who is drawn — and because the manager is the file this codebase most
 * often finds itself over the length a person can hold in their head.
 */
export function aSaleReached(
  books: Books | null, person: string, coin: number, what = '',
): number {
  const who = person ? books?.find(person) : undefined;
  return who ? soldAtMarket(books?.living(who.village) ?? [], person, coin, what) : 0;
}

/** And a purchase, the same way: an evening at the inn is the innkeeper's takings. */
export function aPurchaseReached(
  books: Books | null, person: string, coin: number, from: string,
): number {
  const who = person ? books?.find(person) : undefined;
  if (!who) return coin;
  return boughtInTheVillage(books?.living(who.village) ?? [], person, coin, from);
}
