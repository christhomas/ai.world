import { SQUARE } from './civic';

/**
 * What a place *is*, counted rather than declared.
 *
 * This falls out of the growth loop for nothing, and that is the whole argument for it. If the
 * roofs a place has are what caps its population (`growth.ts`, `roofs.ts`), then the roofs are also
 * what the place *is* — so a rank needs no rule anywhere saying "this seed puts a city here". A
 * valley grows into a town because its people built the houses, and the player sees it without
 * being told: arriving somewhere a year later and finding a skyline is worth more than any label.
 *
 * The hall has worked this way at one threshold since it was built — eight houses is what earns a
 * village a town hall and a watch house — so this is that idea taken the whole distance, and it is
 * deliberately hung off the same number rather than off a new one.
 *
 * ## What a rank is allowed to do
 *
 * Unlock buildings and trades; never make numbers bigger. A town that simply earned more per head
 * than a village would be a multiplier wearing a noun, and the economy would stop being a thing you
 * can reason about. What a bigger place has is *things a smaller one has not got* — and every one of
 * them is something the player can walk up to.
 */

export type Rank = 'hamlet' | 'village' | 'town' | 'city';

/**
 * The ranks, and what standing in one means.
 *
 * Every threshold is a multiple of the eight houses that already earn a hall, because inventing a
 * second set of numbers for the same question is how two parts of a world start disagreeing about
 * what a place is. A hamlet is under it: too small for a hall, which is exactly what `SQUARE`'s own
 * comment says of the villages capped at six houses. A village has one. A town has twice the houses
 * a hall wants, and a city four times — which is a great many roofs, and is meant to be: at the pace
 * a village builds, a city is the work of years and nobody has ever seen one.
 */
export const RANKS: ReadonlyArray<{ id: Rank; roofs: number; label: string }> = [
  { id: 'hamlet', roofs: 0, label: 'hamlet' },
  { id: 'village', roofs: SQUARE.CIVIC_HOUSES, label: 'village' },
  { id: 'town', roofs: SQUARE.CIVIC_HOUSES * 2, label: 'town' },
  { id: 'city', roofs: SQUARE.CIVIC_HOUSES * 4, label: 'city' },
];

/** What a place of this many roofs is called. */
export function rankOfRoofs(roofs: number): Rank {
  let rank: Rank = 'hamlet';
  for (const step of RANKS) if (roofs >= step.roofs) rank = step.id;
  return rank;
}

/**
 * How many more roofs before it is called something else, or nothing for a city.
 *
 * Takes a count rather than a village, and that is not a stylistic choice. `growth.ts` is what knows
 * how to count the roofs of a village, and it asks this file what the count *means* — so this file
 * must not ask it back. A cycle between the two left a constant undefined at module-init time for
 * about ten minutes tonight, which made a roof's price `NaN`; and because `purse < NaN` is false,
 * every village "raised" a longhouse it could not pay for and its treasury went to `NaN` with it.
 * The lesson is cheap to write down and was not cheap to find: this file counts nothing.
 */
export function untilTheNextRank(roofs: number): number | null {
  const next = RANKS.find((step) => step.roofs > roofs);
  return next ? next.roofs - roofs : null;
}

/**
 * Whether a place of this rank is at least that rank, which is the question everything else asks.
 *
 * Written as a comparison on the list rather than on the words, so that adding a rank between two
 * existing ones is one line here and nothing anywhere else.
 */
export function atLeast(rank: Rank, wanted: Rank): boolean {
  const has = RANKS.findIndex((step) => step.id === rank);
  const needs = RANKS.findIndex((step) => step.id === wanted);
  return has >= needs;
}
