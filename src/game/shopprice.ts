import { dearnessOfFood } from '../world/prices';
import type { Person } from '../world/people';

/**
 * What they are asking today: the catalogue, what the village has to spare, and what he thinks of
 * you — in that order, and worked out in one place.
 *
 * Edibles only. A loaf is the thing this village grows and eats, so its price moves with the
 * cellar; a sword is made by nobody here until item 140 and keeps the catalogue's number. Exported
 * because a quoted price and a charged price that are worked out separately drift apart — see
 * `paidAtACounter` in `furs.ts`, which exists because exactly that happened.
 */
export function askingFor(
  item: { price: number; effect?: unknown; slot?: unknown },
  larder: number, people: readonly Person[], markup: number,
): number {
  /*
   * No village behind the counter means no reading to make, not a famine.
   *
   * `larder` arrives as nought when there is no register — a test bench, a shop stood up on its
   * own — and nought against an empty roll reads as the emptiest cellar there is, which quoted an
   * apple at three times the catalogue. A counter nobody has a village for quotes the catalogue.
   */
  const edible = item.effect !== undefined && item.slot === undefined;
  const local = edible && people.length > 0 ? item.price * dearnessOfFood(larder, people) : item.price;
  return Math.round(local * (1 + markup));
}
