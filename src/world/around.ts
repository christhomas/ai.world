import { PATCH, patchOf, type Patchwork } from './patchwork';
import type { Structures, Village } from './structures';
import type { TerrainSampler } from './terrain';

/**
 * What is near here, which is what the game has always meant by "the structures".
 *
 * The game layer asks a bounded world for its whole list — every village, every cave, every wreck —
 * and then filters. That reads as a small convenience and is actually the load-bearing assumption
 * of the old map: sixteen villages exist, they all exist at once, and any of them can be reached
 * from any other by looking. None of those three things is true of a country that is grown a patch
 * at a time as somebody walks into it.
 *
 * What every one of those call sites *means* is "within so many tiles of where I am standing". Once
 * that is the question being asked, it has an answer in both worlds: the bounded one filters the
 * list it already has, and the endless one asks the patches it has grown. So this is the seam — an
 * interface the game can hold, and two ways of satisfying it, neither of which the game has to know
 * about.
 *
 * The reach is not optional anywhere here, and that is the point. A caller that wants "the nearest
 * village" has to say how far it is willing to walk to find one, because in an endless world there
 * is always another village somewhere and the honest answer to "the nearest one" can be nothing at
 * all. Being made to write the distance down is the whole value of this change.
 */

/**
 * Somewhere with a name and a position, which is what a cave, a wreck and a point of interest have
 * in common and all that any caller asking "what is near here" has ever wanted from one.
 *
 * A `Poi` carries the structure it was built from and a `Site` carries an id; neither matters to
 * the question, so neither is in the answer. A caller that needs the rest can go back to the list
 * it came from — but none of the ten that prompted this does.
 */
export interface Place {
  name: string;
  x: number;
  z: number;
}

export interface Around {
  /** Villages within `reach` tiles of a point, nearest first. */
  villages(x: number, z: number, reach: number): Village[];
  /**
   * The nearest village within `reach`, or nothing.
   *
   * Nothing is a real answer rather than an edge case: out at sea, deep in a forest province or on
   * a patch that has not been grown, there is no village near enough to be the one that hears about
   * a stolen cow.
   */
  nearestVillage(x: number, z: number, reach: number): Village | null;
  /** Caves, wrecks and points of interest within `reach`, nearest first. */
  places(x: number, z: number, reach: number): Place[];
}

const nearer = (x: number, z: number) => (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z);

const within = <T extends { x: number; z: number }>(all: readonly T[], x: number, z: number, reach: number): T[] =>
  all.filter((it) => Math.hypot(it.x - x, it.z - z) <= reach).sort(nearer(x, z));

/** Everything a sampler knows about, filtered to what is near a point. */
function aroundStructures(structures: Structures): Around {
  return {
    villages: (x, z, reach) => within(structures.villages, x, z, reach),
    nearestVillage: (x, z, reach) => within(structures.villages, x, z, reach)[0] ?? null,
    places: (x, z, reach) => within([...structures.pois, ...structures.caves, ...structures.wrecks], x, z, reach),
  };
}

/**
 * The bounded world's answer: it has the whole country in one object, so this is a filter.
 *
 * Kept rather than deleted when the endless world arrives, because a dungeon floor, an interior and
 * every test in the suite is a small bounded world and always will be.
 */
export function aroundOf(structures: Structures): Around {
  return aroundStructures(structures);
}

/**
 * The endless world's answer: ask the patches that have been grown.
 *
 * A patch is 512 tiles square and holds a country of its own, so what is near a point lives in the
 * patch it is in and in the ones it touches — `patchesNear` says which. Patches that have not been
 * grown are not grown to answer this: a question about what is near you must never cost five
 * seconds of country, so what has not arrived yet simply is not there yet. That is the honest
 * answer in a world where the ground ahead of you is still being made.
 */
export function aroundPatches(patches: Patchwork): Around {
  const samplers = (x: number, z: number, reach: number): TerrainSampler[] => {
    const out: TerrainSampler[] = [];
    // every patch a circle of this reach could touch, which for any sane reach is the one you are
    // standing in and its neighbours. Named rather than grown: a patch that is not held yet is a
    // patch nobody has walked into, and asking about the country near you must never cost the five
    // seconds it takes to make some
    const px = Math.floor(x / PATCH), pz = Math.floor(z / PATCH);
    const span = Math.max(1, Math.ceil(reach / PATCH));
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const name = `${px + dx},${pz + dz}`;
        if (patches.has(name)) out.push(patches.patch(name));
      }
    }
    return out;
  };
  const all = (x: number, z: number, reach: number): Structures[] =>
    samplers(x, z, reach).map((s) => s.structures);

  return {
    villages: (x, z, reach) => within(all(x, z, reach).flatMap((s) => s.villages), x, z, reach),
    nearestVillage: (x, z, reach) =>
      within(all(x, z, reach).flatMap((s) => s.villages), x, z, reach)[0] ?? null,
    places: (x, z, reach) => within(
      all(x, z, reach).flatMap((s) => [...s.pois, ...s.caves, ...s.wrecks]), x, z, reach,
    ),
  };
}

/**
 * Somewhere worth walking to: near enough to be this village's business, far enough to be a journey.
 *
 * Written twice before this existed — once in `pub.ts` for the talk in the room, once in
 * `rescue.ts` for where the trouble is — with the same two bounds for the same reason. A place
 * inside the near bound is the village itself and is not news; one beyond the far bound belongs to
 * somebody else's village and is not their business.
 *
 * The distance is handed back because both callers want it: one to say "a day north of here" and
 * the other to decide whether anybody will walk that far for the money.
 */
export function placesBetween(
  around: Around, at: { x: number; z: number }, nearest: number, reach: number,
): Array<Place & { d: number }> {
  return around.places(at.x, at.z, reach)
    .map((place) => ({ ...place, d: Math.hypot(place.x - at.x, place.z - at.z) }))
    .filter((place) => place.d > nearest);
}