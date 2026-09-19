import type { DatabaseSync } from 'node:sqlite';
import { migrateDomain } from '../durable/db';
import { hashPassword, hashPasswordAsync, passwordMatchesAsync, wantsRehashing } from './passwords';
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
 * The world's state stays where it is, in JSON under `DATA_DIR`: a seed grows the country and the
 * people, and a short log of told facts replays the rest. Authentication is not a reason to migrate
 * a working persistence format.
 *
 * It shares a *file* with the register's durable half (`durable/minds.ts`) and shares nothing else.
 * That is the right way round: they share a volume, a backup, a WAL and a crash, and pretending
 * they have different infrastructure would mean two of each. Ownership is what stays separate —
 * this module declares these tables, that one declares those, and neither reads the other's. See
 * `durable/db.ts` for why the schema version is a row rather than `user_version`.
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

/** Run whatever of this domain's schema the file has not had yet. See `migrateDomain`. */
export function migrate(db: DatabaseSync): number {
  return migrateDomain(db, 'tools', SCHEMA);
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
  } catch (why) {
    const sqlite = why as { errcode?: number; message?: string };
    if (sqlite.errcode === 2067 && sqlite.message?.includes('account.name')) return null;
    throw why;
  }
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
export async function whoIsThis(db: DatabaseSync, name: string, password: string): Promise<Account | null> {
  const account = accountNamed(db, name);
  const stored = account?.secret ?? NOBODY;
  if (!await passwordMatchesAsync(password, stored) || !account) return null;
  if (wantsRehashing(stored)) {
    const remade = await hashPasswordAsync(password);
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
