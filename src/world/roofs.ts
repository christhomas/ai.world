import { FOOD } from './food';
import { householdsOf } from './homes';
import { LIFE, stageOf, surnameOf, type Person } from './people';

/**
 * Roofs, in sizes, and what a family can do under one.
 *
 * `growth.ts` made houses the ceiling on a village and every house in the world held four people,
 * which is a ceiling made of arithmetic wearing a house's name. What turns a population cap into a
 * *place* is that a roof has a size, that a family is limited by the one it lives under, and that a
 * family wanting another child has to be given more room first.
 *
 * So there are four sizes, and the ladder is one fact counted out four times: a roof holds a couple
 * and so many children. A cottage holds the couple and nothing else — a family in one that wants a
 * child has to be moved — and every size up is room for another `LIFE.CHILDREN`, which is the
 * number `people.ts` already uses for how many children a household is founded with. Nothing here
 * is picked.
 *
 * **This is also where hunger moved to.** Until tonight the larder was a gate in front of the
 * *building*: a village would not raise a roof unless its store was half full, which is a thing a
 * village checks on a ledger rather than a thing anybody feels. It is a condition on having
 * children now, and it is asked of the household — a family where somebody went without last night
 * does not have a baby tonight, whatever the village store says. That is hunger stopping a family
 * growing well before it starts killing anybody, and `register.ts` already buries whoever runs out
 * altogether.
 *
 * Two questions, and they are one question asked from either side. `whoCouldHaveAChild` is the
 * families with room left. `familiesWantingRoom` is the families with none, which is the only
 * reason a village has to raise anything — so the larder needs no gate of its own in front of the
 * building any more: a village whose store is empty has no family anywhere in it that wants room.
 *
 * **Not to be confused with `homes.ts`, which is its neighbour and not its rival.** That file
 * answers whose house the door you just opened is — a family, a building, a position on the map.
 * This one answers how much room a family has. They pair families to houses the same way and on
 * purpose: `householdsOf` is imported from there rather than written again here, so the first
 * family on the roll lives under the first roof in both files, and a villager cannot be told he
 * lives in the Vos house by one of them and has nowhere to put a child by the other.
 */

/** A couple, which is what any roof holds before you start counting children. */
const A_COUPLE = 2;

export interface Roof {
  /** What it is called in `Settlement.works`, after the `house:` that marks the entry as a roof. */
  id: string;
  /** And what it is called out loud, for a clerk or a book to read. */
  name: string;
  /** The most that can live under it. */
  holds: number;
}

/**
 * The four sizes, smallest first, which is also the order a village works up through them.
 *
 * The cottage is the interesting one. It holds a couple and no children at all, so a family in a
 * cottage that wants one has to be given more room first — which is the whole of what this is for,
 * said as a number rather than as a rule somewhere else. The rest of the ladder is that number plus
 * `LIFE.CHILDREN` again each time, so a world where households are bigger is a world where every
 * size of house is bigger, without two numbers anywhere meaning the same thing.
 */
export const ROOFS: readonly Roof[] = [
  { id: 'cottage', name: 'a cottage', holds: A_COUPLE },
  { id: 'house', name: 'a house', holds: A_COUPLE + LIFE.CHILDREN },
  { id: 'longhouse', name: 'a longhouse', holds: A_COUPLE + LIFE.CHILDREN * 2 },
  { id: 'greathouse', name: 'a great house', holds: A_COUPLE + LIFE.CHILDREN * 3 },
];

/**
 * What a village is laid out with, and what `foundVillage` fills.
 *
 * The middle of the ladder rather than the bottom, because a founding household is a couple and up
 * to `LIFE.CHILDREN` of theirs and has to fit under the roof it is founded under. It is also what a
 * bare `house` in `works` means, which is what every roof raised before tonight was written as.
 */
export const STANDARD: Roof = ROOFS[1];

/** What marks an entry in `Settlement.works` as a roof rather than a well or a bath house. */
const RAISED = 'house';

/** Is this thing a village has paid for a roof? */
export function isARoof(work: string): boolean {
  return work === RAISED || work.startsWith(`${RAISED}:`);
}

/** How long a village takes over one, in days. The same six a builder takes over a player's. */
export const RAISING_TAKES = 6;

/**
 * What goes in `works` when one goes up: what it is, what size it came out, and the morning it was
 * begun.
 *
 * The day is item 79, and it is here rather than anywhere else because `works` is the only thing a
 * village writes down about its own building. Without it a raised roof could only ever be drawn
 * finished: the ledger said *what* was bought and never *when*, so villages were the one builder in
 * the world that could not use the four stages a passer-by reads a site by — and a frame going up
 * in a village you are walking through is most of why those stages exist.
 *
 * Appended after the size, so an entry written before today reads back exactly as it did: no day
 * means a roof that was already standing when this was added, which is the truthful answer for a
 * village that has been there since before anybody was counting.
 */
export function workOf(roof: Roof, day?: number): string {
  return day === undefined ? `${RAISED}:${roof.id}` : `${RAISED}:${roof.id}@${Math.floor(day)}`;
}

/**
 * The morning a roof was begun, or nothing for one that was already standing.
 *
 * Nothing is a real answer and not a missing value: every roof this world raised before the day was
 * written down is a roof with no beginning anybody recorded, and the only honest thing to say about
 * it is that it is finished. See `game/villageroofs.ts`, which draws it that way.
 */
export function beganOn(work: string): number | null {
  const at = work.indexOf('@');
  if (at < 0) return null;
  const day = Number(work.slice(at + 1));
  return Number.isFinite(day) ? day : null;
}

/**
 * Which size a `works` entry is.
 *
 * A bare `house` is the standard one, and that is not a fallback for bad data — it is what the
 * entry meant when it was written. Every roof this world raised before there were sizes was a house
 * of four, and a village re-lived from its founding has to come out holding the people it held
 * before rather than four fewer.
 */
export function roofOfWork(work: string): Roof {
  const at = work.indexOf('@');
  const id = work.slice(RAISED.length + 1, at < 0 ? undefined : at);
  return ROOFS.find((roof) => roof.id === id) ?? STANDARD;
}

/** One size up from this one, or the biggest there is when there is nothing bigger. */
export function oneSizeUp(roof: Roof): Roof {
  const at = ROOFS.findIndex((one) => one.id === roof.id);
  return ROOFS[Math.min(at + 1, ROOFS.length - 1)];
}

/**
 * Every roof standing in a village: the ones it was laid out with, then the ones it has raised.
 *
 * In that order, and the order is load-bearing. `homes.ts` walks a village's buildings in the order
 * the seed placed them and hands them to households in the order they appear on the roll; this list
 * has to be the same list, or the family told it lives in the third cottage would be given the
 * room of somebody else's longhouse.
 */
export function roofsOf(laidOut: number, built: readonly string[]): Roof[] {
  const roofs: Roof[] = Array.from({ length: Math.max(0, laidOut) }, () => STANDARD);
  for (const work of built) if (isARoof(work)) roofs.push(roofOfWork(work));
  return roofs;
}

/**
 * How many people a village's roofs hold between them, which is what `founded` means.
 *
 * The honest definition at last: a village holds as many people as its houses have room for, so
 * growing is building and nothing else. `growth.ts` has been approximating it with a houseful
 * apiece since the loop went in, which was true only because every house was the same size.
 */
export function holdsFor(laidOut: number, built: readonly string[]): number {
  return roofsOf(laidOut, built).reduce((sum, roof) => sum + roof.holds, 0);
}

/** A family, the roofs it has between it, and how many those hold. */
export interface Household {
  /** The family name everybody in it shares. */
  name: string;
  people: Person[];
  roofs: Roof[];
  holds: number;
}

/**
 * Who lives under which roof.
 *
 * A household is a surname, which is not a simplification: `foundVillage` gives each house of a new
 * village its own family name and `fillTheGaps` gives a child its mother's, so the register has
 * been keeping households all along without calling them that. The order is `homes.ts`'s order —
 * imported rather than reasoned out again — so the first family on the roll has the first roof.
 *
 * What is new here is the free house. A village is laid out for the size it could be and lived in
 * by the size it is, so there are usually more roofs than families; `homes.ts` calls the leftovers
 * free and leaves them standing empty, which is the right answer to "who lives here" and the wrong
 * one to "where does the next child sleep". A free roof goes to the first family on the roll that
 * has run out of room under its own — the eldest boy taking the empty cottage next door, which is
 * what actually happens to an empty cottage next door.
 *
 * Without that a village could never grow into what it built: the roof it raised this morning would
 * belong to nobody, no family would have room, and the village would stand at its old size with a
 * new empty house in it for ever.
 *
 * A roof nobody is short of stays free, and that is honest too — a village with an empty house is
 * not a village short of houses.
 */
export function familiesUnder(people: readonly Person[], roofs: readonly Roof[]): Household[] {
  const kin = new Map<string, Person[]>();
  for (const person of people) {
    const name = surnameOf(person);
    if (name === '') continue;                   // lodging with somebody; see `homes.ts`
    const already = kin.get(name);
    if (already) already.push(person); else kin.set(name, [person]);
  }
  const households: Household[] = householdsOf(people)
    .map((name) => ({ name, people: kin.get(name) ?? [], roofs: [] as Roof[], holds: 0 }));
  if (households.length === 0) return households;

  const give = (to: Household, roof: Roof): void => { to.roofs.push(roof); to.holds += roof.holds; };
  const free: Roof[] = [];
  roofs.forEach((roof, at) => { if (at < households.length) give(households[at], roof); else free.push(roof); });
  for (const roof of free) {
    const wanting = households.find((family) => family.people.length >= family.holds);
    if (!wanting) break;
    give(wanting, roof);
  }
  return households;
}

/**
 * How full the cellar has to be before a village adds a mouth to feed, as a share of a full one.
 *
 * Half. A full cellar is `FOOD.KEEPS_DAYS` days of dinners a head, so half of one measured against
 * the village the child is being born into is nearly a week in hand — enough that a bad spell is
 * survivable and not so much that a village can never reach it.
 *
 * It sat in front of the building until tonight, which was the right instinct in the wrong place.
 * Villages that grew without it starved themselves out of existence inside a hundred days, so the
 * gate went on the only thing there was to gate. What it is actually for is stopping a village
 * taking on people it cannot feed, and people are taken on by being born.
 */
const IN_HAND = 0.5;

/** Is there enough in the store to feed one more? */
function foodInTheStore(people: readonly Person[], larder: number): boolean {
  return larder >= (people.length + 1) * FOOD.KEEPS_DAYS * IN_HAND;
}

/** Has everybody in this family eaten? One that went without last night does not grow tonight. */
function fed(family: Household): boolean {
  return !family.people.some((person) => (person.hungry ?? 0) > 0);
}

/**
 * The adults who could be somebody's parents this morning.
 *
 * The whole of the rule in one list: a couple has children when there is food in the store and room
 * under the roof, and not otherwise. Handed back as the grown people rather than as households
 * because `parentsFrom` is what chooses between them, and it has been choosing a mother and a
 * father out of a list of adults since long before any of this. All that changes is which list.
 *
 * A child joins its mother's family, and its mother is only in this list if her family has a bed
 * for it, so no household can ever be handed a child it has nowhere to put.
 */
export function whoCouldHaveAChild(
  people: readonly Person[], laidOut: number, built: readonly string[], larder: number, day: number,
): Person[] {
  if (!foodInTheStore(people, larder)) return [];
  const out: Person[] = [];
  for (const family of familiesUnder(people, roofsOf(laidOut, built))) {
    if (family.people.length >= family.holds) continue;
    if (!fed(family)) continue;
    out.push(...family.people.filter((person) => stageOf(person, day) === 'adult'));
  }
  return out;
}

/**
 * And the families with no room left, which is the only reason a village raises anything.
 *
 * The same question from the other side, and it is what lets the larder stop gating the building.
 * A village builds because a family has run out of room and would have another child if it had
 * some; a family going hungry would not, and a village whose store is empty has no such family
 * anywhere in it. So the money stays in the hall on exactly the mornings it ought to, for a reason
 * somebody living there could give you.
 */
export function familiesWantingRoom(
  people: readonly Person[], laidOut: number, built: readonly string[], larder: number,
): Household[] {
  if (!foodInTheStore(people, larder)) return [];
  return familiesUnder(people, roofsOf(laidOut, built))
    .filter((family) => family.people.length >= family.holds && fed(family));
}

/**
 * The biggest roof any of these families is living under.
 *
 * What a village measures its next house against. The point of building is to give a growing family
 * more room than it had, so the next one goes up a size from the best that is standing over anybody
 * who has run out: a village of cottages works its way up to houses, and one whose families have
 * filled a longhouse is a village that can start thinking about a great house.
 */
export function biggestRoofAmong(families: readonly Household[]): Roof | null {
  let best: Roof | null = null;
  for (const family of families) {
    for (const roof of family.roofs) if (!best || roof.holds > best.holds) best = roof;
  }
  return best;
}
