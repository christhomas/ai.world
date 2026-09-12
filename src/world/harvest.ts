import { FOOD } from './food';
import { LIVELIHOOD } from './livelihoods';

/**
 * What a village's beasts and its boats bring in, as against what its people earn.
 *
 * Out of `livelihoods.ts` because it is a subject of its own and that file had run out of room. The
 * split is an honest one rather than a filing convenience: everything left next door is about a
 * *person* — what a trade earns, what a keep costs, who is paid for the dinner — and everything here
 * is about a *thing a village owns*. A herd calves whether or not anybody is watching it and a boat
 * lands fish because it went out, and neither of those is a wage.
 *
 * It is also the one place the two sources of food in this world sit side by side, which is where
 * the work list wanted the catch put: "a number in `livelihoods.ts` beside the herd". They are
 * beside each other, and reading them together is the fastest way to see why a fishing village is
 * not a farm with a boat —
 *
 *   **cattle are capital.** A herd breeds, grows towards a cap that a farm's buildings decide, and
 *   what a farmer sells is the surplus over what the paddocks will hold. Wolves can take it, and
 *   then it takes a month to come back.
 *
 *   **a shoal belongs to nobody.** There is no stock to grow and none to run down: a boat that goes
 *   out lands a day's fish and a boat that stays in lands nothing, and tomorrow is the same offer.
 *
 * What that buys is a coast whose income has no memory. A farm ruined takes a season; a fleet that
 * missed a week has missed a week. So a coast is the place to be when things go badly and the place
 * to leave when they go well, which is a real difference in shape rather than a reskin.
 *
 * It points one way, like everything else in this corner: it may be asked about holdings and it asks
 * nothing about earning. `livelihoods.ts` imports this; this imports only the tables.
 */

/**
 * What the water gives a village, which is nothing at all inland.
 *
 * Both halves are read off things the settlement already holds, so nothing new is stored and a
 * village re-lived from its founding arrives at the same coast. `shore` comes off the trade list —
 * a place that can raise a fisherman is a place with water at its door, which is the same fact
 * `postsOf` reads off the ground from the other side — and `boats` off the holdings, because a boat
 * is a holding and `holdings.ts` is where that noun lives.
 *
 * A livelihood may ask about holdings and holdings must never ask about earning. This is that
 * direction: it reads them and hands back two numbers, and nothing in `holdings.ts` knows this
 * function exists.
 */
export interface Coast {
  /** Whether anybody here can get down to the rocks at low water. */
  shore: boolean;
  /** Hulls the village keeps, which is what its catch is capped by. */
  boats: number;
}

/** The coast of a village, as the settlement already describes it. */
export function coastOf(
  village: { trades?: readonly string[]; holdings?: readonly { kind: string }[] },
): Coast {
  return {
    shore: (village.trades ?? []).includes('fisherman'),
    boats: (village.holdings ?? []).filter((holding) => holding.kind === 'boat').length,
  };
}

/** What a day at sea came to. */
export interface Fishing {
  /** Meals landed on the jetty. */
  meals: number;
  /** And what the next valley paid for what the village could not eat. */
  gold: number;
}

/**
 * A day of a village's boats.
 *
 * Deliberately the herd's shape and deliberately not the herd's behaviour, and the difference is
 * the whole of what makes a fishing village feel unlike a farm with a boat. Cattle *breed*: a herd
 * is capital, it grows towards its cap on its own, and what a farmer sells is the surplus over what
 * the paddocks will hold. A shoal does not belong to anybody. So there is no stock to grow and
 * nothing to run down — a boat that goes out lands a day's fish and a boat that stays in lands
 * nothing, and tomorrow is exactly the same offer.
 *
 * What that buys, economically, is a village whose income has no memory: a farm ruined by wolves
 * takes a month to come back and a fleet that misses a week has missed a week. A coast is therefore
 * the place to be when things go badly and the place to leave when they go well, which is a real
 * shape rather than a reskin.
 *
 * Capped by the lesser of hulls and hands, which is the one thing it does share with the paddocks:
 * a boat nobody can crew lands nothing, and a fisherman with no boat is a man on a jetty — he still
 * gathers his shellfish with everybody else, and that is the floor rather than this.
 */
export function aDaysFishing(boats: number, fishermen: number): Fishing {
  const out = Math.max(0, Math.min(boats, fishermen));
  const meals = out * FOOD.PER_BOAT;
  return { meals, gold: meals * FOOD.ABROAD };
}

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
  /*
   * A paddock that is already over-full does not calve.
   *
   * Without this line the herd grew by a calving and sold a calving on the same morning, and the
   * two very nearly cancelled: an over-cap herd came down by sixteen hundredths of a *percent* a
   * day, which is a half-life of over a year. The comment below claimed a fortnight and the
   * arithmetic said never, and nothing noticed because a hundred days is not long enough to see
   * it. `chore sanity` runs four hundred and fifty and found villages that had been running
   * beasts nobody was keeping for a hundred and ninety days at a stretch.
   */
  const after = herd > cap ? herd : herd + herd * LIVELIHOOD.CALVES;
  /*
   * Only what the paddocks will not hold, and never more than a day's work at the butcher.
   *
   * The first half is the whole model: a herd under its cap keeps everything and grows toward it,
   * and a herd at its cap sells exactly the calves and stays the size it is. The second half is
   * what stops a village burying three of its four farmers and the survivor waking up to a
   * hundred and sixty gold — the cap falls with the farmers, and without a rate the entire surplus
   * goes to market in one morning. The bench found it as a farmer averaging sixty-seven a day
   * against every other trade's three. A herd over its cap now comes down by a calving a day and
   * calves nothing back, which is about a month to work off a dead man's beasts and looks from the
   * road like what it is.
   */
  const sold = Math.max(0, Math.min(after - cap, after * LIVELIHOOD.CALVES));
  return {
    herd: after - sold,
    sold,
    meals: sold * LIVELIHOOD.MEALS_PER_BEAST,
    gold: sold * LIVELIHOOD.PRICE_PER_BEAST,
  };
}
