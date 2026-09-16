import { cellarCap } from './food';
import type { Settlement } from './settlement';

/**
 * A village's shelf: what its store holds, what may come off it, and what may go back on.
 *
 * Out of `register.ts`, which was over the length the architecture test allows a module to reach.
 * The cut is the same one `stablebook.ts` took and for the same reason: everything here is about
 * one village's food and touches nothing else the register keeps, so it was already standing on its
 * own inside that file.
 *
 * Item #231 is what these are for. The hero buying bread is the village being one loaf shorter, and
 * a shelf that cannot run out is a map he can read and never change — which is worse once #230 has
 * given the map a shape.
 *
 * Every one of these hands back what actually happened rather than what was asked for. That is the
 * rule `deeds.ts` keeps about coins, for the same reason: a caller that charges for what it asked
 * rather than for what it got is a caller that mints.
 */

/** What this village's cellar holds when it is full, which is what its people need for a while. */
export function cellarFor(here: Settlement | undefined): number {
  return here ? cellarCap(here.people) : 0;
}

/**
 * Set the store directly. Tests and the console; nothing in a played day calls it.
 *
 * A day's food is grown, eaten and sold by `aDaysDinner`, and a village whose store could be
 * written from anywhere would be a village whose books nobody could add up.
 */
export function setStore(here: Settlement | undefined, food: number): void {
  if (here) here.food = Math.max(0, Math.min(cellarFor(here), food));
}

/**
 * Take meals off the shelf, and hand back how many there actually were.
 *
 * Never more than there is, and never a negative ask: both would mint a meal out of nothing, and a
 * meal out of nothing is a coin out of nothing one trade later.
 */
export function takeMeals(here: Settlement | undefined, meals: number): number {
  if (!here || !(meals > 0)) return 0;
  const took = Math.min(Math.floor(meals), Math.max(0, here.food));
  here.food -= took;
  return took;
}

/**
 * Put meals back on it, and hand back how many it had room for.
 *
 * Selling to a village is the other half of the loop and the reason it limits itself: the village he
 * keeps buying from runs short and dear, the one he keeps selling to grows full and cheap. Nothing
 * anywhere has to say he may not do this too much.
 *
 * Capped at what the cellar holds, because a store has a size. A village's own surplus already goes
 * to the next valley in `aDaysDinner` rather than onto the floor, so a shelf that swallowed an
 * unbounded amount would be a place to hide meals from the audit.
 */
export function addMeals(here: Settlement | undefined, meals: number): number {
  if (!here || !(meals > 0)) return 0;
  const put = Math.min(Math.floor(meals), Math.max(0, cellarFor(here) - here.food));
  here.food += put;
  return put;
}
