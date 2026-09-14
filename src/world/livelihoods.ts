import { FOOD, broughtIn, cellarCap, eat } from './food';
import { PROSPER, TRADERS, earnedInADay, spentOnLiving } from './prosperity';
import { AWAY, buy, purseOf, sell } from './deeds';
import { ownedBy, BEASTS_PER_FARM, mannedFarms, shareTheTake, type Standing, type Owner } from './holdings';
import { herdRoomFor } from './stables';
import { aDayOfCattle, aDaysFishing, coastOf } from './harvest';
import type { Person } from './people';
import { ableToWork } from './wounds';
import { foodAt } from './fields';

/**
 * The four ways a villager gets a coin, and the coin actually going from one hand to another.
 *
 * The economy had a source and a drain and nothing in between. `mines.ts` minted gold and shared it
 * among a crew; `prosperity.ts` paid everybody else a flat daily float out of nowhere; `food.ts`
 * charged for dinner and burnt the money. Over a hundred days every purse was filled by the same
 * invisible hand and emptied into the same invisible hole, and not one coin passed between two
 * people. A village with a market was richer than one without because a constant said so.
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
   * Three hundredths of whatever they hold above their week of dinners. Small on purpose: thirty
   * people carrying a dozen gold apiece raise about five a day, so a harbour is a season's taxes
   * rather than an afternoon's — which is what makes it a thing a village decides to do.
   *
   * It also has to be far under what a day earns, or the tax is why nobody in the country can save.
   * A slice off what is left after a working day, stopping entirely at `KEEPS_BACK`.
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
   * How many beasts a farm's paddocks hold. The number and the argument are `BEASTS_PER_FARM`.
   *
   * **The seam this name left is settled, and it settled towards the farm.** It was written as a cap
   * per *farmer* when a farmer had exactly one farm and a farm had exactly one farmer, so the two
   * readings were the same number in every village that had ever existed. They come apart the
   * morning a man can own two, and the rails are the farm's: six head is what a farm's fences hold,
   * whoever owns them — but only of a farm somebody is standing in, so a man who owns two and works
   * one has six. The old name is kept because half the bench quotes it; `mannedFarms` is what counts.
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
export function shareOut(pool: number, shares: ReadonlyMap<Owner, number>): Map<Owner, number> {
  const out = new Map<Owner, number>();
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
  fromFields: ReadonlyMap<Owner, number> | null = null,
): Map<Owner, number> {
  const shares = new Map<Owner, number>();
  const farmers = people.filter((p) => p.trade === 'farmer');
  const crews = people.filter((p) => p.trade === 'fisherman');
  for (const person of people) {
    if (!person.trade) continue;
    const meat = person.trade === 'farmer' && farmers.length > 0 ? fromHerd / farmers.length : 0;
    // the catch is the fishermen's, shared between them, for the reason the meat is the farmers':
    // it came off their boats. The shellfish is nobody's in particular and is already in `broughtIn`
    const fish = person.trade === 'fisherman' && crews.length > 0 ? fromBoats / crews.length : 0;
    /*
     * `null` and an empty map are different answers, and the difference is the whole of why this
     * argument is nullable.
     *
     * `broughtIn` is the one expression of what a farmer grows, and its own comment says why: *"a
     * second expression of 'what a farmer grows' living in `livelihoods.ts` would be a farmer who
     * is fed by one number and paid by another"*. A caller that has counted the fields takes the
     * farm's share out of `broughtIn` and adds the measured crop below, so the two agree. A caller
     * that has not counted them — every caller outside `aDaysTrade` — must get the same number the
     * larder got, which is `broughtIn`'s own default. An empty map from a village that has fields
     * means nobody's field yielded; `null` means nobody asked.
     */
    const grew = fromFields ? broughtIn(person, shore, 0) : broughtIn(person, shore);
    shares.set(ownedBy(person), grew + meat + fish);
  }
  /*
   * And a share must name one of the people being paid, which is not the same list the fields were
   * counted against: the crop is worked out in the morning and dinner is bought in the evening, and
   * somebody can be buried in between. A share left standing in a dead man's name is money sent
   * nowhere — `pay` calls it `unplaced` and says it *"should never happen at all"*.
   *
   * Dropped rather than redirected, because `shareOut` hands out a pool in proportion: one share
   * fewer is the same money divided among the people who are still at the table, which is what
   * actually happens to a dead man's dinner.
   */
  const here = new Set(people.map(ownedBy));
  for (const [owner, crop] of fromFields ?? []) {
    if (!here.has(owner)) continue;
    shares.set(owner, (shares.get(owner) ?? 0) + crop);
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
  fromFields: ReadonlyMap<Owner, number> | null = null,
): Map<Owner, number> {
  return shareOut(spent, whoFed(people, fromHerd, shore, fromBoats, fromFields));
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
export function paidForService(people: readonly Person[], upkeep: number): Map<Owner, number> {
  const shares = new Map<Owner, number>();
  for (const person of people) {
    if (TRADERS.includes(person.trade)) shares.set(ownedBy(person), 1);
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
   * The field crop by owner, so dinner money follows the farm rather than merely the trade.
   *
   * Not optional, and that is load-bearing. A day that has counted the fields must say so even when
   * the answer is that none of them yielded, because the alternative reading of an absent map is
   * *"nobody counted"* — and the two want different arithmetic out of `whoFed`. See the note there.
   */
  fields: ReadonlyMap<Owner, number>;
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
  /**
   * The take of the holdings the village itself owns, less the wages it paid the hands standing in
   * them. Nought wherever every farm is somebody's own, which is everywhere until one is bought.
   */
  toTheHall: number;
  /** What each purse is owed for the day's work, before anybody has eaten. */
  paid: Map<Owner, number>;
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
  village: {
    trades?: readonly string[];
    holdings?: readonly Standing[];
    /** What the village has built, so a farm that was built up holds what it was built to hold. */
    works?: readonly string[];
  } = {},
): Trading {
  const coast = coastOf(village);
  const paid = new Map<Owner, number>();
  const add = (id: Owner, much: number): void => { paid.set(id, (paid.get(id) ?? 0) + much); };
  const keep = (): number => {
    let upkeep = 0;
    for (const person of people) {
      const spent = spentOnLiving(person);
      upkeep += spent;
      add(ownedBy(person), -spent);
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
    // an empty map rather than none: the fields *were* counted and a raided village grew nothing,
    // which is the number the larder took and so the number the dinner money has to agree with
    return { herd, grown: 0, fields: new Map(), meat: 0, fish: 0, shore: coast.shore, toTheHall: 0, paid };
  }

  // a man who is laid up does not work, and his trade earns the village nothing while he is: see
  // `wounds.ts`. He still eats and still pays for his dinner, which is what makes a bad week
  // expensive rather than fatal
  const working = people.filter(ableToWork);
  const farmers = working.filter((p) => p.trade === 'farmer');
  // the paddocks are counted off the farms somebody is standing in rather than off the men, which
  // is the same number until a man owns two: `mannedFarms` settles that seam, and it says the
  // rails belong to the farm
  const farms = mannedFarms(village.holdings, working);
  const fields = new Map<Owner, number>();
  let fieldMeals = 0;
  const addField = (owner: Owner, meals: number): void => {
    fields.set(owner, (fields.get(owner) ?? 0) + meals);
    fieldMeals += meals;
  };
  if (village.holdings !== undefined) {
    const byId = new Map(working.map((person) => [person.id, person]));
    const farmerOwners = new Set(farmers.map(ownedBy));
    for (const farm of village.holdings.filter((holding) => holding.kind === 'farm')) {
      const worker = byId.get(farm.worker ?? '');
      const owner = farm.owner ?? (worker ? ownedBy(worker) : undefined);
      const recipient = owner && (worker || farmerOwners.has(owner)) ? owner : worker && ownedBy(worker);
      if (recipient) addField(recipient, foodAt(village.works ?? [], farm.id ?? ''));
    }
  }
  // by id and with what the village has built, so a farm that was built up holds what it was built
  // to hold rather than the same as every other farm. See `aDayOfCattle`
  // a holding's id is optional on `Standing` — a farm mid-founding has none yet — and one with no
  // id has nothing built against it either, so it counts as a byre like any other
  const ids = farms ? farms.map((f) => f.id ?? '').filter((id) => id !== '') : farmers.map((p) => p.id);
  const cattle = aDayOfCattle(
    herd,
    // a holding's id is optional on `Standing` — a farm mid-founding has none yet — and one with no
    // id has no stable recorded against it either, so it counts as a byre like any other
    ids,
    // what those farms hold between them, which is the rest of item 33: a farmer who paid for a
    // barn carries more than one who did not, where this used to be farms times a constant
    herdRoomFor(village.works ?? [], ids),
  );
  // and the boats, which are the coast's answer to the paddocks: see `aDaysFishing` for why the
  // two are the same shape and deliberately not the same behaviour
  const caught = aDaysFishing(coast.boats, working.filter((p) => p.trade === 'fisherman').length);

  // what a trade brings in from beyond the village: the seam, the sea, the road, the far country,
  // and what a traveller spends at an inn on his way through
  for (const person of working) add(ownedBy(person), earnedInADay(person, pressure));

  // the meat the next valley bought: one of the four ways money gets into a village at all, and it
  // belongs to whoever owns the paddocks rather than to whoever was standing in them. When those
  // are the same man — every farm there has ever been until a village buys one — not a coin of this
  // moves anywhere it did not move before. See `shareTheTake`
  const take = farms
    ? shareTheTake(farms, cattle.gold, people)
    : { purses: shareOut(cattle.gold, new Map(farmers.map((p) => [ownedBy(p), 1]))), toTheHall: 0 };
  for (const [id, much] of take.purses) add(id, much);
  /*
   * And the fish, the same way, which is the fourth — and the first one a village can *build*.
   *
   * A seam is where it is, a wood is where it is, and a road brings whoever it brings. A harbour is
   * the one source of outside money in this economy that somebody decided to have: three hundred
   * and forty gold and thirty lengths of timber, and a coast that had none now has one. That is
   * what item 41 means by a harbour being the first thing here that pays for itself.
   */
  const crews = working.filter((p) => p.trade === 'fisherman');
  for (const [id, much] of shareOut(caught.gold, new Map(crews.map((p) => [ownedBy(p), 1])))) {
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
    add(ownedBy(person), -pitch);
  }
  for (const [id, much] of paidForService(people, keep() + pitches)) add(id, much);

  return {
    herd: cattle.herd,
    grown: people.reduce((sum, person) => sum + broughtIn(person, coast.shore, 0), 0)
      + fieldMeals + cattle.meals + caught.meals,
    fields,
    meat: cattle.meals,
    fish: caught.meals,
    shore: coast.shore,
    toTheHall: take.toTheHall,
    paid,
  };
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
  paid: Map<Owner, number>;
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
  const paid = paidForFood(people, meal.spent, work.meat, work.shore, work.fish, work.fields);
  // and the money for it comes from the next valley, because that is where the food went
  for (const [id, much] of paidForFood(
    people, spare * FOOD.ABROAD, work.meat, work.shore, work.fish, work.fields,
  )) {
    paid.set(id, (paid.get(id) ?? 0) + much);
  }
  return { food: Math.max(0, food - meal.eaten), sold: spare, starved: meal.starved, paid };
}

/**
 * A sale in the street, made by somebody a player is actually watching.
 *
 * The one place the seen half of this world and the unseen half meet over money, and they used to
 * disagree. A hunter you watch was credited what the meat was worth out of thin air; a hunter
 * nobody watches is paid his share of what the village spent on dinner. Same man, same deer, two
 * economies — and the visible one was minting, which is exactly backwards.
 *
 * So a sale is a transfer: somebody in the village buys the deer and it is their coin he walks away
 * with. The market seller first, because buying what hunters bring in is her trade; then the other
 * trades whose business is other people; then the deepest purse, because a village with no stall
 * still eats. Nobody buys past their own week of dinners — `spentOnLiving`'s reserve — so a poor
 * village cannot afford the whole deer and the hunter gets what there is.
 *
 * That he ends better off than an unwatched one is not a leak: he really did carry a deer in while
 * somebody was looking. What must not happen is the *village* being a coin richer for the visit.
 *
 * Returns what changed hands, which the caller wants for the body standing in the street.
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
 * seller, its innkeeper and its doctor every day in the books — `paidForService` — and nobody was
 * ever seen handing over a coin for any of it. The evening at the inn was a man walking to a door
 * and a number going down: `spend` took it out of a body's purse, which is destroyed the moment a
 * player walks away, and gave it to nobody.
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
