import { FOOD } from './food';
import { WATCH_WAGE, whatTheHallSpends } from './hall';
import { PROSPER } from './prosperity';
import { shareOut } from './livelihoods';
import { LIFE, type Person } from './people';

/**
 * How a village gets bigger, which until tonight it could not.
 *
 * `fillTheGaps` only ever backfilled the dead — `village.founded - village.people.length` — so
 * every village in the world was exactly the size it was laid out at, for ever. A hundred days of
 * good harvests, eleven people working, a treasury with thousands in it and nowhere for any of it
 * to go: nothing anywhere could add a person to a village. The economy could make a place rich and
 * it could not make it *grow*, which is the difference between a number going up and a world.
 *
 * The loop is four things and every one of them already existed except the joins:
 *
 *  1. **Houses are the cap.** A house holds a household, so the number of roofs is the ceiling on
 *     the number of people. That is what `founded` should have meant all along — not "the size it
 *     happened to be founded at" but "what its roofs hold" — and it is why `founded` now rises when
 *     a house is raised and on no other occasion.
 *  2. **A full village saves for another.** The hall already takes tax and already has somewhere to
 *     put it. What it lacked was a reason to spend it on anything a village *needs*, as against the
 *     things on its wish list.
 *  3. **The village raises it, and is paid for raising it.** Exactly as `whatTheHallBuys` pays for a
 *     well: the money goes back to the people who did the work, so nothing is minted and nothing is
 *     burnt.
 *  4. **It grows into it.** More people is more earners is more tax is the next house, and that is
 *     the loop turning under its own power.
 *
 * **The brake is the ground, and the ground has already spoken.** `structures.ts` lays a village
 * out by trying eighty plots and keeping whatever the footprint check will have, so a village in a
 * narrow valley comes out with three houses and one on a plain comes out with six. `roomFor` reads
 * that verdict back, which is why two villages in the same world end up with different destinies
 * without a rule anywhere saying so — and why growing is a fact about a place rather than a number
 * that only goes up.
 *
 * Its own file, and pure, for the reason `hall.ts` is: handed a purse, what has already been built
 * and who lives there, it says what changes. The register applies it, because the register is the
 * one place a coin is allowed to move.
 */

/** What a raised house is called in `Settlement.works`, where a village keeps what it has built. */
export const HOUSE = 'house';

/**
 * How many souls a house holds.
 *
 * A couple and their children, which is precisely what `foundVillage` puts under one roof: two
 * grown people and up to `LIFE.CHILDREN` of theirs. Written as that sum rather than as a four, so
 * that a world where households are bigger is a world where houses are bigger without anybody
 * having to remember that two numbers meant the same thing.
 *
 * It is the *most* a house holds rather than the average one is founded with, and that is on
 * purpose. A village that has stood for years is fuller than the morning it was laid out, and
 * nobody raises a house for a family that does not mean to fill it.
 */
const A_HOUSEFUL = 2 + LIFE.CHILDREN;

/**
 * Days a crew takes over a house.
 *
 * Six, which is what the builder who raises the player's own house takes over it — `BUILD.DAYS` in
 * `game/building.ts`. It is the same job done by people who do it for a living, so it is the same
 * six days. Written out here rather than imported because the world may not read the game, and the
 * two arriving at the same number from opposite ends of the codebase is worth more than the import
 * would have been.
 */
const A_CREW_TAKES = 6;

/**
 * What a village pays a man for a day of building, in gold.
 *
 * `WATCH_WAGE` is the only daily wage the hall has ever had, and `hall.ts` says exactly where it
 * sits: twelve gold is "a little over a farmhand's day and a little under a tradesman's", because
 * standing on a platform in the rain is not skilled work. Raising a house is: it is joinery and
 * roofing and a wall that has to stand up. So it is paid at a tradesman's rate, and what a
 * tradesman is worth over an ordinary hand is already settled in `prosperity.ts` — `TRADED` against
 * `A_DAY`, half again, which is the same ratio that decides why a village with an inn in it ends
 * the season better off than one without.
 */
const A_DAY_OF_BUILDING = WATCH_WAGE * (PROSPER.TRADED / PROSPER.A_DAY);

export const GROWTH = {
  /** How many a house holds, and so how far the cap rises the morning one is raised. */
  A_HOUSEFUL,
  /**
   * What a house costs the hall: a crew, for as long as a house takes, at a builder's day-rate.
   *
   * Four hundred and thirty-two gold, and the number is worth stopping on because nothing about it
   * was aimed at. What a man charges the *player* to raise him a house, arrived at years ago on
   * entirely different reasoning in `game/building.ts`, is four hundred and twenty. Two price
   * systems that cannot see each other — one a shop's sticker, one a wage bill — agreeing to within
   * three per cent is the strongest evidence available that either of them is right.
   *
   * It is cheaper than the cheapest thing on the hall's own wish list, and that is deliberate rather
   * than an oversight. `WORKS` begins at nine hundred for a well on the square, which is dug, lined,
   * winched and roofed for everybody; a house is timber and thatch raised for one family by the
   * neighbours who will want the same done for them. More to the point, a roof has to be reachable
   * before a luxury is, or the loop never turns at all: a village that must find nine hundred gold
   * before it can house anybody would dig its well, put a storey on every roof and build a bath
   * house while its people were still sleeping four to a room.
   */
  A_HOUSE: A_HOUSEFUL * A_CREW_TAKES * A_DAY_OF_BUILDING,
  /**
   * How full the cellar has to be before a village adds mouths to feed, as a share of a full one.
   *
   * Half. A full cellar is a week of dinners a head, so half of one measured against the size the
   * village is *about to be* is three or four days in hand — enough that a bad week is survivable
   * and not so much that a village can never reach it. The number that matters is not its exact
   * value but that it is measured against the larger village: a place feeding itself comfortably
   * today can still be a place that starves the morning four more people move in.
   */
  IN_HAND: 0.5,
  /**
   * How much ground a village has, as a multiple of what it was laid out on.
   *
   * Twice, because growing means building further out along the same band of land the first houses
   * stand in, and a village that has doubled its footprint is a village that has become a town —
   * which is as far as this should carry anybody before somebody asks the ground again in earnest.
   */
  ROOM: 2,
} as const;

/**
 * How many houses a village's ground will take, all told.
 *
 * Taken from the count it was laid out with, which is the ground's own verdict and not a number
 * anybody chose — see the note at the top of this file. It is deliberately the honest cheap answer
 * rather than the true one: the true one is the same footprint check the player's house passes,
 * asked of an actual plot at the moment a house goes up, and it arrives with the `Commission` that
 * raises the building. When it does, this function is the only thing that has to change.
 */
export function roomFor(laidOut: number): number {
  return laidOut * GROWTH.ROOM;
}

/**
 * How many houses are standing: the ones laid out at the founding and the ones since raised.
 *
 * Counted out of `works` rather than kept as a number of its own, and that is load-bearing. A
 * village is founded on day one and lived forward to today every time anybody learns something new
 * about its past, so anything the register *stores* about a grown village is a thing the re-living
 * has to reproduce exactly. `works` is already replayed that way, and the house that is in it is
 * the same house on every machine.
 */
export function housesStanding(laidOut: number, built: readonly string[]): number {
  return laidOut + built.filter((work) => work === HOUSE).length;
}

/** A house raised: what it cost, who was paid to raise it, and how many more the village can hold. */
export interface Raised {
  costs: number;
  /** The village builds with its own hands, so the money goes back to the people who did it. */
  wages: Map<string, number>;
  /** How many more souls there is room for now that it stands. */
  holdsMore: number;
}

/**
 * The house a village raises this morning, or nothing.
 *
 * Four things have to be true at once, and each of them is a different sort of reason to say no.
 *
 * A village with a spare bed does not build: it fills the bed. That is the whole of what makes
 * this a growth loop rather than a building spree — houses are raised because there is nobody left
 * to put anywhere, which means the pace is set by how fast the village fills and not by how rich
 * it is.
 *
 * A village with no ground left does not build either, however much it has saved, and that is the
 * one that makes two villages in one world different from each other.
 *
 * It keeps back the watchman's day. A village that spent its last coin on a roof and then left its
 * tower empty would have done things in the wrong order — `hall.ts` makes the same argument about
 * why a wage is paid before a purchase, and this is that argument reaching one step further back.
 *
 * And a village with nobody who holds a trade raises nothing, for the reason `whatTheHallBuys`
 * gives: a village of children and the very old does not put up a house by wishing.
 */
export function whatTheVillageBuilds(
  purse: number, built: readonly string[], laidOut: number, holds: number, people: readonly Person[],
  larder = Infinity,
): Raised | null {
  if (people.length < holds) return null;
  /*
   * And a village does not put up a roof for mouths it cannot feed.
   *
   * Found by the audit within minutes of this loop being wired in: villages grew, the extra people
   * ate, the farmers did not multiply to match, and four villages in a hundred days starved
   * themselves out of existence entirely — which the books then reported as coin buried with the
   * dead, because there was nobody left in the village to inherit it.
   *
   * The rule that fixes it is the one a village would use. A full cellar is `FOOD.KEEPS_DAYS` days
   * of dinners per head, so asking for half of that before building is asking for a few days in
   * hand at the size it is *about to be* rather than the size it is. A village living hand to mouth
   * stays the size it is and spends its money on the well instead, which is exactly what a village
   * living hand to mouth should do.
   */
  if (larder < (people.length + GROWTH.A_HOUSEFUL) * FOOD.KEEPS_DAYS * GROWTH.IN_HAND) return null;
  if (housesStanding(laidOut, built) >= roomFor(laidOut)) return null;
  if (purse < GROWTH.A_HOUSE + WATCH_WAGE) return null;
  const working = people.filter((person) => person.trade !== '');
  if (working.length === 0) return null;
  return {
    costs: GROWTH.A_HOUSE,
    // shared among whoever holds a trade, which is the rule every other village-wide payment in
    // this world uses: `shareOut` leaves the remainder on the last of them, so the shares come to
    // what was spent and no coin is invented on the way
    wages: shareOut(GROWTH.A_HOUSE, new Map(working.map((person) => [person.id, 1]))),
    holdsMore: GROWTH.A_HOUSEFUL,
  };
}

/**
 * Everything a village spends this morning, in one answer.
 *
 * The same shape and the same reasoning as `whatTheHallSpends`, which it wraps rather than
 * replaces: one purse, several claims on it, and an order they have to happen in. The house comes
 * first because a roof is a need and the wish list is a wish — a village houses its people before
 * it pleases them — and the watchman is not put at risk by that, because the house will not be
 * raised unless his day is still in the purse afterwards.
 *
 * Handed back as one map of who gets what, for the reason the hall's is: a coin leaving the
 * treasury has to arrive in somebody's purse in the same act, and two calls would be two chances
 * for one of them to be forgotten.
 */
export function whatTheVillageSpends(
  purse: number, built: readonly string[], laidOut: number, holds: number, people: readonly Person[],
  larder = Infinity,
): { wages: Map<string, number>; spent: number; works: string[]; holdsMore: number; watch: string } {
  const raised = whatTheVillageBuilds(purse, built, laidOut, holds, people, larder);
  const wages = new Map<string, number>(raised?.wages ?? []);
  const works: string[] = raised ? [HOUSE] : [];
  const onTheHouse = raised?.costs ?? 0;

  // one building a morning, which is the hall's own rule and worth keeping: a village that put a
  // house up and dug a well between breakfast and noon is a village nobody watched change. So on a
  // morning a house goes up, the hall is handed the watchman's wage and not a coin more — he is
  // still paid, because a wage is owed, and there is nothing left over to buy anything with.
  const left = raised ? Math.min(purse - onTheHouse, WATCH_WAGE) : purse;
  const hall = whatTheHallSpends(Math.round(left * 100) / 100, built, people);
  for (const [id, much] of hall.wages) {
    wages.set(id, Math.round(((wages.get(id) ?? 0) + much) * 100) / 100);
  }
  if (hall.work) works.push(hall.work);
  return {
    wages,
    spent: Math.round((onTheHouse + hall.spent) * 100) / 100,
    works,
    holdsMore: raised?.holdsMore ?? 0,
    watch: hall.watch,
  };
}
