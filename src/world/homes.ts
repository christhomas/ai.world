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
 * a house; a house built for a new household is the next one along.
 *
 * ## And the one thing it could not do
 *
 * Position cannot promise a family the *same* house tomorrow. A household in front of you on the
 * roll dies out, or somebody walks in off the road, and the pairing shifts: everybody behind them
 * moves house overnight with nothing having happened to them. That is item 111.
 *
 * So there is one stored fact, and exactly one: a **deed**, which says this family holds this roof.
 * It is kept and replayed for the same reason a violent death and a raising at a shrine are — it is
 * not derivable once the world has a history — and it is deliberately the narrowest thing that will
 * do. Everything else here is still arithmetic: a village with no deeds behaves exactly as it
 * always did, `deedsAfter` re-derives the same answer from the same inputs, and the deeds only ever
 * *hold* a pairing the positional rule would already have made.
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
export function homesOf(
  houses: readonly Structure[], people: readonly Person[], deeds: readonly Deed[] = [],
): Home[] {
  const living = new Set(householdsOf(people));
  // a deed for a family nobody in the village belongs to any more is a record, not a home
  const held = new Map(deeds.filter((deed) => living.has(deed.family))
    .map((deed) => [deed.house, deed.family]));
  const housed = new Set(held.values());
  const waiting = householdsOf(people).filter((family) => !housed.has(family));
  let next = 0;
  return houses.map((house, at) => {
    const family = held.get(at) ?? (next < waiting.length ? waiting[next++] : '');
    return { house, family, free: family === '' };
  });
}

/**
 * One roof, held by one household: the fact position cannot carry.
 *
 * By its number rather than by where it stands, and that is the whole of why this works. The houses
 * come out of the seed in a fixed order and a new roof goes on the end, so a house's number is
 * stable in a way nothing else here is — it was never the houses that shuffled, it was the
 * households in front of you on the roll. It also means the register can keep this without knowing
 * any geometry: it holds how many houses a village has, and that is all a deed needs.
 */
export interface Deed {
  house: number;
  /** The family name, because a house holds a household rather than a person. */
  family: string;
}

/**
 * The deeds this village holds after today, given the ones it held before.
 *
 * Run over the whole village rather than written at the moment somebody dies, and that is what
 * makes it safe: it is the same answer asked twice, so a village re-lived from its founding arrives
 * where a machine that has been watching all along is standing. Three rules, in order —
 *
 * - a deed whose family has nobody left here is dropped, and the roof stands empty;
 * - a deed for a roof that is no longer standing is dropped;
 * - a household holding no deed takes the lowest-numbered roof nobody holds, in roll order.
 *
 * The last rule is what writes the first deeds: a village that has never held one is deeded in
 * exactly the order the positional rule would have housed it, so nothing moves on the morning this
 * starts being kept. It is also what houses somebody walking in off the road — into a roof nobody
 * holds, rather than into the house the family in front of them is still living in.
 */
export function deedsAfter(
  houses: number, people: readonly Person[], deeds: readonly Deed[],
): Deed[] {
  const living = new Set(householdsOf(people));
  const kept = deeds.filter((deed) => living.has(deed.family) && deed.house < houses);
  const housed = new Set(kept.map((deed) => deed.family));
  const taken = new Set(kept.map((deed) => deed.house));
  let next = 0;
  for (const family of householdsOf(people)) {
    if (housed.has(family)) continue;
    while (next < houses && taken.has(next)) next++;
    // out of roofs: the households at the end of the roll live somewhere this does not model —
    // with family, over a shop, in the room behind the forge. Better than inventing a house
    if (next >= houses) break;
    kept.push({ house: next, family });
    taken.add(next);
  }
  return kept.sort((one, two) => one.house - two.house);
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
  register: { homesOf: (village: string, houses: readonly Structure[]) => Home[] },
  door: { kind: string; village: string; bx: number; bz: number },
): string {
  if (door.kind !== 'house') return '';
  const village = villages.find((v) => v.name === door.village);
  if (!village) return '';
  // through the register rather than pairing the two lists here, because the pairing is positional
  // only until a deed says otherwise, and the register is what holds the deeds
  return familyAt(register.homesOf(door.village, village.houses), door.bx, door.bz);
}
