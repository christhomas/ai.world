import { WATCH_WAGE, WORKS, whatTheHallSpends } from './hall';
import {
  A_CREW_TAKES, A_DAY_OF_BUILDING, whatTheHallFounds, whoFoundsAnother, whoIsPaidToRaiseIt,
} from './founding';
import { THE_HALL, type Holding } from './holdings';
import { atLeast, rankOfRoofs, type Rank } from './rank';
import {
  STANDARD, biggestRoofAmong, familiesWantingRoom, isARoof, oneSizeUp, workOf, type Roof,
} from './roofs';
import { type Person } from './people';

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
 * **What a roof is** belongs next door in `roofs.ts`, and so does who lives under one. This file
 * was written when every house in the world held four people, which made the ceiling a number
 * wearing a house's name; a roof has a size now, a family is limited by the one it lives under, and
 * the question this file asks — is anybody short of room, and what would relieve them — is answered
 * over there out of who is alive rather than out of arithmetic. The larder went with it: the gate
 * that used to sit in front of the building, asking whether the cellar was half full, is a
 * condition on having children now, and what is left here is that a village builds for a family
 * that has run out of room and would have another child if it had some.
 *
 * Its own file, and pure, for the reason `hall.ts` is: handed a purse, what has already been built
 * and who lives there, it says what changes. The register applies it, because the register is the
 * one place a coin is allowed to move.
 */

/**
 * What a roof of a given size costs the hall.
 *
 * By the room in it, because that is what the crew is being paid for: twice the house is twice the
 * timber, twice the joinery and twice the days, so it is twice the wage bill. A hundred and eight
 * gold a head, whatever size it comes out — which is why a village that builds small and a village
 * that builds big get the same room for the same money, and the only thing a size changes is how
 * often the village has to do it.
 */
export function costOfARoof(roof: Roof): number {
  return roof.holds * A_CREW_TAKES * A_DAY_OF_BUILDING;
}

export const GROWTH = {
  /**
   * What an ordinary house costs the hall: a crew, for as long as a house takes, at a builder's
   * day-rate.
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
  A_HOUSE: STANDARD.holds * A_CREW_TAKES * A_DAY_OF_BUILDING,
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
  return laidOut + built.filter(isARoof).length;
}

/** A house raised: what it cost, who was paid to raise it, and how many more the village can hold. */
export interface Raised {
  costs: number;
  /** The village builds with its own hands, so the money goes back to the people who did it. */
  wages: Map<string, number>;
  /** How many more souls there is room for now that it stands: the size of what went up. */
  holdsMore: number;
  /** And what size that was, which is what goes into `works`. */
  roof: Roof;
}

/**
 * The house a village raises this morning, and what size it comes out, or nothing.
 *
 * Four things have to be true at once, and each of them is a different sort of reason to say no.
 *
 * A village with a spare bed does not build: it fills the bed. That is what makes this a growth
 * loop rather than a building spree — a roof goes up because there is nobody left to put anywhere,
 * so the pace is set by how fast a village fills and not by how rich it is.
 *
 * **Somebody has to want it.** A village raises a roof for a family that has run out of room under
 * its own and would have another child if it had some — see `familiesWantingRoom`. That is where
 * the larder now does its work: a family going hungry is not asking for a nursery, and a village
 * whose store is empty has no such family anywhere in it, so the money stays in the hall on exactly
 * the mornings it ought to. It is the same rule the births run on, asked from the other side, which
 * is better than the gate it replaces — a flat "is the cellar half full" is a thing a ledger checks
 * and this is a thing somebody living there could tell you.
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
 *
 * **What size it comes out** is one rung up from the best roof anybody who has run out is living
 * under. The point of building is to give a growing family more room than it had, so a village
 * cannot leap from houses to great houses — it climbs, and a skyline is therefore a history rather
 * than a purchase.
 *
 * It will not put up something smaller instead when it cannot afford that, and the argument is
 * `nextWork`'s own: the hall buys the cheapest thing it has not got and *saves for it* rather than
 * skipping to something it can reach today, because a list you are allowed to skip about in is not
 * a ladder. A village that wanted a longhouse and put up a cottage would have done exactly that.
 * So a poor village takes longer to raise the next roof and gets the same roof in the end, which is
 * also why being poor costs a village its pace and never its shape.
 */
export function whatTheVillageBuilds(
  purse: number, built: readonly string[], laidOut: number, holds: number, people: readonly Person[],
  larder = Infinity,
): Raised | null {
  if (people.length < holds) return null;
  const wanting = familiesWantingRoom(people, laidOut, built, larder);
  if (wanting.length === 0) return null;
  if (housesStanding(laidOut, built) >= roomFor(laidOut)) return null;
  const roof = oneSizeUp(biggestRoofAmong(wanting) ?? STANDARD);
  const costs = costOfARoof(roof);
  if (purse < costs + WATCH_WAGE) return null;
  const wages = whoIsPaidToRaiseIt(people, costs);
  if (!wages) return null;
  return {
    costs,
    // paid to the builders where a village has any and to everybody who holds a trade where it has
    // none, which is `whoIsPaidToRaiseIt`'s rule — a shed and a roof are the same crew, so the rule
    // lives in one place and both call it
    wages,
    holdsMore: roof.holds,
    roof,
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
 *
 * **A villager's purchase is in here too, and that is worth defending.** This is the hall's morning
 * and a farmer buying a second farm is not the hall's business — but it is the *village's* morning,
 * and what the two purchases have in common is exactly what item 47 says: the same commission with a
 * different customer. Both hire the same crew, both pay it out of a purse, and both have to be one
 * answer for the reason the paragraph above gives. A second call would be a second chance to move a
 * coin out of somewhere and not into anywhere. What separates them is `spent`, which is the hall's
 * money and only ever the hall's: a farmer's four hundred and eighty-six is a debit in `wages`
 * alongside the credits it becomes, and the treasury never sees it.
 */
export function whatTheVillageSpends(
  purse: number, built: readonly string[], laidOut: number, holds: number, people: readonly Person[],
  larder = Infinity, holdings: readonly Holding[] = [], herd = 0, day = 0,
): {
  wages: Map<string, number>; spent: number; works: string[]; holdsMore: number; watch: string;
  founded: Holding[];
} {
  const raised = whatTheVillageBuilds(purse, built, laidOut, holds, people, larder);
  const wages = new Map<string, number>(raised?.wages ?? []);
  const works: string[] = raised ? [workOf(raised.roof)] : [];
  const onTheHouse = raised?.costs ?? 0;

  // one building a morning, which is the hall's own rule and worth keeping: a village that put a
  // house up and dug a well between breakfast and noon is a village nobody watched change. So on a
  // morning a house goes up, the hall is handed the watchman's wage and not a coin more — he is
  // still paid, because a wage is owed, and there is nothing left over to buy anything with.
  const left = raised ? Math.min(purse - onTheHouse, WATCH_WAGE) : purse;
  // what the village has grown into decides what its hall may buy at all: see `rank.ts`
  const hall = whatTheHallSpends(Math.round(left * 100) / 100, built, people, rankOfVillage(laidOut, built));
  for (const [id, much] of hall.wages) {
    wages.set(id, Math.round(((wages.get(id) ?? 0) + much) * 100) / 100);
  }
  if (hall.work) works.push(hall.work);

  /*
   * And whoever founds a holding this morning, which is at most one person and usually nobody.
   *
   * The hall goes first and out of what is left after everything above it, because a farm is the
   * last thing on a village's list rather than the first: a roof is a need, the wish list is what
   * the village decided to want, and buying a farm back is what it does with the money it still has
   * afterwards. `whatTheHallFounds` keeps clear of the next thing on the wish list on top of that,
   * so a farm can never be the reason a village does not get its bath house.
   *
   * A villager may found one on a morning the hall does not, and never on the same morning — one
   * building a morning is the rule this whole file runs on, and a village where the hall and a
   * farmer both raised a shed before noon is a village nobody watched change.
   */
  const name = people[0]?.village ?? '';
  const over = Math.round((purse - onTheHouse - hall.spent) * 100) / 100;
  const saving = whatItIsSavingFor(built, rankOfVillage(laidOut, built));
  const founding = name === '' ? null
    : whatTheHallFounds(name, over, saving, people, holdings, built, herd, day)
      ?? whoFoundsAnother(name, people, holdings, built, day);
  if (founding) for (const [id, much] of founding.wages) {
    wages.set(id, Math.round(((wages.get(id) ?? 0) + much) * 100) / 100);
  }
  // the buyer's own side of it, folded into the same entry so one person is one line: a farmer who
  // is on the crew he is paying gets his slice back in the same number, which is what owning some
  // of the work means
  if (founding && founding.payer !== THE_HALL) {
    wages.set(founding.payer, Math.round(((wages.get(founding.payer) ?? 0) - founding.costs) * 100) / 100);
  }
  const onTheFarm = founding && founding.payer === THE_HALL ? founding.costs : 0;

  return {
    wages,
    spent: Math.round((onTheHouse + hall.spent + onTheFarm) * 100) / 100,
    works,
    holdsMore: raised?.holdsMore ?? 0,
    watch: hall.watch,
    founded: founding ? [founding.holding] : [],
  };
}

/**
 * What the hall is still putting money by for, whether or not it can reach it yet.
 *
 * `nextWork` answers a different question — what the hall can buy *today* — and answers nothing
 * where the purse is short, which is exactly the case this has to know about: a village three
 * hundred gold into a nine hundred gold well is a village with nothing spare, and one that read its
 * own savings as nought would have spent them on a farm and started the well again. Same list, same
 * order, same rule about a rank a place has not grown into being skipped rather than saved for.
 */
function whatItIsSavingFor(built: readonly string[], rank: Rank): number {
  const next = WORKS.find(
    (work) => !built.includes(work.id) && (!work.needs || atLeast(rank, work.needs)),
  );
  return next?.costs ?? 0;
}

/**
 * What a village has grown into, counted off what is standing in it.
 *
 * Here rather than in `rank.ts` because counting a village's roofs is this file's job and what the
 * count *means* is that one's — and the two must not ask each other, which is what a module cycle
 * is. See the note on `untilTheNextRank`.
 */
export function rankOfVillage(laidOut: number, built: readonly string[]): Rank {
  return rankOfRoofs(housesStanding(laidOut, built));
}