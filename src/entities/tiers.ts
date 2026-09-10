import { WORLD } from '../core/config';
import type { Entity, Herd } from './entity';
import { ACTIVE_RANGE, SPAWN_RADIUS, WATCH_RANGE } from './spawning';
import { catchUp, type Away } from './unwatched';

/**
 * What being near a player decides: which creatures are thought for, which are merely held, and
 * which are not the world's business at all this tick.
 *
 * C1 measured the tiers before anybody wrote them and came back with two numbers that decide the
 * shape of this file. A live agent costs 4 to 12 microseconds a tick. An agent past `ACTIVE_RANGE`
 * cost 3.4 — a discount rather than an exemption, because freezing meant a skipped *mind* and not a
 * skipped *body*: it was still walked past by the separation sweep and still walked past once per
 * player by the thing that says what is in sight. **Frozen has to mean off those lists, not off one
 * branch inside them**, and taking something off a list is not something a branch can do. So the
 * lists are built here, once a tick, and handed to the passes that used to build their own.
 *
 * ## The three tiers, said plainly
 *
 * - **Live** — within `ACTIVE_RANGE` of somebody. Its mind runs, its body is held apart from its
 *   neighbours, and whoever can see it is told where it is. Exactly what it has always been; this
 *   file changes nothing about a creature a player is looking at, which is the one thing it must
 *   not do.
 * - **Coarse** — further off than that but inside `WATCH_RANGE`. Nobody thinks for it, so it does
 *   not move; but a player can see further than a creature is thought from, so it stays on the list
 *   of what people are told about and stands there in plain view. This is the tier that is *not* a
 *   slower tick. Nothing is stepped at any rate at all.
 * - **Frozen** — past `WATCH_RANGE`, or, much more often, not in the world at all: its chunk has
 *   been let go, or its whole province is a file on a disk. It costs what a thing that is not there
 *   costs. What picks it up again is the ground handing its chunk back — `arrive` below — and the
 *   week nobody was there for is one calculation rather than a week of ticks.
 *
 * Which leaves one honest gap, and it is deliberate. A creature that goes past `WATCH_RANGE` while
 * a player walks off, and is still there when they walk back, is simply where they left it: nothing
 * banks the minutes and nothing catches it up. It could have been done and it would have been
 * wrong. The world is holding that creature the whole time — a page draws every creature its own
 * manager has spawned, not only the ones a server would describe — so putting it somewhere new is
 * putting it somewhere new *in front of somebody*. The only absence it is safe to account for is
 * the one nothing could have been drawing during, and that absence is exactly the one a province
 * file measures.
 *
 * ## Why the catch-up happens where a herd is *born* rather than where a province wakes
 *
 * This was the surprise, and it is worth writing down because the obvious wiring does not work. The
 * three pieces C2 was left — `catchUp`, `homelandsOf` and `SharedWorld.asleep` — read as "when a
 * province wakes, gather its herds and catch them all up". But a province is read off the disk when
 * a player comes within `KEEP_READY` (144 tiles) and its chunks are not spawned until they are
 * within `SPAWN_RADIUS` (64 tiles), so at the moment a province wakes **it has no herds yet**.
 * Waiting and sweeping for them costs a walk over every creature in the world on every tick for
 * ever, which is precisely the per-tick cost C1 says a coarse tier must not have.
 *
 * Doing it at birth costs nothing, needs no memory of which herds have already been dealt with, and
 * has a property the sweep could never have: **a herd is caught up before anybody has been told it
 * exists**, so a creature cannot be seen to jump. That is the whole reason a creature already
 * standing in a loaded province is left alone rather than caught up when a player wanders back
 * towards it — somebody may well be watching it, and the closed form is entitled to move a herd the
 * length of its leash.
 */

/** As much of somebody standing on the country as any of this needs. */
export interface Standing {
  readonly x: number;
  readonly z: number;
}

/** Everything a herd handed back by the ground needs to know about the moment it is handed back. */
export type Arrival = Omit<Away, 'seconds'>;

/**
 * The tick's three lists, sorted afresh from where everybody is standing.
 *
 * An object with arrays in it rather than three returned arrays, and it is reused between ticks
 * rather than rebuilt, because this is the hottest thing in the game: ten times a second over every
 * creature the world is holding. A few hundred entries of garbage a tick would not be fatal and it
 * would be visible in a bench measured in microseconds an agent, which is the bench this file
 * exists to move.
 */
export class Tiers {
  /** Near enough to somebody to be thought for. The order is the order the chunks are filed in. */
  readonly live: Entity[] = [];
  /**
   * Live and coarse together: everything near enough that somebody could be told about it.
   *
   * A superset of `live`, deliberately, so that whoever answers "what can this player see" has one
   * list to walk rather than two to stitch together.
   */
  readonly watched: Entity[] = [];
  /**
   * The herds `live` belongs to.
   *
   * The separation sweep wants these rather than the creatures: its last pass is what keeps a herd
   * from standing inside itself, and it is square in the herd's size. Running it for every herd in
   * the world was one of the three quadratic costs C1 found, and running it for a herd nobody is
   * thinking for is pushing motionless bodies apart from each other.
   */
  readonly liveHerds = new Set<Herd>();

  /**
   * Sort everything the world is holding, by how far it is from the nearest person.
   *
   * The focus is separate from the rest for the reason it is separate everywhere else in the
   * manager: a game has one hero and a server has as many heroes as it has players, and the
   * cheapest check is the one against whoever this manager is following.
   */
  sort(filed: Iterable<Entity[]>, focusX: number, focusZ: number, alsoNear: ReadonlyArray<Standing>): void {
    this.live.length = 0;
    this.watched.length = 0;
    this.liveHerds.clear();
    const live2 = ACTIVE_RANGE * ACTIVE_RANGE, watch2 = WATCH_RANGE * WATCH_RANGE;
    for (const list of filed) {
      for (const e of list) {
        let near2 = (e.x - focusX) ** 2 + (e.z - focusZ) ** 2;
        for (const who of alsoNear) {
          if (near2 <= live2) break;
          const d2 = (e.x - who.x) ** 2 + (e.z - who.z) ** 2;
          if (d2 < near2) near2 = d2;
        }
        if (near2 > watch2) continue;
        this.watched.push(e);
        if (near2 > live2) continue;
        this.live.push(e);
        this.liveHerds.add(e.herd);
      }
    }
  }
}

/**
 * Whether a chunk is near anybody at all: the one this manager follows, or another player.
 *
 * Here rather than in the manager because it is the same question as the one above asked of a
 * square of ground instead of a creature, and the pair of them is what the whole tier scheme is:
 * how far from a person a thing is decides what the world does about it. A chunk that fails this is
 * let go, which is how a creature reaches the frozen tier that costs nothing — there is no cheaper
 * thing to be than absent.
 */
export function worthKeeping(
  kx: number, kz: number, cx: number, cz: number, alsoNear: ReadonlyArray<Standing>,
): boolean {
  if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) <= SPAWN_RADIUS + 1) return true;
  const CS = WORLD.CHUNK_SIZE;
  for (const who of alsoNear) {
    const ox = Math.floor(who.x / CS), oz = Math.floor(who.z / CS);
    if (Math.max(Math.abs(kx - ox), Math.abs(kz - oz)) <= SPAWN_RADIUS + 1) return true;
  }
  return false;
}

/**
 * A piece of ground has just been handed back with creatures on it. Account for the time away.
 *
 * The join, and it is three lines of work: ask how long this herd's ground was nobody's business,
 * and if the answer is more than nothing hand it and the herd to the closed forms. `sleptFor` is
 * how the answer gets in — on a server it is `SharedWorld.asleep(provinceOfHome(herd))`, and in a
 * world nobody has told it is nought, which means nothing is caught up and nothing is invented.
 *
 * Every creature here was made a moment ago by `spawnChunk`, from the world seed and the chunk, so
 * the herds are standing where they were founded and not where a week of grazing would have left
 * them. Members of one herd arrive together but not always contiguously — a village puts several
 * herds down in one chunk — so the herds are gathered rather than assumed.
 *
 * Only ground-grown creatures ever get here, and that is by construction rather than by a check:
 * this is called from the chunk spawner, and a dungeon floor, a sea pack and a roaming band are all
 * *placed* when somebody arrives and taken away when they leave. `homeland.ts` is where that line is
 * drawn and why; the rule it states — only chunk-keyed lists have a province — is the same rule
 * that decides who can be caught up, because a week is a province's to account for.
 */
export function arrive(born: ReadonlyArray<Entity>, sleptFor: (herd: Herd) => number, when: Arrival): number {
  let placed = 0;
  const done = new Set<Herd>();
  for (const e of born) {
    if (done.has(e.herd)) continue;
    done.add(e.herd);
    const seconds = sleptFor(e.herd);
    if (seconds <= 0) continue;
    placed += catchUp(e.herd, { ...when, seconds }).placed;
  }
  return placed;
}
