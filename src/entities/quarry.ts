import { BEHAVIOUR, type Entity } from './entity';
import { PERSON_KINDS } from './properties';

/**
 * Who is worth going for.
 *
 * Three questions get asked of a crowd every time anything decides what to do next: what is worth
 * hunting, who is worth eating, and who is presently in trouble. They are the same shape — walk a
 * list, keep the nearest that passes a test — and the only thing that separates them is the test,
 * so they live together and are written the same way.
 *
 * They take the crowd rather than fetching it, which is what makes them answerable without a
 * world: given a handful of creatures and somebody to ask on behalf of, the answer is fixed.
 */

/**
 * Kinds that count as people: what a predator prefers, what a constable protects, and what it is
 * murder rather than hunting to kill.
 *
 * Whoever is in `properties/people.json`, and never a list written out here. It was written out
 * here — `villager`, `traveller`, `shopkeeper`, `hero` — and the night the trades got bodies of
 * their own that list quietly stopped being true: seven new sorts of person appeared in the file
 * and none of them in this set, which made a priest fair game for a hunter's arrow and a miner
 * killed at his face nobody's death to report.
 */
export const PEOPLE: ReadonlySet<string> = PERSON_KINDS;

/** The nearest of `near` that `wanted` accepts, measured from `from`, or null if none will do. */
function closest(from: Entity, near: readonly Entity[], wanted: (e: Entity) => boolean): Entity | null {
  let best: Entity | null = null;
  let bestAway = Infinity;
  for (const e of near) {
    if (e === from || e.dead || !wanted(e)) continue;
    const away = Math.hypot(e.x - from.x, e.z - from.z);
    if (away < bestAway) { bestAway = away; best = e; }
  }
  return best;
}

/**
 * The nearest wild animal worth a hunter's arrow: something that can be killed, is not a person,
 * and is not something that would rather kill them.
 */
export function nearestQuarry(from: Entity, near: readonly Entity[]): Entity | null {
  return closest(from, near, (e) =>
    Boolean(e.kind.hp) && !PEOPLE.has(e.kind.id) && !(e.kind.dangerous ?? 0));
}

/**
 * The nearest beast this village keeps, not counting the one somebody is already standing over.
 *
 * What a farmer walks between all morning. `beyond` is the whole of it: without it he reaches the
 * nearest cow and stands there for the rest of the day, because it goes on being the nearest cow.
 * Skipping whatever is already within arm's reach makes him choose a different one each time he
 * arrives, and choosing the nearest of the rest is what turns that into a round of the herd rather
 * than a walk across the field and back.
 *
 * `owned` is what separates a farmer's cow from a deer, and the herd's tag is what separates his
 * cattle from the next village's. A beast belonging to nobody — a mountain goat, a wild plains cow
 * — is not his to tend, and the plains are full of them.
 */
export function nearestStock(from: Entity, near: readonly Entity[], beyond: number): Entity | null {
  return closest(from, near, (e) =>
    Boolean(e.kind.owned) && e.herd.tag !== '' && e.herd.tag === from.herd.tag
    && Math.hypot(e.x - from.x, e.z - from.z) > beyond);
}

/** The nearest person: somebody a wolf would rather have than a rabbit. */
export function nearestPerson(from: Entity, near: readonly Entity[]): Entity | null {
  return closest(from, near, (e) => !e.indoors && PEOPLE.has(e.kind.id));
}

/**
 * The nearest creature presently going for somebody: what a constable comes running about.
 *
 * A creature with nothing marked is coming for the hero, which is markPrey's convention, so the
 * hero's own position has to be passed in. Without that clause the only fight anybody ever breaks
 * up is one they are not in: a hired sword walks past the wolf that is on you, and so does a
 * constable.
 */
export function nearestTrouble(
  from: Entity, near: readonly Entity[], heroX: number, heroZ: number,
): Entity | null {
  return closest(from, near, (e) => {
    if (!(e.kind.dangerous ?? 0)) return false;
    return e.target
      ? !e.target.dead && PEOPLE.has(e.target.kind.id)
      : Math.hypot(e.x - heroX, e.z - heroZ) <= BEHAVIOUR.STALK_RADIUS;
  });
}
