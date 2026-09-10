import type { Person } from './people';

/**
 * What a village is worth, and what it does about it.
 *
 * Villagers already buy and sell in the same economy the player does and already carry a purse,
 * but the purse belonged to the entity standing in the street — so it emptied the moment you
 * walked away and the village was never a penny richer for anything. Money went in and nothing
 * came of it, which makes the economy a thing that happens to the player and to nobody else.
 *
 * So earnings live on the person in the register, who outlives being drawn, and they accumulate.
 * A village that is left alone gets slowly better off; one under pressure from a warband does
 * not, because people who are being buried are not trading. What the money then buys is a house
 * with another storey on it, and after that the things people build when they have more than they
 * need — which is the point: the economy should change the world and not only your pocket.
 */

export const PROSPER = {
  /**
   * What a day is worth to somebody the player never watched.
   *
   * A small floor rather than a wage. Villagers earn properly now — a sale credits the seller the
   * true market value of what they sold — but only the handful of them standing near the player
   * are ever simulated closely enough to make one. This keeps the rest of the world ticking over
   * at a subsistence rate instead of a village quietly starving because nobody visited it, and it
   * is deliberately far below what an afternoon of real trade brings in.
   *
   * Two, and the half coin it went up by is the whole of A7. Dinner costs one and upkeep three
   * tenths, so at one and a half an ordinary day left two tenths — twelve gold across a working
   * life, less than a night at an inn — and at the upkeep this had before, it left nothing at all
   * and every purse in the world converged on the same six and a half. A floor is only a floor if
   * somebody can stand on it: what a day pays has to beat what a day costs, or nobody in the
   * country can put a coin by however long they are left in peace.
   */
  A_DAY: 2,
  /**
   * A seller, an innkeeper or a doctor does better; the trades whose business is other people.
   *
   * Half again the ordinary wage, which is a smaller gap than it sounds and a larger one than it
   * looks. What a purse actually grows by is the wage less dinner and less upkeep, so three
   * against two is not one and a half times as good but two and a half — a trader puts by 1.7 a
   * day against a farmer's 0.7. The wage table is gentle and the savings table is steep, which is
   * the right way round: nobody in a village is visibly rich, and the village with a market and an
   * inn in it is the one that ends the season with a bath house.
   */
  TRADED: 3,
  /** Nobody earns while the place is being raided; below this pressure, business as usual. */
  UNTROUBLED: 0.25,
  /**
   * How well off everybody in a village has to be before its houses grow a second storey.
   *
   * A comfort, not a builder's quote, and the difference matters. `BUILD.PRICE` is 420 because
   * that is what the hero pays a man to raise a house from nothing; a villager earns two a day and
   * dies inside ninety, so no villager will ever hold four hundred gold and no reading of this as
   * a price could ever come true. It was 340 — near the price of a whole house, asked of every
   * head in the village — and the bench found the best village in three seeds averaging 33 a head,
   * a factor of ten short. `storeysFor` had never once returned two in the life of the game.
   *
   * Thirty-five was measured rather than chosen, and it stopped being right the night the mines
   * started working. That is worth saying plainly, because it is the ordinary way a tuned number
   * goes wrong: nobody touched this, the world got richer underneath it. A village with a worked
   * mine near it mints eight hundred to a thousand gold over a hundred days that it simply did not
   * have before, and at thirty-five fifteen of the twenty-one villages the bench lives ended up two
   * storeys tall, the first of them on day sixteen. A mark every village earns is not a mark.
   *
   * Fifty-five, re-measured across the same twenty-one villages. At thirty-five, fifteen of them
   * cross and the earliest on day 16; at forty-five, nine, earliest day 21; at fifty-five, six,
   * from day 29 out to day 95; at sixty-five, three, and all of them in the middle of the run. Six
   * in twenty-one is about the share the original number was aiming at — an ordinary village stays
   * low and the ones that have done well go up — and the spread from day 29 to day 95 is what says
   * a village *becomes* prosperous rather than being born so.
   *
   * And it is a line a village can fall back under. A place with a band standing over it drops
   * below inside a fortnight and climbs out again when the band goes, which is the whole point of
   * the number: what a player can protect, they should also be able to see from the road.
   */
  STOREY: 55,
  /**
   * What a village's luxuries cost — reckoned against everything the village has between it, not
   * against one purse. Nobody here lives more than ninety days, so no individual could ever afford
   * one; a village of two dozen, left alone, can.
   *
   * A bath house costs what it costs however many people are chipping in, which is what makes it a
   * thing big villages get and small ones do not, rather than a thing everybody gets eventually. It
   * was 3,400, which the richest village on any seed missed by a factor of six; then eight hundred,
   * which was where the range separated before the mines were minting anything.
   *
   * Nine hundred, and what moved it is not how many villages get one — five of twenty-one either
   * way — but *when*. At eight hundred all five had theirs by day 37 and nothing changed for the
   * remaining nine weeks; at nine hundred they arrive on days 28, 32, 82, 99 and 100. That is the
   * whole difference between a fact about a village and something that happens to it while you are
   * playing. At a thousand only two cross and at twelve hundred none does, so this is the top of
   * the range rather than a point in the middle of it.
   */
  LUXURY: 900,
  /**
   * The most anybody keeps by them.
   *
   * A cap rather than a rule about the world: a purse that only ever fills is a savings account,
   * not a circulation. Now that food takes money out every day and a village spends on its own
   * upkeep, this is only here to stop one long-lived shopkeeper in a quiet corner ending the
   * century with everything.
   */
  MOST: 4000,
  /**
   * What a working person spends on themselves in a day, beyond food: a mended roof, a new haft,
   * a drink. Small, but it is what stops a purse being a place money goes to die.
   *
   * It has to be less than `A_DAY` minus a meal, and that is not a preference, it is the whole
   * arithmetic of the thing. At eight tenths against a wage of one and a half it was more than the
   * day had left after dinner, so every working villager in the world was three tenths worse off
   * every morning — and the only reason they did not starve was `KEEPS_BACK`, which stopped the
   * spending as the purse ran down. That turned the floor into a ceiling: below six the day gained
   * half a coin, above six and eight tenths it lost three, and in between upkeep took exactly the
   * difference. Every purse in the country settled on 6.5 and sat there. The bench measured the
   * middle villager of three untroubled villages holding exactly 6.5 for the last 87 days of a
   * hundred, on every seed, which is not bad luck but a fixed point.
   *
   * Too high and that comes back. Too low — nothing at all — and a purse only ever fills, a
   * village can never have a bad year, and being raided costs it nothing it would not get back by
   * standing still.
   */
  UPKEEP: 0.3,
  /**
   * What somebody will not spend below, so nobody spends themselves into starving.
   *
   * Six because a meal costs one and seven days without one kills you, so this is a week of
   * dinners less tonight's: somebody who stops spending here can still eat right up to the day
   * the food itself runs out. It is a reserve against a bad week and nothing else — it must never
   * again be the number a working purse comes to rest on, which is what it was while upkeep was
   * larger than the day's margin.
   */
  KEEPS_BACK: 6,
} as const;

/**
 * The trades whose whole business is other people's money.
 *
 * These are ids out of `TRADES` in `entities/trades.ts` and nothing else, which is worth saying
 * because for a long time they were not. The set read shopkeeper, innkeeper, smith, apothecary
 * and merchant — the names of the *shops* a village has — and four of those five are not jobs
 * anybody in this world can hold. A villager is a seller, a farmer, a hunter, a soldier, a sailor,
 * a miner, a climber, an explorer, a constable, a doctor or an innkeeper, so the higher wage
 * reached exactly one person per village, and only in a village with an inn. Ten of the eleven
 * trades in the game were paid the same subsistence floor and the wage table had no shape at all.
 *
 * The alternative was to drop the second rate and pay everybody the same, and it was rejected on
 * purpose: a flat wage makes every village the same place with a different name. What a village
 * has — a market, an inn, a doctor's door — should be why one of them ends the season with a bath
 * house and the one on the rock does not, and that is a reason for a player to walk to one rather
 * than another. Named as trades rather than as buildings, this cannot rot the same way again;
 * `prosperity.test.ts` holds every name in it to the list a villager is actually drawn from.
 */
export const TRADERS: readonly string[] = ['seller', 'innkeeper', 'doctor'];

/** What one person earns on one ordinary day. */
export function earnedInADay(person: Person, pressure: number): number {
  if (pressure > PROSPER.UNTROUBLED) return 0;
  if (!person.trade) return 0;                       // children and the very old keep no purse
  return TRADERS.includes(person.trade) ? PROSPER.TRADED : PROSPER.A_DAY;
}

/**
 * What somebody spends on themselves today, beyond eating.
 *
 * Deliberately not modelled as items — this is the mending, the drinking and the replacing that a
 * life involves and that nobody would want simulated. What matters is only that it leaves the
 * purse, because money that never leaves is not money, it is a score.
 *
 * Nobody spends into their last few coins: going hungry to buy a new hat is not a thing people do,
 * and a village that did it would starve itself the first quiet week.
 */
export function spentOnLiving(person: Person): number {
  if (!person.trade) return 0;
  if (person.purse <= PROSPER.KEEPS_BACK) return 0;
  return Math.min(PROSPER.UPKEEP, person.purse - PROSPER.KEEPS_BACK);
}

/**
 * How many storeys the houses of a village have. One, or two once the place can carry it.
 *
 * Asked of what a village holds a head rather than of one person's purse, because the houses of a
 * village go up together: `tidings.ts` sets one number for the whole place and the chunks stamp
 * every cottage in it the same. A single rich innkeeper should not put a storey on his neighbours'
 * roofs, and a village where everybody is comfortable should not stay low because one household
 * is not.
 */
export function storeysFor(eachHolds: number): number {
  return eachHolds >= PROSPER.STOREY ? 2 : 1;
}

/** What a village has managed to build for itself, out of everything it has between it. */
export type Luxury = 'none' | 'sauna' | 'pool';

export function luxuryFor(villageTotal: number, seed: number): Luxury {
  if (villageTotal < PROSPER.LUXURY) return 'none';
  return (seed & 1) === 0 ? 'sauna' : 'pool';
}

/**
 * What using it costs a visitor.
 *
 * Priced against the inn's bed at ten rather than against what the village spent building it,
 * which is the only comparison a player can make: a bath house and a night's rest are the two
 * things in this world you buy an evening of. It is a shade more because you cannot get one
 * anywhere else.
 */
export function feeFor(luxury: Luxury): number {
  return luxury === 'none' ? 0 : 12;
}

/**
 * How well off a village is, in words, which is the only form of it anybody is shown.
 *
 * Said in fractions of `STOREY` rather than in coins of its own, so the words and the roofline
 * cannot drift apart: "there is money here" lands just under the height a village's houses grow
 * at, and a player who hears it and then sees a low village is being told the place is close.
 * On the bench's numbers that puts the four sayings at under 14, 14 to 28, 28 to 56 and above,
 * against villages that run between 12 and 65 a head — so the top one is genuinely rare and the
 * bottom one means a village that has been raided or has just buried half of itself.
 */
export function saidOfWealth(total: number, people: number): string {
  const each = people > 0 ? total / people : 0;
  if (each >= PROSPER.STOREY * 1.6) return 'It is doing very well for itself.';
  if (each >= PROSPER.STOREY * 0.8) return 'There is money here.';
  if (each >= PROSPER.STOREY * 0.4) return 'It gets by.';
  return 'It is a poor place.';
}
