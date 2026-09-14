import { DatabaseSync } from 'node:sqlite';
import { hashPassword, passwordMatches, wantsRehashing } from './passwords';
import { newSessionId, TOKEN_LASTS } from './tokens';

/**
 * Who may open the tools, and which sessions are still live.
 *
 * SQLite on the volume that is already there, which is the decision recorded on #102: this
 * deployment is one replica against a local persistent disk, so SQLite gives transactions,
 * constraints, indexes and crash-safe commits without adding a network service, a second set of
 * credentials, or another thing to back up.
 *
 * ## Kept apart from the world on purpose
 *
 * The world's state stays where it is, in JSON under `DATA_DIR`. Authentication is not a reason to
 * migrate a working persistence format, and #102 says so in as many words — that sentence is a
 * scope boundary rather than an architectural claim. Both live on the same disk; only this one is
 * in a database. When the villager register moves here too (#104) it comes as its own tables with
 * its own module, because domains are separated by schema and ownership rather than by pretending
 * they need different infrastructure.
 *
 * ## The schema has a version and migrations are explicit
 *
 * `user_version` is SQLite's own integer for this and costs nothing. A database that opens itself
 * and guesses is a database that will one day guess wrong on somebody's only copy.
 */

/** One person who may open the tools. */
export interface Account {
  id: string;
  name: string;
  /** `scrypt$N$r$p$salt$hash`. Never the password, and never reversible. */
  secret: string;
  made: number;
}

/** One live login. The row is what makes a logout mean anything; see `tokens.ts`. */
export interface Session {
  id: string;
  account: string;
  made: number;
  expires: number;
}

const SCHEMA: readonly string[] = [
  // 1 — accounts and their sessions
  `CREATE TABLE account (
     id     TEXT PRIMARY KEY,
     name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
     secret TEXT NOT NULL,
     made   INTEGER NOT NULL
   );
   CREATE TABLE session (
     id      TEXT PRIMARY KEY,
     account TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
     made    INTEGER NOT NULL,
     expires INTEGER NOT NULL
   );
   CREATE INDEX session_by_account ON session(account);
   CREATE INDEX session_by_expiry ON session(expires);`,
];

/**
 * Open the tools database, bringing it up to today's schema.
 *
 * The three settings are not decoration. **WAL** so a reader is never blocked by the writer and a
 * kill mid-write leaves a recoverable file rather than a truncated one; **foreign keys** so a
 * deleted account cannot leave its sessions behind, which is a logout that did not happen;
 * **busy_timeout** so two requests arriving together wait for each other instead of one of them
 * failing outright.
 */
export function openAccounts(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Run whatever of the schema this file has not had yet, each step in its own transaction. */
export function migrate(db: DatabaseSync): number {
  const at = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let step = at; step < SCHEMA.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA[step]);
      db.exec(`PRAGMA user_version = ${step + 1}`);
      db.exec('COMMIT');
    } catch (why) {
      db.exec('ROLLBACK');
      throw why;
    }
  }
  return SCHEMA.length;
}

/** Add somebody who may open the tools. Refuses a second account of the same name. */
export function addAccount(
  db: DatabaseSync, name: string, password: string, now = Date.now(),
): Account | null {
  const id = newSessionId();
  const secret = hashPassword(password);
  try {
    db.prepare('INSERT INTO account (id, name, secret, made) VALUES (?, ?, ?, ?)')
      .run(id, name, secret, now);
  } catch { return null; }                       // UNIQUE: somebody of that name is already here
  return { id, name, secret, made: now };
}

/** Whoever is called this, or nobody. */
export function accountNamed(db: DatabaseSync, name: string): Account | null {
  const row = db.prepare('SELECT id, name, secret, made FROM account WHERE name = ?').get(name);
  return row ? (row as unknown as Account) : null;
}

/** How many people may open the tools, which is the question the bootstrap asks. */
export function howManyAccounts(db: DatabaseSync): number {
  return Number((db.prepare('SELECT count(*) AS many FROM account').get() as { many: number }).many);
}

/**
 * A name and a password, checked.
 *
 * A missing account is checked against a throwaway hash anyway, so that "no such user" and "wrong
 * password" take the same time. Answering the first faster is how somebody learns which names are
 * worth guessing at.
 *
 * A hash made at a weaker cost than today's is re-made here, which is the only moment the password
 * is in hand to do it with.
 */
export function whoIsThis(db: DatabaseSync, name: string, password: string): Account | null {
  const account = accountNamed(db, name);
  const stored = account?.secret ?? NOBODY;
  if (!passwordMatches(password, stored) || !account) return null;
  if (wantsRehashing(stored)) {
    const remade = hashPassword(password);
    db.prepare('UPDATE account SET secret = ? WHERE id = ?').run(remade, account.id);
    return { ...account, secret: remade };
  }
  return account;
}

/**
 * A hash of nothing anybody will ever type, to be compared against when there is no account.
 *
 * Made once at load rather than per request: the point is that the *comparison* costs what a real
 * one costs, and making a fresh one each time would make the missing-account path slower than the
 * real one, which gives away exactly as much as being faster does.
 */
const NOBODY = hashPassword(newSessionId());

/** Start a session, and say when it ends. */
export function beginSession(db: DatabaseSync, account: string, now = Date.now()): Session {
  const session: Session = {
    id: newSessionId(), account, made: now,
    // a little past the token, so a logout arriving on the last valid request still has a row
    expires: now + (TOKEN_LASTS + 300) * 1000,
  };
  db.prepare('INSERT INTO session (id, account, made, expires) VALUES (?, ?, ?, ?)')
    .run(session.id, session.account, session.made, session.expires);
  return session;
}

/** Whether this session is still one, which is what a logout takes away. */
export function sessionStands(db: DatabaseSync, id: string, now = Date.now()): boolean {
  const row = db.prepare('SELECT expires FROM session WHERE id = ?').get(id);
  return row !== undefined && Number((row as { expires: number }).expires) > now;
}

/** End one session. Idempotent: logging out twice is not an error, it is a logout. */
export function endSession(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM session WHERE id = ?').run(id);
}

/** Drop the rows nobody can use again. Cheap, and keeps the table the size of who is logged in. */
export function sweepSessions(db: DatabaseSync, now = Date.now()): number {
  const before = Number((db.prepare('SELECT count(*) AS many FROM session').get() as { many: number }).many);
  db.prepare('DELETE FROM session WHERE expires <= ?').run(now);
  return before - Number((db.prepare('SELECT count(*) AS many FROM session').get() as { many: number }).many);
}
