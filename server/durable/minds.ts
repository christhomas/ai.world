import type { DatabaseSync } from 'node:sqlite';
import type { Memory, Person } from '../../src/world/people';
import type { Opinion } from '../../src/world/memory';

/**
 * What a villager holds that no seed implies, kept across a restart.
 *
 * Everything else about a village is worked out again on every machine that looks at it: who lives
 * there, what they do, when they die, who their parents were. `remembering.ts` says why this half
 * cannot be — *"what a man thinks of you follows from what you did, and what you did happened on
 * your screen"*. It was held only in the server's memory, so every restart wiped every villager's
 * opinion of every player, and nothing anywhere said so.
 *
 * ## One row per villager who has met anybody
 *
 * Not one per villager. A world has thousands of people in it and almost none of them have ever
 * met a player; a row for each would be a table that grows with the map rather than with the
 * playing. A villager whose memories and opinions are both empty has its row deleted rather than
 * written, so the table stays the size of what has actually happened.
 *
 * That is also what bounds it. `memory.ts` already compacts a villager's own list — ten slights
 * become one opinion, and the list is capped — so a row cannot grow without limit either.
 *
 * ## Written whole, per villager
 *
 * The alternative is an event log to replay, and it is the wrong shape here for the reason the
 * compaction exists: what a villager holds is *already* a summary, deliberately lossy, and
 * replaying the events it was made from would rebuild something the game has decided to forget.
 * The world's own told-facts log is the thing that replays; this is the thing that does not.
 */

/**
 * The tables, exported rather than migrated here, and that is load-bearing.
 *
 * `sim.ts` imports this file, and `sim.ts` is what a page playing alone runs in a Web Worker. A
 * value import of `node:sqlite` anywhere in that chain is a browser bundle that reaches for a node
 * built-in — Vite externalises it, the page throws on load, and the whole world stops drawing. The
 * playtest caught exactly that.
 *
 * Everything this file does with a database is typed against a handle it is *given*, so `DatabaseSync`
 * is a type import and erases. What could not be is the migration, which has to call into `db.ts`
 * for real — so the schema comes out and `serve.ts`, which is only ever node, runs it.
 */
export const MINDS_SCHEMA: readonly string[] = [
  // 1 — what one villager of one world holds
  `CREATE TABLE mind (
     world    INTEGER NOT NULL,
     villager TEXT    NOT NULL,
     memories TEXT    NOT NULL,
     opinions TEXT    NOT NULL,
     kept     INTEGER NOT NULL,
     PRIMARY KEY (world, villager)
   );
   CREATE INDEX mind_by_world ON mind(world);`,
];

/** What one villager holds, as it goes on and off the disk. */
export interface Mind {
  memories: Memory[];
  opinions: Opinion[];
}

/** Whether this villager holds anything worth keeping, which most of them never will. */
export function holdsAnything(person: Pick<Person, 'memories' | 'opinions'>): boolean {
  return (person.memories?.length ?? 0) > 0 || (person.opinions?.length ?? 0) > 0;
}

/**
 * Write down what these people hold, and forget the ones who hold nothing.
 *
 * One transaction for the lot. A restart in the middle of a save must not leave half a village
 * remembering you and half of it not — that is worse than losing all of it, because it is a village
 * that disagrees with itself and nobody would ever work out why.
 *
 * The delete is as important as the insert: somebody whose last memory has faded should stop having
 * a row, or the table only ever grows and the compaction upstream is undone by the storage.
 */
export function keepMinds(
  db: DatabaseSync, world: number, people: Iterable<Person>, now = Date.now(),
): { kept: number; forgotten: number } {
  const put = db.prepare(
    'INSERT INTO mind (world, villager, memories, opinions, kept) VALUES (?, ?, ?, ?, ?) '
    + 'ON CONFLICT(world, villager) DO UPDATE SET memories = excluded.memories, '
    + 'opinions = excluded.opinions, kept = excluded.kept');
  const drop = db.prepare('DELETE FROM mind WHERE world = ? AND villager = ?');
  let kept = 0, forgotten = 0;
  db.exec('BEGIN');
  try {
    for (const person of people) {
      if (holdsAnything(person)) {
        put.run(world, person.id, JSON.stringify(person.memories ?? []),
          JSON.stringify(person.opinions ?? []), now);
        kept++;
      } else {
        const said = drop.run(world, person.id);
        if (Number(said.changes) > 0) forgotten++;
      }
    }
    db.exec('COMMIT');
  } catch (why) {
    db.exec('ROLLBACK');
    throw why;
  }
  return { kept, forgotten };
}

/** Forget one person who has actually departed, without sweeping villages not yet settled. */
export function forgetMind(db: DatabaseSync, world: number, villager: string): boolean {
  const said = db.prepare('DELETE FROM mind WHERE world = ? AND villager = ?').run(world, villager);
  return Number(said.changes) > 0;
}

/**
 * Everything this world's villagers hold, by villager id.
 *
 * A row whose JSON will not parse is dropped rather than thrown over, and that is deliberate: the
 * one thing worse than a villager who has forgotten you is a server that will not start because of
 * one. The count of what was unreadable comes back so the caller can say so out loud instead of
 * losing it quietly — which is the whole complaint behind #129 and #135 in another coat.
 */
export function mindsOf(db: DatabaseSync, world: number): { minds: Map<string, Mind>; unreadable: string[] } {
  const minds = new Map<string, Mind>();
  const unreadable: string[] = [];
  for (const row of db.prepare('SELECT villager, memories, opinions FROM mind WHERE world = ?').all(world)) {
    const said = row as unknown as { villager: string; memories: string; opinions: string };
    try {
      const memories: unknown = JSON.parse(said.memories);
      const opinions: unknown = JSON.parse(said.opinions);
      if (!Array.isArray(memories) || !Array.isArray(opinions)) { unreadable.push(said.villager); continue; }
      minds.set(said.villager, { memories: memories as Memory[], opinions: opinions as Opinion[] });
    } catch { unreadable.push(said.villager); }
  }
  return { minds, unreadable };
}

/**
 * What was kept, waiting to be given back to the people it belongs to.
 *
 * It cannot simply be handed over when the world opens, and that is the thing worth writing down:
 * **the register has settled no villages at that moment.** A village is lived when somebody walks
 * into it, so the roll is empty for a while and grows as the world is explored — a restore done
 * once at boot puts everybody's memories into nobody.
 *
 * So this holds them and gives each villager theirs the first time that villager exists. Once each,
 * which is the other half of it: a second pass would overwrite what has happened *since* with the
 * copy from disk, so a player who was remembered at breakfast would be forgotten again at noon.
 */
export class HeldMinds {
  private readonly given = new Set<string>();

  constructor(private readonly minds: ReadonlyMap<string, Mind>) {}

  /** How many villagers are still waiting for what was kept for them. */
  get waiting(): number { return this.minds.size - this.given.size; }

  /**
   * Give these people what was kept for them, skipping anybody already given.
   *
   * A row for somebody this world has not grown yet is left waiting rather than dropped: a villager
   * can be absent because the register has not reached the day they are born on, and throwing their
   * memories away because they are not here *yet* is a loss that shows up months later, if at all.
   */
  giveTo(people: Iterable<Person>): number {
    let gave = 0;
    for (const person of people) {
      if (this.given.has(person.id)) continue;
      const held = this.minds.get(person.id);
      if (!held) continue;
      person.memories = [...held.memories];
      person.opinions = [...held.opinions];
      this.given.add(person.id);
      gave++;
    }
    return gave;
  }
}
