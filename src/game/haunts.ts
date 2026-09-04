import { hashString, mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { AWAKE, isDaytime } from '../entities/entity';
import type { MonsterId } from '../entities/monsters';
import { StructureKind, type Structures } from '../world/structures';
import { DAY_LENGTH } from './state';

/**
 * Which places in a world are kept by something that is not an animal.
 *
 * Herds belong to chunks: a wood grows deer because the ground under it rolled deer, and when you
 * walk away they are gone. That is right for wildlife and wrong for this. A thing that keeps a
 * ruin is a fact about the ruin, true whether or not anybody is looking, the same on the first
 * visit as on the fortieth and the same for everyone in the world at once. So a haunt is not
 * spawned, it is derived: seed, place, and nothing else, which is why two people standing in the
 * same barrow see the same thing with nothing crossing between them.
 *
 * The decision worth arguing about is that which sort of place holds which sort of thing is
 * fixed rather than rolled. A player who has met one wight in one fallen keep can look at the
 * next fallen keep on the map and know what waiting until noon would save them, and a world you
 * can reason about beforehand is worth more than a world that surprises you every time.
 */

export const HAUNT = {
  /**
   * How much of each sort of place is kept at all. Shrines and towers are deliberately absent
   * from this list: a shrine is tended and a tower is a landmark on a road, and a map where every
   * marked place is a fight is a map nobody reads twice.
   */
  SHARE: { ruin: 0.5, camp: 0.3, wood: 0.35, cave: 0.4, wreck: 0.55 },
  /**
   * What keeps each sort. Ruins, cold camps and wrecks have somebody buried or drowned in them,
   * so they hold a wight; deep woods and cave mouths are where something large would actually
   * fit, so they hold an ogre.
   */
  KEEPER: { ruin: 'wight', camp: 'wight', wood: 'ogre', cave: 'ogre', wreck: 'wight' },
  /**
   * How far a kept place's ground reaches, in tiles. A wight does not come past it, which is the
   * only reason somebody who cannot outrun one ever gets home: the run is short and it is known.
   */
  GROUND: 15,
  /** How far off an ogre takes an interest, which is a good deal further than its own ground. */
  ROAM: 30,
  /**
   * Slack past either of those before what is standing there is taken away again. Without it,
   * somebody walking the edge of a barrow would have a wight blinking in and out beside them.
   */
  SLACK: 12,
} as const;

/** The sorts of place something keeps. Anything not named here is nobody's ground. */
export type Ground = 'ruin' | 'camp' | 'wood' | 'cave' | 'wreck';

/** One place in the world that something might keep. */
export interface Place {
  /**
   * The same string on every client and after every reload. It is built from where the place is
   * rather than from what it is called, because a name is chosen from a list and a tile is not.
   */
  id: string;
  name: string;
  x: number;
  z: number;
  ground: Ground;
}

/** A place that is kept, and by what. */
export interface Haunt extends Place {
  kind: MonsterId;
}

/**
 * Which points of interest count as ground at all. A translation from what the world generator
 * put there to what this file cares about, and the reason a shrine never appears below.
 */
const POI_GROUND: Partial<Record<StructureKind, Ground>> = {
  [StructureKind.Ruins]: 'ruin',
  [StructureKind.Campfire]: 'camp',
  [StructureKind.GiantTree]: 'wood',
};

/** Every place in a world that could be kept, whether or not it is. */
export function placesOf(structures: Structures): Place[] {
  const places: Place[] = [];
  for (const poi of structures.pois) {
    const ground = POI_GROUND[poi.kind];
    if (ground) places.push({ id: `poi:${Math.round(poi.x)},${Math.round(poi.z)}`, name: poi.name, x: poi.x, z: poi.z, ground });
  }
  for (const cave of structures.caves) places.push({ id: cave.id, name: cave.name, x: cave.x, z: cave.z, ground: 'cave' });
  for (const wreck of structures.wrecks) places.push({ id: wreck.id, name: wreck.name, x: wreck.x, z: wreck.z, ground: 'wreck' });
  return places;
}

/**
 * Whether this place is kept, and by what. A pure function of the seed and the place, so anybody
 * holding both arrives at the same answer without being told it.
 */
export function hauntOf(seed: number, place: Place): Haunt | null {
  const rng = mulberry32(derive(seed, SALT.HAUNT) ^ hashString(place.id));
  if (rng() >= HAUNT.SHARE[place.ground]) return null;
  return { ...place, kind: HAUNT.KEEPER[place.ground] };
}

/** Everywhere in one world that something keeps. Worked out once when the world is opened. */
export function hauntsOf(seed: number, structures: Structures): Haunt[] {
  const kept: Haunt[] = [];
  for (const place of placesOf(structures)) {
    const haunt = hauntOf(seed, place);
    if (haunt) kept.push(haunt);
  }
  return kept;
}

/** The kept place whose ground this point is on, or null for the whole rest of the country. */
export function hauntNear(haunts: readonly Haunt[], x: number, z: number): Haunt | null {
  let best: Haunt | null = null;
  let nearest: number = HAUNT.GROUND;
  for (const haunt of haunts) {
    const away = Math.hypot(haunt.x - x, haunt.z - z);
    if (away > nearest) continue;
    nearest = away;
    best = haunt;
  }
  return best;
}

/** Is what keeps this place out at this hour? A wight is not; everything else always is. */
export function abroad(haunt: Haunt, time: number): boolean {
  // the same hours the country keeps its doors shut, which is what makes a wight legible: it is
  // out when no villager will stand outside, and that is the one rule you have to learn
  return haunt.kind !== 'wight' || !isDaytime(time);
}

/**
 * How far from a place its keeper's business extends. An ogre ranges: it will follow you off its
 * own ground and a long way down the road, which is why you have to actually run from one. A
 * wight does not leave the ground it is buried in, and that is the only thing that makes one
 * survivable by somebody it is faster than.
 */
export function reachOf(haunt: Haunt): number {
  return haunt.kind === 'wight' ? HAUNT.GROUND : HAUNT.ROAM;
}

/** Will it come for somebody standing here, at this hour? */
export function pursues(haunt: Haunt, x: number, z: number, time: number): boolean {
  return abroad(haunt, time) && Math.hypot(haunt.x - x, haunt.z - z) <= reachOf(haunt);
}

/**
 * Which kept place should have its keeper standing in the world right now, for somebody at
 * (x, z). Null nearly always: this is the question the frame loop asks, and the answer is where
 * to spawn.
 */
export function toRaise(haunts: readonly Haunt[], x: number, z: number, time: number): Haunt | null {
  let best: Haunt | null = null;
  let nearest = Infinity;
  for (const haunt of haunts) {
    if (!pursues(haunt, x, z, time)) continue;
    const away = Math.hypot(haunt.x - x, haunt.z - z);
    if (away > nearest) continue;
    nearest = away;
    best = haunt;
  }
  return best;
}

/**
 * Should the keeper already standing in this place be taken away again? Dawn came, or you are
 * clear. The slack is why this is not simply `!pursues`: raising and laying at the same line
 * would blink a wight in and out beside anybody who walked the edge of its ground.
 */
export function gone(haunt: Haunt, x: number, z: number, time: number): boolean {
  return !abroad(haunt, time) || Math.hypot(haunt.x - x, haunt.z - z) > reachOf(haunt) + HAUNT.SLACK;
}

/**
 * How long until first light, in real seconds. Zero while it is already day.
 *
 * The hero has no way to make morning come sooner, so this is not a countdown to be watched so
 * much as an answer to "can I wait this out, or do I have to leave?" A night is a good few
 * minutes of real time: usually the answer is leave.
 */
export function untilDawn(time: number): number {
  if (isDaytime(time)) return 0;
  const dawn = AWAKE[0];
  return (time < dawn ? dawn - time : 1 - time + dawn) * DAY_LENGTH;
}

/**
 * One line for somebody who has just walked onto kept ground, which is where the whole design
 * has to become legible or it is merely unfair. Each says the thing that works, in the words a
 * player can act on without a menu.
 */
export function warningFor(haunt: Haunt): string {
  if (haunt.kind === 'wight') {
    return `Something is standing in the ${haunt.name} that no blade will touch. It keeps to this ground, and it is quicker than you.`;
  }
  return `Something very large is awake in the ${haunt.name}. You can outrun it, if you go now.`;
}
