import type { DatabaseSync } from 'node:sqlite';
import { migrateDomain } from '../durable/db';
import { carriesASecret, type Recorded } from './asked';

/**
 * What the builder was asked to do, who asked, and what came of it.
 *
 * A route that runs Claude with somebody's words and edits files in a repository is a route that
 * has to be able to answer *"who changed this, and when"* six months later. Nothing else here
 * would: the run itself is transient, the edits land in a worktree, and the only record would be
 * whatever somebody remembered.
 *
 * In the same database as the accounts and the villagers' memories, as its own domain — see
 * `durable/db.ts` for why one file with a schema row each rather than three files or one counter.
 */

const SCHEMA: readonly string[] = [
  // 1 — one row per run of the builder
  `CREATE TABLE builder_run (
     id      TEXT PRIMARY KEY,
     who     TEXT NOT NULL,
     asked   INTEGER NOT NULL,
     about   TEXT NOT NULL,
     length  INTEGER NOT NULL,
     changed TEXT NOT NULL,
     ok      INTEGER NOT NULL,
     note    TEXT NOT NULL
   );
   CREATE INDEX builder_run_by_time ON builder_run(asked);`,
];

export function migrateBook(db: DatabaseSync): number {
  return migrateDomain(db, 'builder', SCHEMA);
}

/**
 * Write a run down.
 *
 * Refuses a record that carries something shaped like a credential rather than writing it and
 * hoping nobody looks. The issue asks for this in as many words — *"without recording JWTs or
 * secrets"* — and a rule enforced at the door is a rule that holds when somebody adds a field in a
 * hurry, where a rule in a comment is a comment.
 *
 * Throwing rather than quietly dropping the field: a record that cannot be written safely is a bug
 * in whatever built it, and it should be found in a test rather than discovered as a gap in the
 * book a year later.
 */
export function writeDown(db: DatabaseSync, id: string, record: Recorded): void {
  if (carriesASecret(record)) {
    throw new Error('the builder record carries something shaped like a credential; it was not written');
  }
  db.prepare('INSERT INTO builder_run (id, who, asked, about, length, changed, ok, note) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET '
    + 'changed = excluded.changed, ok = excluded.ok, note = excluded.note')
    .run(id, record.who, record.when, record.about, record.length,
      JSON.stringify(record.changed), record.ok ? 1 : 0, record.note);
}

/** The last few runs, newest first, for somebody reading the portal rather than the database. */
export function lastRuns(db: DatabaseSync, many = 20): Recorded[] {
  return db.prepare('SELECT who, asked, about, length, changed, ok, note FROM builder_run '
    + 'ORDER BY asked DESC LIMIT ?').all(many).map((row) => {
    const said = row as unknown as {
      who: string; asked: number; about: string; length: number; changed: string; ok: number; note: string;
    };
    let changed: string[] = [];
    try {
      const parsed: unknown = JSON.parse(said.changed);
      if (Array.isArray(parsed)) changed = parsed as string[];
    } catch { changed = []; }
    return {
      who: said.who, when: said.asked, about: said.about, length: said.length,
      changed, ok: said.ok === 1, note: said.note,
    };
  });
}
