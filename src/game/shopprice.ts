import { Forge } from './forge';
import { dearnessOfFood } from '../world/prices';
import { mealsIn } from './items';
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
  item: { price: number; effect?: unknown; slot?: unknown; id?: string },
  larder: number, people: readonly Person[], markup: number,
  /**
   * What the village's own shelf does to the price, for the things it makes itself.
   *
   * One is the catalogue and is what everything that was carried in costs. A village down to its
   * last sword asks more for it, by the same smooth reading the cellar gives a loaf — see
   * `dearnessOfGear`, which restates `prices.ts`'s rule rather than inventing a second shape for
   * scarcity.
   */
  scarcity = 1,
): number {
  /*
   * No village behind the counter means no reading to make, not a famine.
   *
   * `larder` arrives as nought when there is no register — a test bench, a shop stood up on its
   * own — and nought against an empty roll reads as the emptiest cellar there is, which quoted an
   * apple at three times the catalogue. A counter nobody has a village for quotes the catalogue.
   */
  const edible = item.effect !== undefined && item.slot === undefined;
  const local = edible && people.length > 0
    ? item.price * dearnessOfFood(larder, people)
    : item.price * scarcity;
  return Math.round(local * (1 + markup));
}

/**
 * Take what this purchase costs the village off its shelf, or say it cannot be had.
 *
 * Item #231. A shelf that cannot run out is a map the hero can read and never change, which is
 * worse once #230 has given the map a shape: prices would differ between villages and nothing he
 * did could move them.
 *
 * Asked **before** the money moves, and that order is the whole of it — a purchase that took the
 * coin and then found no bread would be exactly the direction this economy is audited against.
 *
 * A partial take is put straight back, so a refusal costs the village nothing. Handing back a
 * boolean rather than the meals is deliberate: a caller that knew how many it got would be tempted
 * to sell a part of a loaf.
 *
 * Gear has a maker now (#232), so it has a bottom too — but only the gear a village forge actually
 * turns out. A steel sword in a mountain town was carried there by somebody and its shelf is as
 * deep as the catalogue, exactly as it was.
 */
export function offTheShelf(
  register: { takeFromLarder(v: string, m: number): number; addToLarder(v: string, m: number): number } | null,
  village: string,
  item: { effect?: unknown; id?: string },
  forge?: { take(village: string, id: string): boolean; } | null,
): boolean {
  const wanted = mealsIn(item as Parameters<typeof mealsIn>[0]);
  if (wanted > 0) {
    if (!register) return true;
    const got = register.takeFromLarder(village, wanted);
    if (got >= wanted) return true;
    if (got > 0) register.addToLarder(village, got);
    return false;
  }
  // a thing a village forge makes comes off that village's shelf; anything else was carried in
  if (!forge || !item.id || !Forge.makes(item.id)) return true;
  return forge.take(village, item.id);
}
