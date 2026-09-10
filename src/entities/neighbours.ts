import type { Entity } from './entity';

/**
 * Who else is standing about here.
 *
 * Two questions, asked from all over the game: everything within so many tiles of a point, and the
 * single closest thing to it. A blow measures its arc against the first; a hunter looks for
 * something to chase in it; the console's `entities` prints it; a person walking into a doorway
 * asks the second whether somebody is already in it.
 *
 * Out of the manager because they are questions about a crowd rather than about running one, and
 * because of what C1 found: **this is one of the three quadratic costs in the tick.** `within` is a
 * plain scan over everything the world is holding, and a hunter asks it once a step — so a hundred
 * hunters in a world of two thousand creatures is two hundred thousand distance sums a tick, which
 * grows as the square of how thickly they stand rather than with how many there are.
 *
 * It is deliberately left as a scan for now, and the reason is worth recording so that whoever
 * fixes it does not have to find it again. The obvious narrowing is to walk only the chunks near
 * the point, since the manager already files creatures by the chunk they were spawned from — but a
 * creature is not bound to that chunk. A herd's anchor drifts a leash away, a traveller's leash is
 * thirty tiles, and a villager of a hub stands at posts and ranges about them out to seventy-six
 * (which is the measurement that set the floor under `PROVINCE_REACH`). So the pad is most of the
 * window, and doing it properly wants a bound carried per herd rather than guessed per kind.
 * `Tiers` in `tiers.ts` is the cheap half of the same idea and was worth doing first: it narrows
 * the two passes that run over *everything* every tick, where this one runs over everything only
 * for the few creatures that are hunting.
 */

/**
 * Everything alive within `r` tiles of a point, nearest first.
 *
 * The dead are left out here rather than at each of the dozen places that ask, because a body now
 * stays in the world while it falls: without this you could talk to a corpse, hand it a gift, hire
 * it, or have it answer Enter in front of the person standing behind it. Anything that genuinely
 * wants a body wants a carcass, which is a different list.
 *
 * @param guests creatures somebody else owns — drawn and found here, but never thought for here.
 */
export function within(
  filed: Iterable<Entity[]>, guests: Iterable<Entity>, x: number, z: number, r: number,
): Entity[] {
  const hits: Array<{ e: Entity; d: number }> = [];
  const near = (e: Entity): void => {
    if (e.dead) return;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d <= r) hits.push({ e, d });
  };
  for (const list of filed) for (const e of list) near(e);
  for (const e of guests) near(e);
  return hits.sort((a, b) => a.d - b.d).map((h) => h.e);
}

/**
 * The closest creature within `r` tiles of a point, or nobody.
 *
 * Anyone indoors is not there to talk to, which is the one way this differs from taking the head of
 * `within`: a shopkeeper behind their own door is in the world and is not in the street. It also
 * does not sort, because the question has one answer.
 */
export function nearest(filed: Iterable<Entity[]>, x: number, z: number, r: number): Entity | null {
  let best: Entity | null = null, bestD = r * r;
  for (const list of filed) {
    for (const e of list) {
      if (e.indoors || e.dead) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
  }
  return best;
}
