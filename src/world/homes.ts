import { surnameOf, type Person } from './people';
import type { Structure } from './structures';

/**
 * Who owns a house.
 *
 * A house you walk into belongs to nobody today. There is a person standing in it because the room
 * needed one, the room is grown from the building's position, and the question "whose is this" has
 * never had an answer. That is the thing missing from a village that has an economy: a holding that
 * outlives its holder, a household that has somewhere to live, a house that can be built *for*
 * somebody. All of those need an owner first.
 *
 * ## Deeded, then reconciled
 *
 * A village's first deeds are seeded in house order, then stay on the register. Every morning the
 * register frees a deed whose family has gone and gives the first free roof to a new household.
 * That keeps a named family in its own house across births, deaths and changes in roll order while
 * still making an empty village's roofs available to the people who resettle it.
 *
 * ## Free houses
 *
 * More houses than households is the ordinary case rather than an edge one: a village is laid out
 * for the size it could be and lived in by the size it is. What is left over is a **free house** —
 * nobody's, standing, with a roof. That is a thing the rest of the game can use: somewhere a
 * traveller can sleep for nothing, somewhere a villager caught out by the dark can shelter, and the
 * beginning of an answer to what a village looks like at midnight.
 */

/** One house, and whoever lives in it. */
export interface Home {
  house: Structure;
  /**
   * The family name of whoever lives here, or empty for a free house.
   *
   * A surname rather than a person, because a house holds a household: naming one of the four
   * people in it as the owner would make the house change hands every time somebody dies, which is
   * not what happens to a family home.
   */
  family: string;
  /** Nobody's, and standing. */
  free: boolean;
}

/**
 * The households of a village, in the order they first appear on the roll.
 *
 * Order is what makes this stable: the register keeps its people in the order they were founded and
 * adds newcomers at the end, so a family that has been there since the beginning keeps its place in
 * the queue — and therefore its house — as people are born and buried around it.
 */
export function householdsOf(people: readonly Person[]): string[] {
  const seen: string[] = [];
  for (const person of people) {
    const family = surnameOf(person);
    if (family !== '' && !seen.includes(family)) seen.push(family);
  }
  return seen;
}

/** The first deeds in a newly founded village, one entry for every roof that stands there. */
export function householdDeeds(people: readonly Person[], houses: number): string[] {
  const families = householdsOf(people);
  return Array.from({ length: Math.max(0, houses) }, (_, at) => families[at] ?? '');
}

/**
 * Keep the register's deeds honest after its population or roofs change.
 *
 * A deed never moves merely because the roll's order changed. It becomes free only when nobody of
 * that family remains, and the next household without a roof takes the first free one.
 */
export function reconcileHomeDeeds(deeds: string[], people: readonly Person[], houses: number): void {
  deeds.length = Math.max(0, houses);
  const families = householdsOf(people);
  for (let at = 0; at < deeds.length; at++) if (!families.includes(deeds[at])) deeds[at] = '';
  for (const family of families) {
    if (deeds.includes(family)) continue;
    const free = deeds.indexOf('');
    if (free < 0) break;
    deeds[free] = family;
  }
}

/**
 * Which house each household lives in, and which houses nobody lives in.
 *
 * Households take houses in order. Run out of houses and the households at the end of the roll are
 * living somewhere this does not model — with family, over a shop, in the room behind the forge —
 * which is a better answer than inventing a house that is not standing anywhere.
 */
export function homesOf(houses: readonly Structure[], people: readonly Person[], deeds?: readonly string[]): Home[] {
  const families = householdsOf(people);
  return houses.map((house, at) => ({
    house,
    family: deeds ? deeds[at] ?? '' : families[at] ?? '',
    free: deeds ? (deeds[at] ?? '') === '' : at >= families.length,
  }));
}

/** Whoever lives in the house at this position, or empty if it is free or is not a house at all. */
export function familyAt(homes: readonly Home[], bx: number, bz: number): string {
  return homes.find((home) => home.house.tx === bx && home.house.tz === bz)?.family ?? '';
}

/**
 * What to call a house you have walked into.
 *
 * "The Vos house" when somebody lives there and "an empty house" when nobody does — said as a
 * *place* rather than as a fact about ownership, because that is how anybody would describe walking
 * into one.
 */
export function nameOfHome(family: string): string {
  return isFree(family) ? 'An empty house' : `The ${family} house`;
}

/**
 * A house nobody lives in, which is a thing rather than an absence.
 *
 * A village shrinks: a family dies out, a household walks over the hill to an emptied valley, and
 * the roofs stay up. What is left is a free house — nobody's, standing, with a roof — and until
 * now that was only a caption. "An empty house in Ashford" told you whose it was not and offered
 * nothing, so a village that had lost half its people differed from one that had not by a word.
 */
export function isFree(family: string): boolean {
  return family === '';
}

/**
 * What a night under that roof costs: nothing, or nothing doing.
 *
 * Nought for a free house and `null` for somebody's, which are different answers and not degrees of
 * one. An inn charges because a bed is the innkeeper's trade; a free house charges nothing because
 * there is nobody to pay. A house with a family in it is not cheap or dear — it is theirs.
 *
 * **The rule is the same for the hero and for a villager.** That is what keeps this from being a
 * player convenience bolted onto a simulation: a villager on the road who finds an empty roof has
 * found the same thing the hero has, for the same reason.
 */
export function whatABedCosts(family: string): number | null {
  return isFree(family) ? 0 : null;
}

/**
 * What the house says about itself from the doorway.
 *
 * Said outside rather than discovered inside, because a mechanic you find by trying every door in
 * the village is a mechanic nobody finds. The village is named because which village it is in is
 * the thing a player is deciding about — an empty roof three valleys from anywhere is worth more
 * than one in the place he was going anyway.
 */
export function saidOfAFreeHouse(village: string): string {
  return `Nobody has lived here for a long while. The roof holds, and in ${village} that is enough`
    + ' — there is a bed, and no one to ask for anything for it.';
}

/**
 * Whose house the door you have just opened belongs to.
 *
 * The one call the game makes, so that nothing outside this file has to know that houses and
 * households are matched in order. Empty for a free house, for a door that is not a house at all,
 * and for a village nobody has settled yet — all three of which mean the same thing to whoever is
 * standing in the doorway: nobody lives here.
 */
export function familyOfDoor(
  villages: readonly { name: string; houses: Structure[] }[],
  register: {
    living: (village: string) => readonly Person[];
    deedsOf: (village: string) => readonly string[];
  },
  door: { kind: string; village: string; bx: number; bz: number },
): string {
  if (door.kind !== 'house') return '';
  const village = villages.find((v) => v.name === door.village);
  if (!village) return '';
  return familyAt(homesOf(village.houses, register.living(door.village), register.deedsOf(door.village)), door.bx, door.bz);
}
