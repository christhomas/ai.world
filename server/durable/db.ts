import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One database for everything the server owns and cannot work out again.
 *
 * The world is still JSON and stays JSON: a seed grows the country, the villages and the people,
 * and a short log of told facts replays the rest. What cannot be replayed is what a villager thinks
 * of *you* — `remembering.ts` calls it "the one thing about a villager that is not derived" —
 * and, since the portal, who is allowed to open the tools.
 *
 * Those two are kept in one file with separate tables rather than in two files, which is what #104
 * asks for and is the right way round: they share a durable volume, a backup, a WAL and a crash,
 * and pretending they have different infrastructure would mean two of each. What they do not share
 * is ownership — `minds.ts` and `tools/accounts.ts` each declare their own schema and neither reads
 * the other's tables.
 *
 * ## Why not `user_version`
 *
 * SQLite's own schema counter is one integer per *database*, and two domains migrating against one
 * integer is two modules fighting over a number. So there is a `schema` table with a row each,
 * which costs one query at open and means a domain can be added years later without renumbering
 * anybody else's migrations.
 */

/** How far one domain's schema has been brought. */
export interface Schema {
  domain: string;
  version: number;
}

/**
 * Open the durable database, with the three settings that make it durable.
 *
 * **WAL** so a reader is never blocked by the writer and a kill mid-write leaves a file that
 * recovers rather than one that is truncated. **Foreign keys**, because a constraint the database
 * does not enforce is a comment. **A busy timeout**, so two things arriving together wait for each
 * other instead of one of them failing outright.
 *
 * `synchronous = NORMAL` rather than `FULL`, and that is the one real trade here: with WAL it means
 * a commit is safe against the process dying — which is what a container restart is — and can lose
 * the last commits only if the *machine* loses power. This is a game server on a home volume, and
 * the cost of FULL is an fsync per commit.
 */
export function openDurable(file: string): DatabaseSync {
  // the worlds' own directory is made on the first write; a database has to have somewhere to be
  // before it is opened, and making every caller remember that is how one of them forgets
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema (domain TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  return db;
}

/** How far this domain has been migrated, which is nought for one that has never been seen. */
export function versionOf(db: DatabaseSync, domain: string): number {
  const row = db.prepare('SELECT version FROM schema WHERE domain = ?').get(domain);
  return row ? Number((row as { version: number }).version) : 0;
}

/**
 * Bring one domain up to today's schema, a step at a time, each in its own transaction.
 *
 * Explicit steps rather than a file that opens itself and guesses. A database that guesses will one
 * day guess wrong on somebody's only copy, and the moment it does is the moment nobody is watching.
 *
 * Each step commits with the version it reached, so a process killed between two steps comes back
 * and runs the rest rather than either repeating one or skipping one.
 */
export function migrateDomain(db: DatabaseSync, domain: string, steps: readonly string[]): number {
  for (let step = versionOf(db, domain); step < steps.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(steps[step]);
      db.prepare('INSERT INTO schema (domain, version) VALUES (?, ?) '
        + 'ON CONFLICT(domain) DO UPDATE SET version = excluded.version').run(domain, step + 1);
      db.exec('COMMIT');
    } catch (why) {
      db.exec('ROLLBACK');
      throw why;
    }
  }
  return steps.length;
}
