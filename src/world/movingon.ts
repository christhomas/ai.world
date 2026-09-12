import { FORTUNE, grownFolk } from './fortunes';
import { LIFE } from './people';
import { PROSPER } from './prosperity';
import type { Change, Settlement } from './settlement';

/**
 * Why anybody would leave the village they were born in.
 *
 * `Register.resettle` has been able to move people into an emptied village since the day villages
 * could empty, and it has never once been called by the simulation — because it has to be *told*
 * which village sends and which receives, and nothing in the world had a reason to say. The
 * machinery was there and the motive was not.
 *
 * This is the motive, and it is deliberately a comparison anybody standing in a street could make:
 * is there more to eat and more to earn over there than here? A villager does not know the tax rate
 * or the size of the treasury. They know whether their own cellar is full, whether there is work,
 * and what the last person through said about the next valley.
 *
 * ## Why this matters beyond keeping the map populated
 *
 * A village left alone marries its own children to each other for four hundred days. Somebody who
 * walks in from three valleys away is new blood, and that is the day inherited features become
 * worth having — a face, a build, a colouring passed down the way a trade already is, so that a
 * stranger's children look like the stranger. None of that can be built until people move, so this
 * comes first.
 */

export const LEAVING = {
  /**
   * How much better the other place has to be before anybody actually goes, as a ratio.
   *
   * A fifth better. People do not move for a rounding error: leaving is expensive, everybody you
   * know is here, and a village that shed people over a two per cent difference would be a village
   * whose population sloshed back and forth for ever. A fifth is enough to be obvious to somebody
   * who has been told about it twice.
   */
  WORTH_THE_WALK: 1.2,
  /**
   * How long a place has to have stood empty before anybody will take it on, in days.
   *
   * Long enough that it is a ruin to be resettled rather than a disaster still happening. Whatever
   * emptied it may still be there, and walking into it the following morning is not resettlement,
   * it is the second helping.
   */
  LEFT_A_WHILE: 12,
} as const;

/** What somebody knows about a village, theirs or anybody's, without reading its books. */
export interface Living {
  village: string;
  /** Souls, children counted, because a child eats. */
  people: number;
  /** Meals in the store. */
  food: number;
  /** What the people of the place hold between them, which is what "there is work here" looks like. */
  purse: number;
  /** How many the roofs hold, which is whether there is anywhere to put anybody. */
  room: number;
  /** Days since the last of them died, or nothing for a village with anybody in it. */
  emptyFor: number | null;
}

/**
 * How good a living a place is, per head.
 *
 * Food and coin together, because either alone is a lie: a village with a full cellar and no money
 * cannot buy a roof or a plough, and one with money and no food is about to have neither. Per head
 * because that is what a person actually experiences — twice the granary shared among three times
 * the people is not twice as good.
 *
 * An empty village scores nothing rather than infinity, which is the point of asking separately
 * whether a place is empty: nobody moves *to* a ruin because the ruin is rich, they move because
 * there is somewhere to live and nobody in it.
 */
export function livingIn(place: Living): number {
  if (place.people === 0) return 0;
  // a week's reserve is what `PROSPER.KEEPS_BACK` is, so dividing a purse by it says how many weeks
  // of keep the money is worth — which puts coin and meals in the same units without inventing a
  // conversion rate that nothing else in the economy would recognise
  return place.food / place.people + (place.purse / place.people) / PROSPER.KEEPS_BACK;
}

/**
 * Who walks over to the empty village, out of everybody who might.
 *
 * The nearest thing to a decision anybody makes here: of the villages that could spare somebody,
 * the one that would gain least by staying goes. That reads backwards for a moment and is right —
 * a crowded village with a thin living has people who would rather be somewhere else, and a rich
 * one with room to spare does not.
 *
 * Nothing here knows where any of these places are, and that is a real limitation rather than a
 * simplification: a villager walking to a ruin four provinces away is not a thing that should
 * happen, and the day the register learns where its villages stand, this takes a distance and
 * prefers the nearest. It is written down so that it is a gap rather than a surprise.
 */
export function whoMovesIn(empty: Living, from: readonly Living[], day: number): string | null {
  if (empty.people > 0) return null;
  if (empty.emptyFor === null || empty.emptyFor < LEAVING.LEFT_A_WHILE) return null;
  if (empty.room <= 0) return null;

  let leaving: Living | null = null;
  for (const place of from) {
    if (place.village === empty.village || place.people === 0) continue;
    // only a village with more people than it has beds to spare, which is the same crowding the
    // growth loop answers by building: somewhere that cannot build is somewhere people leave
    if (place.people * LEAVING.WORTH_THE_WALK < place.room) continue;
    if (leaving === null || livingIn(place) < livingIn(leaving)) leaving = place;
  }
  return leaving?.village ?? null;
}

/**
 * The one move anybody makes today, out of every village there is.
 *
 * Reading a settlement into a `Living` belongs here rather than in the register, because what a
 * person can see of a village is this file's subject: souls, the cellar, what the people hold
 * between them, and whether there is anywhere to sleep. The register keeps the books; this decides
 * what somebody standing in the street would make of them.
 *
 * One move a day at most. A valley repopulating itself overnight is not a recovery, it is a
 * respawn, and the whole point of people walking in is that it takes as long as walking.
 */
export function whoWalksIn(
  villages: Iterable<[string, { people: { purse: number }[]; food: number; founded: number; emptied?: number }]>,
  day: number,
): { to: string; from: string } | null {
  const places: Living[] = [...villages].map(([village, here]) => ({
    village,
    people: here.people.length,
    food: here.food,
    purse: here.people.reduce((all, person) => all + person.purse, 0),
    room: here.founded,
    emptyFor: here.emptied === undefined ? null : day - here.emptied,
  }));
  for (const empty of places) {
    const from = whoMovesIn(empty, places, day);
    if (from) return { to: empty.village, from };
  }
  return null;
}

/**
 * The move itself: spare grown people out of one village and into an empty one.
 *
 * Here rather than in the register because it is the same subject as the rest of this file — what
 * makes somebody leave, and what it costs the place they leave. The register applies it; the
 * arithmetic of who goes is this file's.
 *
 * Three things cap how many go, and each is a different kind of limit. A village keeps enough
 * people to still be a village (`SPARE_ABOVE`); it never sends its last two grown adults, because
 * a place that empties itself to fill another has moved rather than helped; and a ruin is taken on
 * by a handful rather than by a crowd, which is what makes recovery something you watch happen.
 *
 * They keep their names and their memories, because this is the same person in a new place. What
 * they lose is who they know: everybody they grew up with is over the hill now.
 */
export function walkOver(lost: string, ruin: Settlement, neighbour: Settlement, day: number): Change[] {
  if (ruin.people.length > 0) return [];
  if (day - (ruin.emptied ?? day) < FORTUNE.RESETTLE_AFTER) return [];

  const grown = grownFolk(neighbour.people, day, LIFE.CHILD_UNTIL);
  const spare = Math.floor(neighbour.people.length - neighbour.founded * FORTUNE.SPARE_ABOVE);
  const sending = Math.min(spare, Math.max(0, grown.length - 2), Math.ceil(ruin.founded / 3));
  if (sending <= 0) return [];

  const from = neighbour.people[0]?.village ?? '';
  const changes: Change[] = [];
  for (const settler of grown.slice(0, sending)) {
    neighbour.people.splice(neighbour.people.indexOf(settler), 1);
    settler.village = lost;
    settler.knows = [];
    ruin.people.push(settler);
    changes.push({ kind: 'resettled', id: settler.id, name: settler.name, village: lost, from, day });
  }
  ruin.emptied = undefined;
  return changes;
}