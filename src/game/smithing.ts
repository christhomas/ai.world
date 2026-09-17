import { hash3 } from '../core/rng';
import { ITEMS } from './items';

/**
 * A smith's day: ore, timber, and somebody's labour becoming a thing that was not there before.
 *
 * The first good in this world whose supply is *geographic*. Everything else a village has either
 * grows on it, is dug out of it, or is carried in by somebody; gear is made, out of two materials
 * that have to both be present, by a trade that has to be filled. A village with a seam, a wood and
 * a smithy arms itself out of its own ground. A village on a bare rock buys gear or goes without,
 * and there is now somewhere for it to buy it *from*.
 *
 * ## A rate, not an order
 *
 * A smith works whether or not anybody walks in, the way a farmer's field yields whether or not
 * anybody is watching. That is what stocks the shelf of a village nobody has visited, and it is
 * why this runs off the day rather than off a conversation. A smith who only worked to order would
 * leave every shop in the country empty until a player stood in it.
 *
 * ## Why the shelf is a count of things rather than a number
 *
 * The food shelf is one number — meals — because a loaf is a loaf. Gear is not: a village that has
 * made two helms and no swords is a different village to walk into than one that has made two
 * swords and no helms, and that difference is most of what makes somewhere worth the walk. So the
 * forge keeps a count per item, and `offTheShelf` asks it the same question it asks the larder.
 */

/** What one piece of gear takes out of a village to make. */
export interface Recipe {
  /** The item it becomes, out of `ITEMS`. */
  id: string;
  /** Pieces of ore off the heap by the adit. */
  ore: number;
  /** And lengths off the timber yard: a hilt, a haft, the boards of a shield. */
  timber: number;
}

/**
 * What a village smith makes, and what each takes.
 *
 * Plain iron only, and that is the shape of the thing rather than a first pass. Steel, plate and a
 * war axe are what a *named* smith makes to order — they are the reason a commission exists — and
 * a village forge turning them out on a rate would make the good stuff something you wait for
 * rather than something you go and ask for.
 *
 * The costs are read against `ITEMS`: a sword is sixty gold and two pieces of ore at thirty-four
 * are sixty-eight, so a smith's day turns rather less than he sells it for and the difference is
 * his labour — which is exactly the new value this whole chain was for. It is deliberately thin.
 * A forge that doubled its inputs' worth every day would out-earn the mine that feeds it.
 */
export const FORGES: readonly Recipe[] = [
  { id: 'sword', ore: 2, timber: 1 },
  { id: 'helm', ore: 2, timber: 0 },
  { id: 'ironshield', ore: 3, timber: 2 },
];

export const SMITHING = {
  /**
   * How many of one thing a village keeps on the shelf before the smith makes something else.
   *
   * Four. A shelf with a dozen swords on it is a shop rather than a forge, and the number is what
   * makes a village's stock *read* as the work of one man over a few weeks. It is also what stops
   * a hundred quiet days leaving every smithy in the country with an armoury in it, which is the
   * limit going away again by arithmetic.
   */
  KEEPS: 4,
  /**
   * What the last one on the shelf costs against the first, as a multiplier.
   *
   * The same shape as food's `PRICES.DEAR`, and a gentler number: a village down to its last sword
   * knows it is the last sword, but a sword is not dinner and nobody is desperate for one. Half
   * again, smoothly, so no village crosses a cliff between two mornings.
   */
  DEAR: 1.5,
} as const;

/**
 * What the smith turns to this morning, or nothing at all.
 *
 * Whichever of his lines the shelf is shortest of, so a village fills out its range before it
 * deepens it — and a tie is broken by the day, so two empty shelves in two villages are not the
 * same shelf twice. Nothing where every line is stocked, which is a smith with a full shop doing
 * something else with his day.
 */
export function whatToMake(
  seed: number, village: string, day: number, onShelf: (id: string) => number,
): Recipe | null {
  const wanting = FORGES.filter((one) => onShelf(one.id) < SMITHING.KEEPS);
  if (wanting.length === 0) return null;
  const fewest = Math.min(...wanting.map((one) => onShelf(one.id)));
  const level = wanting.filter((one) => onShelf(one.id) === fewest);
  return level[hash3(seed, hashOfName(village), Math.floor(day)) % level.length];
}

/**
 * A day at the forge: what was made, and what it took.
 *
 * Refuses rather than part-makes, for the reason the timber yard refuses: half a sword is a sword
 * nobody can sell, and materials quietly spent on a job that was then abandoned would be a village
 * that lost its ore to arithmetic. The caller draws only on a `made`.
 */
export interface Smithed {
  made: Recipe;
  /** What it is worth on the shelf, before the village's own scarcity moves it. */
  worth: number;
}

export function aSmithsDay(
  seed: number, village: string, day: number, smiths: number,
  held: { ore: number; timber: number },
  onShelf: (id: string) => number,
): Smithed | null {
  if (smiths <= 0) return null;
  const made = whatToMake(seed, village, day, onShelf);
  if (!made) return null;
  if (held.ore < made.ore || held.timber < made.timber) return null;
  return { made, worth: ITEMS[made.id]?.price ?? 0 };
}

/**
 * What a village asks for a piece of its own gear, against the catalogue.
 *
 * The same reading the larder gives food, applied to a shelf that is a count rather than a store:
 * plenty is the catalogue price, and the last one costs `DEAR`. Smooth, so no village crosses a
 * cliff between two mornings — which is `prices.ts`'s rule and the reason it is worth restating
 * here rather than inventing a second shape for scarcity.
 */
export function dearnessOfGear(onShelf: number): number {
  const cover = Math.min(1, Math.max(0, onShelf / SMITHING.KEEPS));
  const smooth = cover * cover * (3 - 2 * cover);
  return SMITHING.DEAR + (1 - SMITHING.DEAR) * smooth;
}

/** A stable number for a village's name, so one village's luck is never another's. */
function hashOfName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
