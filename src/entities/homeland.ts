import { provinceOfHome, type ProvinceId } from '../world/provinces';
import { parseChunkKey } from '../world/spatial';
import type { Entity, Herd } from './entity';

/**
 * Which of the things in the world belongs to a province, and to which one.
 *
 * Kept apart from the manager for the reason `chunkspots.ts` is: it is about where a creature
 * *belongs* rather than about what it does, it is the sort of question somebody comes looking for
 * on its own, and the manager is already the longest thing in the game.
 *
 * ## Not everything has a province, and pretending otherwise is the trap
 *
 * `provinceOf(e.x, e.z)` answers for anything with two coordinates, which is exactly why it is the
 * wrong question. A rat on the third floor of a vault has an x and a z, they are the floor's own
 * numbers and have nothing to do with the country overhead, and asking that of it files it under
 * whatever open field happens to share them. So the question is asked of the *filing* instead —
 * the manager already keys what it holds by the chunk it was spawned from, or by the name of the
 * place it was put in — and only the chunk-keyed lists have a province at all.
 *
 * What that draws the line around, and why each side is where it is:
 *
 * - **Herds the ground grew** — wildlife, night packs, the people of a village, what stands in a
 *   paddock, somebody on a road — are the province's. They are rolled from the seed and the chunk,
 *   they are put down whether or not anybody is coming, and they go on existing in the sense that
 *   matters after the last player has walked away: come back in a week and the same field has to
 *   hold something plausible. Somebody has to account for that week, and the province is who.
 * - **A dungeon floor** is not. It is a world of its own with its own coordinates, it is grown when
 *   the first person walks down the stair and dropped when the last one leaves, and nothing is kept
 *   for a floor that has been explored. It never sleeps, so it has no absence to account for.
 * - **A sea pack, a roaming band's pack, a mine crew** are not, for the same reason from the other
 *   direction: each is *placed* — around a player who has gone out of his depth, at wherever
 *   `bandAt` says a band is today, at the face a crew is working — and taken away again when he
 *   leaves. A band is already the thing C3 asks for and was before C3: where it is comes out of the
 *   seed and the day, so it arrives somewhere on a schedule and never walks a step in between.
 * - **The hero, and every other player**, are not, and that is not an oversight. A player is
 *   *watched*. He genuinely walks, over borders included, and `keepNear` deliberately holds both
 *   provinces around him while he does. Being in two at once is what being looked at costs, and it
 *   is affordable precisely because there are a handful of players and thousands of everything else.
 */

/**
 * Does this filing key name a piece of ground, or a place?
 *
 * A chunk key is two numbers; every other key in the manager is a word — `dungeon`, `sea`, a band's
 * id, the mine. Reading it back rather than keeping a flag beside it, because the key is already
 * the thing that decides, and a flag would be a second answer that can disagree with the first.
 */
export function grewFromTheGround(key: string): boolean {
  const [cx, cz] = parseChunkKey(key);
  return Number.isFinite(cx) && Number.isFinite(cz);
}

/**
 * Every herd that belongs to a province, gathered under the province it belongs to.
 *
 * The seam the coarse tier wants: this says whose a herd is, `SharedWorld.asleep` says for how long
 * nobody was looking, and `catchUp` in `unwatched.ts` takes the two and is done. None of the three
 * knows about the other two, which is the point — C2a decides when, and nothing else has to.
 *
 * A herd appears exactly once however many of its members are in the list, and a herd whose members
 * were somehow filed under two chunks would still appear once, under the one province its home is
 * in. That is the whole claim: never both, and — since every herd the ground grows is anchored
 * inside the chunk it was rolled from — never neither.
 */
export function homelandsOf(filed: ReadonlyMap<string, Entity[]>): Map<ProvinceId, Herd[]> {
  const out = new Map<ProvinceId, Herd[]>();
  const seen = new Set<Herd>();
  for (const [key, list] of filed) {
    if (!grewFromTheGround(key)) continue;
    for (const e of list) {
      if (seen.has(e.herd)) continue;
      seen.add(e.herd);
      const id = provinceOfHome(e.herd);
      const here = out.get(id);
      if (here) here.push(e.herd);
      else out.set(id, [e.herd]);
    }
  }
  return out;
}

/** The herds one province is answerable for, and nobody else's. */
export function herdsIn(filed: ReadonlyMap<string, Entity[]>, id: ProvinceId): Herd[] {
  return homelandsOf(filed).get(id) ?? [];
}
