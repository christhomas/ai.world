import type { DatabaseSync } from 'node:sqlite';
import { KEEPS, type Entry } from '../chronicle';
import type { Change } from '../../src/world/register';

/**
 * The parish book: meaningful changes the register reports, kept through a server restart.
 *
 * This is deliberately not a general event log. `Register.advance` already decides what belongs
 * in a Chronicle — births, deaths, a village being lost and its resettlement — and movement or
 * tick noise never reaches this module. The same bound applies on disk as in memory, so durability
 * cannot quietly turn a thousand-entry window into a table that grows for the life of the server.
 */
export const EVENTS_SCHEMA: readonly string[] = [
  `CREATE TABLE chronicle_event (
     world    INTEGER NOT NULL,
     n        INTEGER NOT NULL,
     happened INTEGER NOT NULL,
     entry    TEXT    NOT NULL,
     PRIMARY KEY (world, n)
   );
   CREATE INDEX chronicle_event_by_world_time ON chronicle_event(world, happened);`,
];

/** The part stored as JSON; cursor and wall-clock columns stay queryable and authoritative. */
function changeOf(entry: Entry): Change {
  const { at: _at, n: _n, ...change } = entry;
  return change;
}

/**
 * Append one turn of the register and prune its world in the same transaction.
 *
 * If either statement fails, neither is visible. A caller can therefore persist before publishing
 * in memory without risking a book whose two copies disagree after an interrupted write.
 */
export function keepEvents(db: DatabaseSync, world: number, entries: readonly Entry[]): number {
  if (entries.length === 0) return 0;
  const put = db.prepare('INSERT INTO chronicle_event (world, n, happened, entry) VALUES (?, ?, ?, ?) '
    + 'ON CONFLICT(world, n) DO UPDATE SET happened = excluded.happened, entry = excluded.entry');
  const prune = db.prepare('DELETE FROM chronicle_event WHERE world = ? AND n NOT IN '
    + '(SELECT n FROM chronicle_event WHERE world = ? ORDER BY n DESC LIMIT ?)');
  db.exec('BEGIN');
  try {
    for (const entry of entries) put.run(world, entry.n, entry.at, JSON.stringify(changeOf(entry)));
    prune.run(world, world, KEEPS);
    db.exec('COMMIT');
  } catch (why) {
    db.exec('ROLLBACK');
    throw why;
  }
  return entries.length;
}

/**
 * Restore one bounded world, leaving malformed rows in place and naming their cursors.
 *
 * A bad row must not make every valid neighbour disappear, and deleting evidence while reading it
 * would make recovery harder. The simulation says the returned cursor numbers aloud to stderr.
 */
export function eventsOf(
  db: DatabaseSync, world: number,
): { entries: Entry[]; unreadable: number[]; latest: number } {
  const entries: Entry[] = [];
  const unreadable: number[] = [];
  let latest = 0;
  const rows = db.prepare('SELECT n, happened, entry FROM chronicle_event WHERE world = ? ORDER BY n').all(world);
  for (const row of rows) {
    const said = row as unknown as { n: number; happened: number; entry: string };
    latest = Math.max(latest, Number(said.n));
    try {
      const parsed: unknown = JSON.parse(said.entry);
      if (!isChange(parsed)) {
        unreadable.push(Number(said.n));
        continue;
      }
      entries.push({ ...(parsed as Change), at: Number(said.happened), n: Number(said.n) });
    } catch { unreadable.push(Number(said.n)); }
  }
  return { entries, unreadable, latest };
}

function isChange(value: unknown): value is Change {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const change = value as Partial<Change>;
  return (change.kind === 'born' || change.kind === 'died'
      || change.kind === 'lost' || change.kind === 'resettled')
    && typeof change.id === 'string'
    && typeof change.name === 'string'
    && typeof change.village === 'string'
    && typeof change.day === 'number'
    && Number.isFinite(change.day)
    && (change.cause === undefined || change.cause === 'age'
      || change.cause === 'violence' || change.cause === 'hunger')
    && (change.from === undefined || typeof change.from === 'string');
}
