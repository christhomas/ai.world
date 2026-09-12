/**
 * How many beasts a farm can keep, which until now was one number for every farm in the world.
 *
 * `BEASTS_PER_FARM` is six, in `holdings.ts`, and it is six whether the farm has stood for a day or
 * a century and whether its farmer has spent a season's takings on it or nothing at all. That is the
 * thing item 33 is about: a farmer pays a builder for a bigger stable and the farm holds more for
 * it, which is **the first money in this game that buys capacity rather than a thing**. Everything
 * else gold has ever bought is an object — a house, a boat, a pool — and this buys a larger number.
 *
 * ## The shape is `roofs.ts`'s, deliberately and almost exactly
 *
 * A family that has run out of room under its roof pays for a bigger roof, one rung at a time, at a
 * price set by the room it gains; a farm that has run out of room in its stable does the same. So
 * this is that file with the nouns changed, and where it differs it says so:
 *
 *  - **A ladder, smallest first**, each rung holding the one below plus a fixed step, so a world
 *    where farms are bigger is a world where every size of stable is bigger and no two numbers mean
 *    the same thing. `ROOFS` builds its ladder off `LIFE.CHILDREN`; this builds its off
 *    `BEASTS_PER_FARM`, which is the byre every farm in the country already has.
 *  - **The size is written into `Settlement.works`**, which is the ledger of everything a village
 *    has ever paid for and is already replayed from the founding on every machine. That is what
 *    makes a stable survive a village being re-lived, and it is why this needs no new field on a
 *    holding and no new thing for the register to store. `roofOfWork` and `stableOfWork` are the
 *    same trick.
 *  - **One rung at a time.** `oneSizeUp` is `roofs.ts`'s word and its argument is the one that
 *    matters here too: a list you may skip about in is not a ladder, so a farm that wanted a barn
 *    and could afford a stable builds the stable and gets the barn later. A skyline is a history.
 *
 * Where it differs from a roof, and why:
 *
 *  - A roof belongs to a *village* and there is one ledger of them; a stable belongs to a *farm*,
 *    and a village may have several. So the work entry carries the holding it was built for as well
 *    as its size — `stable:barn:Ashford-farm-2` — and `beastsAt` is asked about one farm rather than
 *    summed over all of them. That is the whole of the difference in the encoding.
 *  - A roof costs only money. A stable costs money **and timber**, and that is not decoration: a
 *    stable is posts, beams, a roof and a hard standing, and it is the most straightforwardly
 *    wooden thing anybody in this world builds. `game/timber.ts` landed the material tonight, and a
 *    building that wanted gold alone would be the one building in the catalogue that could be
 *    conjured out of a purse in a village with no wood behind it.
 *
 * ## What this file does not do, and who should
 *
 * It does not spend anybody's money and it does not raise anything. It is the table and the
 * arithmetic: what the sizes are, what each holds, what each costs, and how to read one back out of
 * a village's ledger. Who pays and when is the register's, exactly as `costOfARoof` is answered
 * here and spent in `growth.ts` — and *whose* farm it is belongs to `holdings.ts`, which minted the
 * noun. This file never imports it: a stable is keyed by a holding's id as an opaque string, so the
 * two can be joined without either having to know the other exists.
 */

import { costOfARoof } from './growth';
import { STANDARD } from './roofs';

/**
 * The beasts a farm keeps with no stable but the one it was founded with.
 *
 * The same six `holdings.ts` calls `BEASTS_PER_FARM`, written out here rather than imported, and
 * the duplication is on purpose in the way `growth.ts` duplicates `BUILD.DAYS`: the two files must
 * point one way. A farm's capacity is a fact about its buildings and a holding is a fact about its
 * owner, so buildings may be asked about holdings and holdings must never be asked about buildings.
 * `rank.ts` and `growth.ts` asked each other exactly this once and the answer at module-init time
 * was `NaN`, which every village in the world then paid its builders. A test holds the two equal.
 */
const A_BYRE = 6;

/** How many more beasts each rung of the ladder holds than the one below it. */
const A_RUNG = A_BYRE;

export interface Stable {
  /** What it is called in `Settlement.works`, after the `stable:` that marks the entry as one. */
  id: string;
  /** And what it is called out loud, for a clerk or a book to read. */
  name: string;
  /** The most a farm with one of these can keep. */
  beasts: number;
}

/**
 * The four sizes, smallest first, which is also the order a farm works up through them.
 *
 * The byre is the one every farm already has and nobody paid for — a lean-to against the house with
 * room for the six beasts this world has always given a farmer. The rest is that number again each
 * time, so the ladder ends at a steading holding four times what a farm starts with, which is the
 * point at which a farmer with a herd has a ranch and a different game. `holdings.ts` makes the same
 * argument about why six and not six hundred, and this is that argument given somewhere to go.
 */
export const STABLES: readonly Stable[] = [
  { id: 'byre', name: 'a byre', beasts: A_BYRE },
  { id: 'stable', name: 'a stable', beasts: A_BYRE + A_RUNG },
  { id: 'barn', name: 'a barn', beasts: A_BYRE + A_RUNG * 2 },
  { id: 'steading', name: 'a steading', beasts: A_BYRE + A_RUNG * 3 },
];

/** What a farm has before anybody has built it anything: the lean-to it was founded with. */
export const BYRE: Stable = STABLES[0];

/** What marks an entry in `Settlement.works` as a stable rather than a roof or a well. */
const BUILT = 'stable';

/** Is this thing a village has paid for a stable? */
export function isAStable(work: string): boolean {
  return work.startsWith(`${BUILT}:`);
}

/**
 * What goes in `works` when one goes up: what it is, what size it came out, and whose farm it is on.
 *
 * Three parts where a roof needs two, and the third is the whole difference between the two files.
 * A village has one set of roofs and they are counted together; a village may have four farms and a
 * barn on one of them says nothing about the other three.
 */
export function workOf(stable: Stable, holding: string): string {
  return `${BUILT}:${stable.id}:${holding}`;
}

/** Which farm a stable entry was built for, or empty for an entry that names none. */
export function holdingOfWork(work: string): string {
  return work.slice(work.indexOf(':', BUILT.length + 1) + 1);
}

/**
 * Which size a `works` entry is.
 *
 * An entry naming a size this version of the world has never heard of reads as a byre, which is the
 * same courtesy `roofOfWork` pays a bare `house`: a village re-lived from its founding has to come
 * out holding the beasts it held before rather than none at all, and a save written by a later
 * build that knew about a fifth rung should degrade to the smallest rather than to nothing.
 */
export function stableOfWork(work: string): Stable {
  const id = work.slice(BUILT.length + 1, work.indexOf(':', BUILT.length + 1));
  return STABLES.find((stable) => stable.id === id) ?? BYRE;
}

/** One size up from this one, or the biggest there is when there is nothing bigger. */
export function oneSizeUp(stable: Stable): Stable {
  const at = STABLES.findIndex((one) => one.id === stable.id);
  return STABLES[Math.min(at + 1, STABLES.length - 1)];
}

/**
 * What stands on one farm today: the best thing anybody has built it, or the byre it began with.
 *
 * The best rather than the last, and the distinction is worth a line. A farm that has a barn and
 * then, somehow, has a stable built on it has a barn — you do not lose a building by putting a
 * smaller one beside it — so this takes the largest entry rather than the most recent one. It is
 * also what makes the ledger safe to replay in any order, which a ledger that is replayed had
 * better be.
 */
export function stableAt(built: readonly string[], holding: string): Stable {
  let best = BYRE;
  for (const work of built) {
    if (!isAStable(work) || holdingOfWork(work) !== holding) continue;
    const stable = stableOfWork(work);
    if (stable.beasts > best.beasts) best = stable;
  }
  return best;
}

/** How many beasts one farm can keep, which is the number item 33 exists to stop being a constant. */
export function beastsAt(built: readonly string[], holding: string): number {
  return stableAt(built, holding).beasts;
}

/**
 * What a stall is worth against a person's room: a third of it.
 *
 * One claim rather than a day-rate and a number of days, because inventing two numbers to arrive at
 * a third is how a price ends up unarguable-with. The claim is about the building: a room is a
 * floor, walls, a window, a chimney and a roof that has to keep a family dry through a winter; a
 * stall is posts, a beam, a roof and a hard standing, and nothing in it minds a draught. A third is
 * what is left when you take the joinery, the glazing and the hearth out of a room, and everything
 * else about the price then follows from what a village already pays its own builders.
 */
const A_STALL = 1 / 3;

/**
 * What a stable of this size costs the person paying for it, in gold.
 *
 * Quoted off `costOfARoof` rather than written out again, because two prices for one day's work is
 * how a builder ends up worth more to a family than to a farmer for the same morning. A house is
 * `STANDARD.holds` people; divide it out and what is left is what a village pays to house one, and
 * a stall is a third of that.
 *
 * The whole size rather than the rung, which is `costOfARoof`'s own rule: going up a size means
 * pulling the old one down and building the new one, so what is paid is what the new one costs. A
 * farm that climbs the ladder therefore pays for its barn twice over on the way, which is exactly
 * what a farm that outgrew two buildings has actually done.
 *
 * Computed on being asked rather than at module load, and that is not fussiness. A constant here
 * that read another module's constant while both were still initialising is precisely the
 * arithmetic that once made `rank.ts` and `growth.ts` hand every village in the world a bill of
 * `NaN`.
 */
export function costOfAStable(stable: Stable): number {
  const aRoomApiece = costOfARoof(STANDARD) / STANDARD.holds;
  return Math.round(stable.beasts * aRoomApiece * A_STALL);
}

/** Lengths of cut timber one stall wants: posts, a beam, and boards enough to roof it. */
const TIMBER_PER_BEAST = 5;

/**
 * And what it costs in timber, which is the half a purse cannot argue with.
 *
 * A stable is the most straightforwardly wooden thing anybody in this world builds — posts, beams,
 * boards, and almost nothing else. It is cheaper in wood *per beast* than a house is per person,
 * because a stall is smaller than a room; what makes it the wooden building is that nearly all of
 * its price is wood, where a house is also stone, thatch and glass. A stable for twelve wants
 * sixty lengths against a house's forty, and a steading wants a hundred and twenty — a fortnight of
 * one man's cutting, which is the sentence the material was put in to be able to say.
 *
 * That answers the question this item was handed with. A stable is the building that would be
 * *strangest* without a timber price: gold is fungible and a rich farmer will always find four
 * hundred of it, and a village on a bare rock with no logger in it should not be able to double its
 * herd by being wealthy.
 */
export function timberForAStable(stable: Stable): number {
  return stable.beasts * TIMBER_PER_BEAST;
}

/**
 * How many beasts a village's farms can keep between them.
 *
 * What `aDayOfCattle` wants in place of `farmers * BEASTS_PER_FARM`: the same number for a village
 * whose farms are all byres, and a larger one the moment anybody has built anything. Handed the
 * farms rather than reaching for them, so this file still never asks `holdings.ts` anything.
 */
export function herdRoomFor(built: readonly string[], farms: readonly string[]): number {
  return farms.reduce((room, holding) => room + beastsAt(built, holding), 0);
}
