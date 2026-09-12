import { WATCH_WAGE } from './hall';
import {
  BEASTS_PER_FARM, THE_HALL, canDo, foundAHolding, possibleHere, sortOf, vacancies,
  type Holding, type Sort,
} from './holdings';
import { LIVELIHOOD, shareOut } from './livelihoods';
import { PROSPER } from './prosperity';
import { STANDARD } from './roofs';
import type { Person } from './people';

/**
 * What it costs to found a holding, and who is founding one this morning.
 *
 * `holdings.ts` gave a farm an identity, an owner and a worker, and founding one was free — which
 * was true of the farms every village starts with, because a farmer has always simply had his
 * fields, and false of every farm after that. A village could therefore never have more farms than
 * farmers, so it could never have more beasts than its farmers happened to be; and a treasury with
 * fifteen thousand gold in it across the country could do nothing whatever about a valley that had
 * buried its last farming family.
 *
 * So there is a price, and two quite different people who can pay it. They are the same act with a
 * different signatory, which is why they are in one file:
 *
 * - **A villager forms another of his own.** A farmer who has earned enough buys the beasts, raises
 *   the shed and has somebody put in it. That is the engine the economy was missing: what a trade
 *   earns does not only feed its holder, it buys the next one of itself. Which trades can do it
 *   follows from `leavesAHolding` and needs no second list — a doctor cannot, because there is no
 *   second surgery to buy, so a village gets more doctors only by enrolment and never by
 *   multiplication.
 * - **The hall buys one back.** The same purchase with the village as the customer. A village that
 *   has lost its farms to a bad decade cannot wait for a rich farmer to appear, and this is the one
 *   thing a treasury can do that no purse in the place can: it can own a farm and hire a pair of
 *   arms to work it, and go on owning it through every funeral afterwards.
 *
 * ## Nothing here moves a coin, and nothing here is stored
 *
 * Every function is pure in what it is handed and says what *would* change. `growth.ts` folds the
 * answer into the morning's spending and the register applies it, because the register is the one
 * place a coin is allowed to move — the same bargain `hall.ts` and `growth.ts` already keep.
 *
 * And it points one way. It may ask what a holding is, what a beast costs and what a man charges
 * for a day's building; nothing it asks knows this file exists. That is why the two building
 * numbers below live here now rather than next door in `growth.ts`: a roof over a family and a shed
 * over six cows are the same crew doing the same work for the same days, and the file that prices
 * *founding* is the one that has to be underneath both.
 */

/**
 * Days a crew takes over a building.
 *
 * Six, which is what the builder who raises the player's own house takes over it — `BUILD.DAYS` in
 * `game/building.ts`. It is the same job done by people who do it for a living, so it is the same
 * six days. Written out here rather than imported because the world may not read the game, and the
 * two arriving at the same number from opposite ends of the codebase is worth more than the import
 * would have been.
 */
export const A_CREW_TAKES = 6;

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
export const A_DAY_OF_BUILDING = WATCH_WAGE * (PROSPER.TRADED / PROSPER.A_DAY);

/**
 * What the stock inside a holding costs to buy, by the sort of holding it is.
 *
 * A farm is beasts, and what a beast costs is the only price this world has ever put on one:
 * `PRICE_PER_BEAST`, which is what the next valley pays for the surplus. Buying a paddock's worth is
 * the same transaction run the other way, from a neighbour who has more than his own rails will
 * hold — so the money stays in the country, which is what stops a farm being a hole gold falls into.
 *
 * A yard and a boat are nought, and neither is an oversight. A builder's yard holds timber, and
 * timber is already an item a player can cut, carry and sell — `game/timber.ts` counts it per
 * village, and a second price for the same stuff would put two kinds of wood in one game. What a
 * hull costs belongs to whoever builds the first one; until then a village's boats are the ones its
 * fishermen brought, and there is nothing here to buy.
 */
const STOCK: Readonly<Record<string, number>> = {
  farm: BEASTS_PER_FARM * LIVELIHOOD.PRICE_PER_BEAST,
  yard: 0,
  boat: 0,
};

/**
 * What founding one of these costs, all in.
 *
 * Two halves, and both are read off prices that already exist rather than chosen: the stock that
 * goes inside it, and the building that goes over it. The building is priced the way every building
 * in this world is priced — a crew, for as long as a crew takes, at a builder's day — and at the
 * ordinary size, because a shed is the ordinary thing a village puts up and `STANDARD` is what
 * "ordinary" means here.
 *
 * Four hundred and eighty-six gold for a farm, of which fifty-four is the beasts. It is worth
 * saying what that number is against, because a price nobody can reach is a rule that never fires:
 * a purse in this world tops out at four thousand, the richest villager in a four-hundred-and-fifty
 * day run holds something like three and a half, and a hall carries a few hundred to a thousand. So
 * a farm is a thing a prosperous man buys once in a long life and a thing a hall buys out of a good
 * decade — which is the right frequency for something that changes what a village *is*.
 *
 * It is also, deliberately, a shade over what a house costs the hall. Housing a family and housing
 * six cows are the same crew for the same days; the beasts are the difference, and a farm ought to
 * cost a little more than a roof because it comes with something alive in it.
 */
export function costOfFounding(sort: Sort): number {
  const stock = STOCK[sort.kind] ?? 0;
  return Math.round((stock + STANDARD.holds * A_CREW_TAKES * A_DAY_OF_BUILDING) * 100) / 100;
}

/** A holding somebody has just paid for: what it is, what it cost, whose money, and whose hands. */
export interface Founded {
  /** The holding itself, named and owned, ready to be put on the village's books. */
  holding: Holding;
  costs: number;
  /** Whose purse it comes out of: a villager's id, or `THE_HALL`. */
  payer: string;
  /** And into whose, because the village raises it with its own hands. */
  wages: Map<string, number>;
}

/**
 * Who is paid for putting a building up, which is the village itself.
 *
 * Its builders where a village has any and everybody who holds a trade where it has none, which is
 * `whatTheVillageBuilds`'s own rule — it is exported from here and used by both, because a shed and
 * a roof are the same crew and a second copy of the rule is a second chance to change one of them.
 * `shareOut` leaves the remainder on the last of them, so the shares come to exactly what was spent
 * and no coin is invented on the way.
 *
 * Nothing at all where nobody holds a trade, and the caller must read that as "then it cannot be
 * built": a village of children and the very old does not raise a shed by wishing, however much
 * anybody in it has saved.
 */
export function whoIsPaidToRaiseIt(
  people: readonly Person[], costs: number,
): Map<string, number> | null {
  const working = people.filter((person) => person.trade !== '');
  if (working.length === 0) return null;
  const builders = working.filter((person) => canDo(person, 'can_build'));
  const crew = builders.length > 0 ? builders : working;
  return shareOut(costs, new Map(crew.map((person) => [person.id, 1])));
}

/**
 * The villager who forms another of his own this morning, or nobody.
 *
 * **Already working one is the whole condition on who may.** A man's first holding is free, because
 * every farm any village has ever had came with the farmer who walked out into the field; this is
 * about the second, and what it takes is that the first one exists. That also settles which trades
 * can do it without a list anywhere saying so: a doctor works no holding, so a doctor never appears
 * here, and a village fills up with farms and still has exactly one surgery.
 *
 * **And having enough left afterwards.** `KEEPS_BACK` is a week of dinners less tonight's, and it is
 * the reserve every other purchase in this economy keeps: a man who bought a farm and then could not
 * eat would have done the one thing nobody in this world does. Note what that reserve is *not* — a
 * threshold anybody reaches by living carefully. Four hundred and eighty-six gold is most of a
 * lifetime's saving on top of it, so this fires for the handful of people a long peace makes rich,
 * which is exactly who ought to be buying farms.
 *
 * **The richest of them, and one a morning.** One because that is the hall's own rule and it is
 * right for the same reason — a village where two men bought farms between breakfast and noon is a
 * village nobody watched change. The richest because that is who can, and because picking the
 * richest is a rule a person could check from the roll rather than a roll of the dice; ties go to
 * the earlier id, so two equally rich men do not make the answer depend on the order of a list.
 */
export function whoFoundsAnother(
  name: string, people: readonly Person[], holdings: readonly Holding[],
  works: readonly string[], day: number,
): Founded | null {
  let best: { person: Person; sort: Sort; costs: number } | null = null;
  for (const person of people) {
    const already = holdings.find((holding) => holding.worker === person.id);
    if (!already) continue;
    const sort = sortOf(already.kind);
    if (!sort || !possibleHere(sort, works)) continue;
    // nor while one of that sort already stands empty, which is the hall's rule below and is here
    // for the same reason and one more: without it the richest man in a long-lived village buys a
    // shed every morning until his purse is gone, and a village of empty sheds is not a farm town
    if (vacancies(holdings.filter((one) => one.kind === sort.kind)).length > 0) continue;
    const costs = costOfFounding(sort);
    if (person.purse - costs < PROSPER.KEEPS_BACK) continue;
    const richer = best === null
      || person.purse > best.person.purse
      || (person.purse === best.person.purse && person.id < best.person.id);
    if (richer) best = { person, sort, costs };
  }
  if (!best) return null;
  const wages = whoIsPaidToRaiseIt(people, best.costs);
  if (!wages) return null;
  // founded with nobody standing in it, because a man cannot be in two fields at once. "Buy the
  // beasts, raise the shed, and put somebody in it" is three acts and only the first two are his:
  // who ends up in it is the village's answer the same evening, and may be nobody for a while
  const holding = foundAHolding(name, best.sort, best.person, holdings, day);
  return { holding: { ...holding, worker: '' }, costs: best.costs, payer: best.person.id, wages };
}

/** The one holding a village can be visibly short of, and the only one the hall buys. See below. */
const FARM = 'farm';

/**
 * Whether the hall buys a farm back this morning.
 *
 * Farms only, and that is a decision rather than a gap. A herd is the one thing a village owns that
 * it can be *short* of in a way a building fixes: cattle breed up to what the paddocks hold and stop,
 * so a village at its cap with money in the hall is a village whose only way of having more is
 * another farm. Nothing else on the list is like that — a builder's yard is short of timber and not
 * of yards, and what a hull costs belongs to whoever builds the first one. When one of them is, this
 * is where it goes.
 *
 * Three conditions, and each of them is a different sort of reason to wait.
 *
 * **Not while one of its own stands empty.** A second shed with nobody in it is not a farm, it is a
 * shed. This is also what stops a village with no farmers at all buying a farm every morning until
 * the treasury is gone: it buys exactly one, and then it has a vacancy and something for the mayor
 * to enrol into, which is the whole of what item 47 asks for.
 *
 * **Not while the paddocks it has are not full.** What another farm buys is room for beasts, and a
 * village whose herd is still growing into the rails it has does not need more rails. A village that
 * has *no* farm passes this trivially — nought beasts in nought paddocks is full — which is right,
 * and is the case the treasury exists for.
 *
 * **And it is not an investment, which is the thing to be clear about before anybody works out the
 * payback.** A farm worked by a hired hand clears the hall a few hundredths a day, so counted as a
 * purchase of income it is a terrible one and always will be. It is not one. `chore sanity` has been
 * reporting the same complaint for weeks — forty-five thousand gold sitting in halls that nothing
 * can spend from, a fifth of every coin in the world, and "a hall is the one place a coin goes and
 * does not come back". Four hundred and eighty-six of that going out to the men who raise the shed,
 * in exchange for a farm the village owns for ever, is the treasury doing the one thing a treasury
 * is for. The return is the farm and the circulation, not the margin.
 *
 * **And only out of what it holds above what it is saving for.** `saving` is the next thing on the
 * hall's wish list, and keeping clear of it is what stops a farm quietly becoming the reason a
 * village never gets its bath house. A village buys a farm out of its surplus or it does not buy one
 * — the same argument `whatTheVillageBuilds` makes about keeping back the watchman's day, reaching
 * one step further.
 */
export function whatTheHallFounds(
  name: string, purse: number, saving: number, people: readonly Person[],
  holdings: readonly Holding[], works: readonly string[], herd: number, day: number,
): Founded | null {
  const sort = sortOf(FARM);
  if (!sort || !possibleHere(sort, works)) return null;
  const farms = holdings.filter((holding) => holding.kind === FARM);
  if (vacancies(farms).length > 0) return null;
  const manned = farms.filter((holding) => holding.worker !== '').length;
  if (herd < manned * BEASTS_PER_FARM) return null;
  const costs = costOfFounding(sort);
  if (purse - saving < costs + WATCH_WAGE) return null;
  const wages = whoIsPaidToRaiseIt(people, costs);
  if (!wages) return null;
  return { holding: foundAHolding(name, sort, null, holdings, day), costs, payer: THE_HALL, wages };
}
