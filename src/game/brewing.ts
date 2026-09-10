import { BREW, herbAt, patchOf, plenty, type Patch } from '../world/seams';
import type { GameState } from './state';

/** One tile, as the map of picked patches keys them. */
const key = (tx: number, tz: number): string => `${Math.floor(tx)},${Math.floor(tz)}`;

// Where a leaf grows is a fact about the world and lives there; this is the mortar and the recipes.
export { BREW, herbAt, patchOf, plenty } from '../world/seams';
export type { Patch } from '../world/seams';

export interface Recipe {
  id: string;
  name: string;
  emoji: string;
  /** Item ids and how many of each the grinding eats. */
  needs: Readonly<Record<string, number>>;
  /** The item id that comes out, and how many. */
  makes: string;
  count: number;
  /** Why anybody would bother, in one line, for whatever offers the choice. */
  note: string;
}

/**
 * Everything a mortar can make, written as rows rather than as branches. Adding a draught is
 * adding a line here: the interaction that offers them, and the code that checks a rucksack
 * against them, never change.
 */
export const RECIPES: readonly Recipe[] = [
  {
    id: 'salve', name: 'Salve', emoji: '🧪',
    needs: { herb: 2 }, makes: 'salve', count: 1,
    note: 'Two leaves and clean water. Drink it and the worst of it goes.',
  },
  {
    id: 'ward', name: 'Warding Draught', emoji: '🔮',
    // silver as well as leaves, and four of them: this is the way out of a fight, and a way out
    // that costs two minutes of gathering is a way out nobody ever has to think about
    needs: { herb: 4, silverore: 1 }, makes: 'ward', count: 1,
    note: 'Four leaves ground into silver dust. Turns aside what is coming, for a while.',
  },
];

/** A recipe by its id, for anything that stored the choice rather than the row. */
export const RECIPE: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** As much of a rucksack as brewing needs to see. */
export type Pack = Pick<GameState, 'count' | 'take' | 'give'>;


/**
 * Herbs: where the leaf grows, and what a mortar makes of it.
 *
 * Whether a tile is holding a herb is rolled from the world seed and the tile's own coordinates,
 * exactly as a buried seam is, so two players kneeling on the same river bank find the same plant
 * and nothing has to travel between them. Damp ground and woodland are generous with it; the
 * dunes and the bare highland rock very nearly are not.
 *
 * The decision worth explaining is that a picked patch comes back. A seam is spent for good
 * because the metal has been carried away, but a plant is not, and a country where every herb you
 * need is somewhere you have already been is a country that quietly runs out of medicine. So a
 * picking is remembered by the day it happened rather than for ever: the ground is bare for a few
 * days, and then it is not.
 */

export function missing(recipe: Recipe, pack: Pack): Array<{ id: string; short: number }> {
  const out: Array<{ id: string; short: number }> = [];
  for (const [id, need] of Object.entries(recipe.needs)) {
    const short = need - pack.count(id);
    if (short > 0) out.push({ id, short });
  }
  return out;
}

/** Could this be ground right now? The mortar itself is the caller's business, not the recipe's. */
export function canBrew(recipe: Recipe, pack: Pack): boolean {
  return missing(recipe, pack).length === 0;
}

/**
 * Grind a recipe: everything it asks for leaves the rucksack, and what it makes goes in. False
 * when anything at all is short, and in that case nothing is taken, so a half-finished draught
 * can never eat the leaves you were saving.
 */
export function brew(recipe: Recipe, pack: Pack): boolean {
  if (!canBrew(recipe, pack)) return false;
  for (const [id, need] of Object.entries(recipe.needs)) pack.take(id, need);
  pack.give(recipe.makes, recipe.count);
  return true;
}

/**
 * The patches picked this sitting. Local and unsaved on purpose: what grows where is derivable,
 * so the only work left is stopping somebody standing on one good bank and pressing Enter until
 * they have a rucksack full of leaves.
 */
export class Picking {
  private readonly order: string[] = [];
  private readonly picked = new Map<string, number>();

  /**
   * Has this patch been picked recently enough to still be bare?
   * @param day the world day, fraction and all, because a plant does not wait for midnight
   */
  bare(tx: number, tz: number, day: number): boolean {
    const when = this.picked.get(key(tx, tz));
    return when !== undefined && day - when < BREW.REGROW;
  }

  /**
   * Take what is growing here. Returns the leaves picked, or 0 when this tile grows nothing or
   * what it grew has not come back yet.
   */
  pick(seed: number, tx: number, tz: number, patch: Patch, day: number): number {
    if (this.bare(tx, tz, day)) return 0;
    const leaves = herbAt(seed, tx, tz, patch);
    if (leaves <= 0) return 0;
    const at = key(tx, tz);
    if (!this.picked.has(at)) this.order.push(at);
    this.picked.set(at, day);
    if (this.order.length > BREW.PICKED) this.picked.delete(this.order.shift()!);
    return leaves;
  }
}
