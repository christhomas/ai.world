import { FOOD, broughtIn, cellarCap, eat } from './food';
import { PROSPER, TRADERS, earnedInADay, spentOnLiving } from './prosperity';
import { purseOf, sell } from './deeds';
import type { Person } from './people';

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
   * How many beasts one farmer's paddocks hold.
   *
   * The cap rather than the herd: a herd grows up to this and then stops, because a farmer with
   * six cows has a farmer's day and a farmer with six hundred has a ranch and a different game.
   * Six is what a seven-tile yard and the field behind it read as from the road, and it is what
   * `paddock.ts` can actually stand up inside its rails without the beasts walking through one
   * another.
   */
  HERD_PER_FARMER: 6,
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
   * The share of a herd that goes to market rather than being kept back to breed.
   *
   * Only the surplus over what the paddocks hold, which is exactly the user's sentence: the cows
   * reproduce at the same rate they are eaten. A herd below its cap keeps every calf and grows; a
   * herd at its cap sells precisely what was born that morning and stays the size it is. Nothing
   * else needs saying, and no constant is needed for it — it falls out of the cap.
   */
} as const;

/** What a day of keeping cattle came to. */
export interface Herding {
  /** The herd this evening, after the calves and after the butcher. */
  herd: number;
  /** Beasts that went to market today. */
  sold: number;
  /** What they came to in the larder. */
  meals: number;
  /** And what the neighbours paid for the rest, which is money the village did not have. */
  gold: number;
}

/**
 * A day of a village's cattle.
 *
 * Pure in the herd and the number of farmers, so a village re-lived from its founding arrives at
 * the same paddock as the village somebody watched — which matters, because the register does
 * exactly that whenever a player first walks into a place.
 *
 * A village with no farmers has no herd, and loses the one it had. That is not a punishment: cows
 * that nobody feeds are cows that walk off, and a village whose last farmer has been buried has
 * bigger problems than its beef.
 */
export function aDayOfCattle(herd: number, farmers: number): Herding {
  if (farmers <= 0) return { herd: 0, sold: 0, meals: 0, gold: 0 };
  const cap = farmers * LIVELIHOOD.HERD_PER_FARMER;
  const after = herd + herd * LIVELIHOOD.CALVES;
  /*
   * Only what the paddocks will not hold, and never more than a day's work at the butcher.
   *
   * The first half is the whole model: a herd under its cap keeps everything and grows toward it,
   * and a herd at its cap sells exactly the calves and stays the size it is. The second half is
   * what stops a village burying three of its four farmers and the survivor waking up to a
   * hundred and sixty gold — the cap falls with the farmers, and without a rate the entire surplus
   * goes to market in one morning. The bench found it as a farmer averaging sixty-seven a day
   * against every other trade's three. A herd over its cap shrinks by a calving a day, which is
   * a fortnight or two to work off a dead man's beasts, and looks from the road like what it is.
   */
  const sold = Math.max(0, Math.min(after - cap, after * LIVELIHOOD.CALVES));
  return {
    herd: after - sold,
    sold,
    meals: sold * LIVELIHOOD.MEALS_PER_BEAST,
    gold: sold * LIVELIHOOD.PRICE_PER_BEAST,
  };
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
export function whoFed(people: readonly Person[], fromHerd = 0): Map<string, number> {
  const shares = new Map<string, number>();
  const farmers = people.filter((p) => p.trade === 'farmer');
  for (const person of people) {
    if (!person.trade) continue;
    const meat = person.trade === 'farmer' && farmers.length > 0 ? fromHerd / farmers.length : 0;
    shares.set(person.id, broughtIn(person) + meat);
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
  people: readonly Person[], spent: number, fromHerd = 0,
): Map<string, number> {
  return shareOut(spent, whoFed(people, fromHerd));
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
): Trading {
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
    return { herd, grown: 0, meat: 0, paid };
  }

  const farmers = people.filter((p) => p.trade === 'farmer');
  const cattle = aDayOfCattle(herd, farmers.length);

  // what a trade brings in from beyond the village: the seam, the sea, the road, the far country,
  // and what a traveller spends at an inn on his way through
  for (const person of people) add(person.id, earnedInADay(person, pressure));

  // the meat the next valley bought, which is the farmers' and is one of the three ways money
  // gets into a village at all
  for (const [id, much] of shareOut(cattle.gold, new Map(farmers.map((p) => [p.id, 1])))) {
    add(id, much);
  }

  // and everybody's keep, out of their purse and into the purses of whoever sold it to them
  for (const [id, much] of paidForService(people, keep())) add(id, much);

  return {
    herd: cattle.herd,
    grown: people.reduce((sum, person) => sum + broughtIn(person), 0) + cattle.meals,
    meat: cattle.meals,
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
): Map<string, number> {
  const day = aDaysTrade(people, herd, pressure);
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
  const larder = Math.min(cellarCap(people), store + day.grown);
  const pool = Math.min(canPay, Math.floor(larder)) * FOOD.MEAL;

  for (const [id, much] of paidForFood(people, pool, day.meat)) {
    income.set(id, (income.get(id) ?? 0) + much);
  }
  // and the keep is already in `paid` as a debit, which is where it belongs: the roll says what a
  // day takes in and what it costs on separate lines, and this is the taking-in line
  for (const one of people) income.set(one.id, (income.get(one.id) ?? 0) + spentOnLiving(one));
  return income;
}

/** What a village grew, what it ate, and who was paid for it. */
export interface Dinner {
  /** What is left in the store this evening. */
  food: number;
  /** Who has now gone long enough without to have died of it. */
  starved: Person[];
  /** And what dinner cost, going to whoever's dinner it was. */
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
  const food = Math.min(cellarCap(people), store + work.grown);
  const meal = eat(people, food);
  return {
    food: Math.max(0, food - meal.eaten),
    starved: meal.starved,
    paid: paidForFood(people, meal.spent, work.meat),
  };
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
  people: readonly Person[], sellerId: string, coin: number,
): number {
  const seller = people.find((p) => p.id === sellerId);
  if (!seller || coin <= 0) return 0;
  const others = people.filter((p) => p.id !== sellerId && p.trade);
  const rank = (p: Person): number => (p.trade === 'seller' ? 2 : TRADERS.includes(p.trade) ? 1 : 0);
  // her trade first, then the other trades whose business is other people, then the deepest purse
  const buyer = [...others].sort((a, b) => rank(b) - rank(a) || b.purse - a.purse)[0];
  if (!buyer) return 0;

  // through the shared deed rather than by moving two numbers, because the hero sells things too
  // and a sale that meant one thing in the street and another in a menu is exactly the fault this
  // whole vocabulary was built to end. The reserve is a week of dinners: see `sell`.
  return sell(purseOf(seller), purseOf(buyer), coin, PROSPER.KEEPS_BACK).paid;
}
