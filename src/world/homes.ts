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
 * ## Derived, not written down
 *
 * Nothing here is stored. A village's houses come out of the seed in a fixed order and its
 * households come off the register, and the rule is that the first household lives in the first
 * house. That is the same bargain the whole world is built on: two people who have never spoken
 * walk into the same cottage and are told the same family lives there, because the arithmetic says
 * so rather than because anybody agreed.
 *
 * It also means the answer moves as the village does, which is right. A family that dies out leaves
 * a house; a house built for a new household is the next one along. What it does *not* do is let a
 * particular family stay in a particular house across a resettling, and that is a real limitation —
 * see the work list. A deed on the register is the honest fix and it is a bigger change than this.
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

/**
 * Which house each household lives in, and which houses nobody lives in.
 *
 * Households take houses in order. Run out of houses and the households at the end of the roll are
 * living somewhere this does not model — with family, over a shop, in the room behind the forge —
 * which is a better answer than inventing a house that is not standing anywhere.
 */
export function homesOf(houses: readonly Structure[], people: readonly Person[]): Home[] {
  const families = householdsOf(people);
  return houses.map((house, at) => ({
    house,
    family: families[at] ?? '',
    free: at >= families.length,
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
  return family === '' ? 'An empty house' : `The ${family} house`;
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
  register: { living: (village: string) => readonly Person[] },
  door: { kind: string; village: string; bx: number; bz: number },
): string {
  if (door.kind !== 'house') return '';
  const village = villages.find((v) => v.name === door.village);
  if (!village) return '';
  return familyAt(homesOf(village.houses, register.living(door.village)), door.bx, door.bz);
}
