import { cellarCap } from './food';
import { coverOf, priceOfAMeal } from './prices';
import { paidForFood } from './livelihoods';
import { coastOf } from './harvest';
import { PROSPER } from './prosperity';
import { payAndSweep } from './purses';
import { ownedBy, type Owner } from './holdings';
import type { Settlement } from './settlement';
import type { Person } from './people';

/**
 * Somebody who walks a cart of food from a valley that has too much to one that has too little.
 *
 * The mines have been the only source of new money in this world since the day there were mines.
 * `economy-report.txt` measures it: one village per seed brings up metal that was not in the valley
 * that morning, and every other village is a closed loop redistributing what it already had. That
 * is the structural reason the tuned constants here keep rotting — a closed economy with one tap has
 * no natural level to tune against — and it is why `FOOD.ABROAD` exists at all. A village's glut is
 * carried to somebody else's market and money comes back from the next valley, said as a constant,
 * because nobody carried it and no market received it.
 *
 * This is the somebody. A cart of meals goes from the fullest cellar within reach to the emptiest
 * one, and the coin for it comes out of the purses of the place that ate it — not out of nowhere at
 * a flat rate. A village that grows food now has a second way to get richer, and the money it gets
 * richer by was in the next valley that morning.
 *
 * ## What a carrier is, in this slice
 *
 * **A flow, not a person.** Nobody is put on the register, nobody walks a road anybody can watch,
 * and nobody can be robbed. That is the smaller of the two answers to the open question on #239 and
 * it is deliberately the one built first: the second — a carrier the player can escort, rob,
 * undercut or be — is a story and a lot of simulation, and it is worth nothing until there is
 * something worth carrying and a price worth arbitraging. This is that something.
 *
 * **One cart a day in the world**, the way `movingon.ts` moves one family a day. A day that could
 * move a dozen carts is a day whose books nobody can read the first time they go wrong.
 *
 * ## Why nothing here is rolled
 *
 * A village's whole life is drawn off one stream, and a draw added or removed re-rolls every
 * village in every world. A carrier acts between *two* villages, so there is no one village whose
 * stream it could honestly belong to — and the honest way out is to take no draw at all. Which cart
 * goes where is read off what the two places are holding tonight, so two machines that agree about
 * the valleys agree about the carrier without a word passing between them.
 *
 * ## What a carrying does not survive, and why that is said out loud
 *
 * A village re-lived from its founding — a killing told late, a vote, an oath — is lived forward
 * with `liveADay` and nothing else, so it arrives without the carts that came over the hill while
 * it was standing. Its neighbours keep the meals and the coin. The same is true of a village
 * settled late: it catches up a day at a time on its own, and a day on its own has no road.
 *
 * That is exactly the seam `movingon.ts` already sits on — a person who walked between two villages
 * is in the same position — and it is written down here rather than hidden because it bounds what a
 * carrier may be built into. Everything between villages is the register's forward clock's
 * business; nothing between villages may be folded into a village's own day without answering this
 * first.
 *
 * ## Where the coin is written down
 *
 * Through `pay`, like every other coin in this world, and recorded per person so that the day's
 * books can be squared against the purses. A carrying is **news** rather than a forecast: the
 * evening before cannot know that a cart will come over the hill tomorrow, in exactly the way it
 * cannot know what the hall will take. Both are read off the day that happened — see `RollRow.tax`,
 * where the same argument is written down — and that is what stops the books and the purses
 * disagreeing about money that crossed a valley.
 */

export const CARRY = {
  /**
   * How much dearer the next valley's dinner has to be before anybody harnesses anything.
   *
   * A quarter again, and it is a ratio rather than a number of coins because the thing being
   * compared is two prices. Nobody walks a day for a rounding error: a cart that went out over a
   * two per cent difference would be a cart going out every morning between two villages that are
   * for all practical purposes the same place, and the road would stop meaning anything.
   *
   * It is also what makes trade *stop*. Two valleys that have been carried between until their
   * cellars match are two valleys nobody has a reason to walk between, which is the right answer
   * and is the whole reason this is a threshold rather than a rate.
   */
  WORTH_CARRYING: 1.25,
  /**
   * What one cart holds, in meals.
   *
   * Twenty, which is close enough to a village's dinner to be worth the walk and nowhere near
   * enough to fill a cellar in a morning. A cellar holds `FOOD.KEEPS_DAYS` a head, so twenty meals
   * is under two days of food for a place of a dozen — a hungry valley is fed over a fortnight of
   * carryings rather than in one, and a player who interferes with the road has a fortnight in
   * which it matters.
   *
   * A cart rather than a share of the surplus on purpose. What limits trade here is the walking,
   * not the growing: a village with four times the glut does not have four times the road.
   */
  A_CARTLOAD: 20,
  /**
   * The least anybody will load, in meals.
   *
   * One dinner. Under it the carrying is not a trade, it is two villages rounding against each
   * other, and every one of them would put a line in a book that a person then has to read.
   */
  WORTH_LOADING: 1,
  /**
   * How far a carrier walks, in tiles.
   *
   * Six hundred, against the twelve hundred a family will walk to start again in `movingon.ts`, and
   * the halving is the argument: resettling is done once in a lifetime with everything you own, and
   * this is done before dinner and again tomorrow. A road worth trading along is one somebody can
   * be back from.
   *
   * Like every other distance the register takes, it only binds where somebody has said where the
   * villages stand. Never told, and a carrier behaves exactly as it did before there was a map,
   * which is the honest answer for a bench that has no ground under it.
   */
  AS_FAR_AS: 600,
} as const;

/**
 * A village as a carrier sees it: a cellar, the people who eat out of it, and somewhere it stands.
 *
 * Deliberately not a `Settlement`. What a carrier needs to know about a place is what anybody
 * standing in its market could tell you — how full the store looks, how many mouths there are and
 * what dinner costs — and a view that small is one a test can build by hand and one no future
 * caller can quietly widen into "the carrier reads the whole register".
 */
export interface Market {
  village: string;
  /** Meals in the store this evening, after everybody here has eaten. */
  food: number;
  /** Who lives here, because both the price and the purses are read off them. */
  people: readonly Person[];
  /** Whether the place has a shore, so that what it is paid goes to whoever actually feeds it. */
  shore: boolean;
  /** How hard something is leaning on it tonight. Nobody walks a cart into a raid. */
  pressure: number;
  /** Where it stands, when whoever asked knows. See `CARRY.AS_FAR_AS`. */
  at?: { x: number; z: number };
}

/** One cart, one evening: what went over the hill and what came back. */
export interface Carrying {
  /** The valley that had it. */
  from: string;
  /** And the one that wanted it. */
  to: string;
  /** Meals, which leave one larder and arrive in the other. Neither grown nor spoilt on the road. */
  meals: number;
  /** What one of them fetched where it was sold, which is the receiving village's own price. */
  price: number;
  /** What the people who ate it paid, as debits against their purses. */
  paying: Map<Owner, number>;
  /** And what the people who grew it were paid, which is the same money. */
  paid: Map<Owner, number>;
}

/** Whether these two places are near enough to walk between, for whoever knows where they are. */
function withinReach(from: Market, to: Market): boolean {
  if (!from.at || !to.at) return true;
  return Math.hypot(from.at.x - to.at.x, from.at.z - to.at.z) <= CARRY.AS_FAR_AS;
}

/**
 * Who in a village finds the money for a cartload, and how much of it each of them finds.
 *
 * Deepest purses first, and nobody down to their last week of dinners — `PROSPER.KEEPS_BACK`, the
 * same reserve `spentOnLiving` will not spend below and the same one a hunter selling a deer in the
 * street is held to. The rich buying the village's bread is the right way round: it is the poor who
 * cannot pay the dear price a hungry valley charges, and it is the poor who stop going without once
 * a cart has made the place cheaper.
 *
 * Handed back as debits rather than applied, because the one place that writes a purse is `pay`.
 */
function whoPaysTheCarrier(people: readonly Person[], asked: number): Map<Owner, number> {
  const owed = new Map<Owner, number>();
  let left = asked;
  const deepest = people
    .filter((person) => person.trade)
    .sort((a, b) => (b.purse - a.purse) || (a.id < b.id ? -1 : 1));
  for (const person of deepest) {
    if (left <= 0) break;
    const spare = Math.max(0, person.purse - PROSPER.KEEPS_BACK);
    if (spare <= 0) continue;
    const much = Math.min(spare, left);
    owed.set(ownedBy(person), -much);
    left -= much;
  }
  return owed;
}

/** What a village could put towards a cart without anybody going below their own reserve. */
function whatItCanFind(people: readonly Person[]): number {
  return people.reduce(
    (sum, person) => sum + (person.trade ? Math.max(0, person.purse - PROSPER.KEEPS_BACK) : 0), 0,
  );
}

/**
 * The one cart that goes out tonight, out of every pair of markets that might have sent one.
 *
 * Read off the markets and nothing else, so that the decision is the same wherever it is asked
 * from. The hungriest valley within reach is served first — a carrier goes where the money is —
 * and it is served out of the cheapest cellar that can reach it, which is what makes a road the
 * shape of the economy rather than scenery.
 *
 * The load is what would bring the two cellars level, capped three ways and every cap load-bearing:
 * by what one cart holds, by what the receiving cellar will actually take, and by what the
 * receiving village can pay for without anybody going below their reserve. Levelling rather than
 * emptying is what stops a carrier turning a fed valley into a hungry one on its way to fixing a
 * hungry one.
 */
export function whatACarrierWouldCarry(markets: readonly Market[]): Carrying | null {
  // nobody walks a cart into a raid, and nobody walks one out of one: same threshold the farming
  // and the earning stop at, and for the same reason — people who are being buried are not on the
  // road
  const open = markets
    .filter((one) => one.pressure <= PROSPER.UNTROUBLED && one.people.length > 0)
    .map((one) => ({ market: one, price: priceOfAMeal(one.food, one.people) }))
    // cheapest first, and by name where two places charge the same, so that the cart a world sends
    // depends on what the villages hold and never on the order somebody happened to settle them in
    .sort((a, b) => (a.price - b.price) || (a.market.village < b.market.village ? -1 : 1));

  let best: Carrying | null = null;
  let dearest = 0;
  for (const { market: to, price } of open) {
    if (price <= dearest) continue;
    const room = cellarCap(to.people) - to.food;
    const purse = whatItCanFind(to.people);
    if (room <= 0 || purse <= 0) continue;

    for (const { market: from } of open) {                 // cheapest cellar that can reach it
      if (from === to || !withinReach(from, to)) continue;
      if (price < priceOfAMeal(from.food, from.people) * CARRY.WORTH_CARRYING) continue;
      /*
       * What would bring the two cellars level, which is a share of each cap rather than a number
       * of meals: a hamlet and a town that are equally hungry are not equally short.
       */
      const caps = cellarCap(from.people) * cellarCap(to.people)
        / (cellarCap(from.people) + cellarCap(to.people));
      const level = (coverOf(from.food, from.people) - coverOf(to.food, to.people)) * caps;
      const wanted = Math.min(level, CARRY.A_CARTLOAD, room, from.food, purse / price);
      if (wanted < CARRY.WORTH_LOADING) continue;

      /*
       * The money is counted first and the load follows from it, which is the other way round from
       * how it reads and is the whole of how a carrying cannot mint or burn a coin.
       *
       * What the buyers can actually find is the one number here that arithmetic can round: a load
       * priced at what the village holds to the last hundredth is a load the purses come a
       * hair short of. Taking what they gave and working the cart back out of it leaves the two
       * halves exactly equal by construction rather than by a tolerance.
       */
      const paying = whoPaysTheCarrier(to.people, wanted * price);
      const coin = -[...paying.values()].reduce((sum, much) => sum + much, 0);
      const meals = coin / price;
      if (meals < CARRY.WORTH_LOADING) continue;

      const paid = paidForFood(from.people, coin, 0, from.shore);
      // a village with nobody left to pay is a village the money would arrive in and vanish from,
      // which is the one thing a coin is never allowed to do. It keeps its glut instead
      if (paid.size === 0) continue;
      best = { from: from.village, to: to.village, meals, price, paying, paid };
      dearest = price;
      break;
    }
  }
  return best;
}

/** A village, as the one thing a carrier is allowed to know about it. */
function marketOf(village: string, here: Settlement, pressure: number, at?: { x: number; z: number }): Market {
  return {
    village, food: here.food, people: here.people, shore: coastOf(here).shore, pressure, at,
  };
}

/**
 * A carrier walks, once the day's villages have all worked and eaten.
 *
 * In the evening rather than the morning, and that is the seam the whole thing hangs on. A village's
 * day is forecast from the state it went to bed in — what its cellar holds decides what its dinner
 * costs, which `expected.ts` quotes to the coin the night before — so a cart that arrived before
 * breakfast would have every roll in the world quoting yesterday's price for today's dinner, and the
 * economy bench reads that gap as coin appearing from nowhere. Arriving after dinner, the load is
 * simply in the cellar the next morning's forecast reads.
 *
 * The meals come out of the cellar the sending village has already filled, so what it costs that
 * village is not the food — it is tomorrow's glut, which is exactly the food `FOOD.ABROAD` has been
 * paying a flat rate for and throwing at nobody. A carrying moves that meal to a market that
 * actually wanted it and swaps the constant for what the next valley actually paid.
 *
 * `book` is written rather than returned so that a carrying can be read back person by person,
 * which is how a village's day squares against its own roll. See `Register.carriedBy`.
 */
export function aCarrierWalks(
  villages: ReadonlyMap<string, Settlement>,
  where: (village: string) => { x: number; z: number } | undefined,
  pressureOn: (village: string) => number,
  book: Map<string, number>,
): Carrying | null {
  const markets = [...villages].map(
    ([name, here]) => marketOf(name, here, pressureOn(name), where(name)),
  );
  const cart = whatACarrierWouldCarry(markets);
  if (!cart) return null;

  const from = villages.get(cart.from)!;
  const to = villages.get(cart.to)!;
  from.food -= cart.meals;
  to.food += cart.meals;
  payAndSweep(from, cart.paid);
  payAndSweep(to, cart.paying);
  for (const [id, much] of cart.paid) book.set(id, (book.get(id) ?? 0) + much);
  for (const [id, much] of cart.paying) book.set(id, (book.get(id) ?? 0) + much);
  return cart;
}
