import { costOfAStable, timberForAStable } from './growth';
import { BYRE, beastsAt, oneSizeUp, stableAt, type Stable } from './stables';

/**
 * A farmer paying a builder for a bigger stable, which is the first money in this game that buys
 * capacity rather than a thing.
 *
 * The ladder landed on the 13th — byre, stable, barn, steading — with its prices beside it, and
 * nothing ever called them. `costOfAStable` and `timberForAStable` sat in `growth.ts`, exported,
 * with seven assertions about what they cost and how the rungs compare, reachable from the test
 * file and from nowhere else. So every rung existed, every bill existed, and no farmer in any world
 * could climb one. It is the eighth feature found that way, and the pattern is always the same: the
 * parts are green and the join was never written.
 *
 * ## Why it is the farmer's decision and not the village's
 *
 * The hall buys what the whole place uses — a well, a tower, a bath house — out of a treasury that
 * is nobody's. A stable is one man's rails on one man's farm, paid for out of the purse he filled
 * selling what the farm produced. Putting it on the hall would have made the village buy a private
 * improvement for whichever farmer happened to be nearest the top of a list, and there is no
 * sentence anybody could write on that page that would be true.
 *
 * It also gives the builder a third customer. He has had the player and the village; a farmer is
 * the first one who buys from him for a reason of his own rather than because a roof fell in.
 *
 * ## The two prices, and why neither stands in for the other
 *
 * Gold says whether this farmer can afford it. Timber says whether the village *can build it at
 * all* — and that is the whole reason a stable is priced in wood. Gold is fungible and a rich
 * farmer will always find four hundred of it; a village on a bare rock with no logger in it should
 * not be able to double its herd by being wealthy. A place with a wood behind it climbs the ladder
 * and a place without one does not, whatever its farms earn, which is the same sentence the houses
 * already say and the reason the material exists.
 */

/**
 * What a farmer keeps back, as a multiple of the bill.
 *
 * Half again, and the argument is `PROSPER.KEEPS_BACK`'s: a man who spent his last coin on rails
 * has bought a bigger shed and nothing to put in it, and a farm that cannot buy a beast to fill the
 * room it just paid for has made itself poorer in exchange for a number going up.
 */
const KEEPS_BACK = 1.5;

/** One farm, and whoever is working it this morning. */
export interface Farming {
  holding: string;
  worker: string;
}

export interface ABiggerStable {
  holding: string;
  stable: Stable;
  gold: number;
  timber: number;
}

/**
 * Who, if anybody, builds one today.
 *
 * One a day at most, for the reason the hall buys one thing a day: a village that rebuilt all four
 * of its farms on one morning is a village nobody watched change. The fullest farm goes first,
 * because the reason to build is that the rails are full and the fullest is the most full.
 *
 * Being *full* is asked of the village rather than of the farm, and that is a compromise worth
 * naming: the herd is one number in the settlement and is shared out by `theHerdAcross`, so what is
 * known here is whether the village's beasts have reached the room its farms hold between them. A
 * village at its cap has at least one farm that cannot take another calf, and the farm with the
 * least room is the one it is soonest true of.
 */
export function whichFarmerBuilds(o: {
  farms: readonly Farming[];
  /** What the man working this farm holds, which is what he can spend. */
  purseOf: (worker: string) => number;
  /** The village's `works`, which is where every stable it has ever built is written down. */
  built: readonly string[];
  /** Beasts the village is keeping, and the room its farms hold between them. */
  herd: number;
  room: number;
  /** Lengths in the village yard. See `game/timber.ts`. */
  timber: number;
}): ABiggerStable | null {
  // the rails have to be full before anybody widens them: a half-empty byre is a farmer with
  // somewhere to put the next calf already
  if (o.room <= 0 || o.herd < o.room) return null;

  // the fullest first, which with one number for the whole herd means the one with least room
  const order = [...o.farms].sort((a, b) => beastsAt(o.built, a.holding) - beastsAt(o.built, b.holding));
  for (const farm of order) {
    const standing = stableAt(o.built, farm.holding);
    const wanted = oneSizeUp(standing);
    if (wanted.beasts <= standing.beasts) continue;        // already at the top of the ladder
    const gold = costOfAStable(wanted);
    const wood = timberForAStable(wanted);
    if (o.timber < wood) continue;                         // the village cannot build it at all
    if (o.purseOf(farm.worker) <= gold * KEEPS_BACK) continue;
    return { holding: farm.holding, stable: wanted, gold, timber: wood };
  }
  return null;
}

/** The byre every farm starts with, re-exported so a caller need not know two files to ask. */
export { BYRE };
