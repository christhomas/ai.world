import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  addAccount, accountNamed, beginSession, endSession, howManyAccounts,
  migrate, sessionStands, sweepSessions, whoIsThis,
} from './accounts';
import { SCRYPT, hashPassword, passwordMatches, wantsRehashing } from './passwords';
import { TOKEN_LASTS, newSessionId, readToken, signToken } from './tokens';

const book = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema (domain TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  migrate(db);
  return db;
};

/**
 * What a stored password is, which is never the password.
 */
describe('a password the server keeps', () => {
  it('is not the password, and is different every time the same one is stored', () => {
    const one = hashPassword('correct horse battery staple');
    const two = hashPassword('correct horse battery staple');
    expect(one).not.toContain('correct horse');
    expect(one, 'the same password twice must not make the same row').not.toBe(two);
    expect(passwordMatches('correct horse battery staple', one)).toBe(true);
    expect(passwordMatches('correct horse battery staple', two)).toBe(true);
  });

  it('refuses the wrong one, including the empty one', () => {
    const stored = hashPassword('a real password');
    expect(passwordMatches('a real passwore', stored)).toBe(false);
    expect(passwordMatches('', stored)).toBe(false);
    expect(passwordMatches('a real password ', stored)).toBe(false);
  });

  /*
   * A row that has been corrupted is a login that fails, not a server that stops answering. This
   * runs on the one route that faces the internet.
   */
  it('reads a damaged row as "no" rather than throwing', () => {
    for (const junk of ['', 'x', 'scrypt$$$$$', 'scrypt$0$0$0$a$b', 'bcrypt$1$1$1$a$b',
                        'scrypt$notanumber$8$1$a$b', 'scrypt$32768$8$1$a$']) {
      expect(passwordMatches('anything', junk), junk).toBe(false);
    }
  });

  it('carries the cost it was made at, so the cost can be raised later', () => {
    const weak = hashPassword('whatever', Buffer.alloc(16, 7));
    expect(weak.split('$')[1]).toBe(String(SCRYPT.N));
    expect(wantsRehashing(weak), 'made at today\'s cost').toBe(false);
    expect(wantsRehashing('scrypt$1024$8$1$YQ$Yg'), 'made when it was cheaper').toBe(true);
    expect(wantsRehashing('nonsense')).toBe(true);
  });

  it('treats the same password typed in two normalisations as the same password', () => {
    const stored = hashPassword('café');                 // e + combining acute
    expect(passwordMatches('café', stored), 'é is é').toBe(true);
  });
});

/**
 * The signed note, and the two ways it can lie.
 */
describe('the note that says who is logged in', () => {
  const secret = 'a deployment secret nobody has guessed';

  it('reads back what it was signed with', () => {
    const token = signToken({ sub: 'acc1', jti: 'sess1' }, secret);
    expect(readToken(token, secret)).toMatchObject({ sub: 'acc1', jti: 'sess1' });
  });

  it('is refused when it was signed with a different secret', () => {
    const token = signToken({ sub: 'acc1', jti: 'sess1' }, secret);
    expect(readToken(token, 'some other secret')).toBeNull();
  });

  it('is refused when anybody has touched it', () => {
    const token = signToken({ sub: 'acc1', jti: 'sess1' }, secret);
    const [head, body, sig] = token.split('.');
    const swapped = Buffer.from(JSON.stringify({ sub: 'somebody-else', jti: 'sess1', iat: 1, exp: 2 })).toString('base64url');
    expect(readToken(`${head}.${swapped}.${sig}`, secret)).toBeNull();
    expect(readToken(`${head}.${body}.${sig.slice(0, -1)}x`, secret)).toBeNull();
  });

  /*
   * The oldest trap there is: a verifier that believes the header will take `alg: none`, and one
   * that believes an RS256 header will verify the signature with the public key as an HMAC secret.
   */
  it('does not believe the token about how it was signed', () => {
    const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'acc1', jti: 's', iat: 1, exp: 9e9 })).toString('base64url');
    expect(readToken(`${head}.${body}.`, secret)).toBeNull();
    expect(readToken(`${head}.${body}.${''}`, secret)).toBeNull();
  });

  it('is refused once it has run out', () => {
    const then = 1_000_000;
    const token = signToken({ sub: 'acc1', jti: 'sess1' }, secret, then);
    expect(readToken(token, secret, then + TOKEN_LASTS - 1)).not.toBeNull();
    expect(readToken(token, secret, then + TOKEN_LASTS)).toBeNull();
    expect(readToken(token, secret, then + TOKEN_LASTS + 1)).toBeNull();
  });

  it('is refused when it was stamped in somebody else\'s future', () => {
    const token = signToken({ sub: 'acc1', jti: 'sess1' }, secret, 2_000_000);
    expect(readToken(token, secret, 1_000_000)).toBeNull();
  });

  it('is refused when it is not a token at all', () => {
    for (const junk of ['', '.', 'a.b', 'a.b.c.d', 'not a token']) {
      expect(readToken(junk, secret), junk).toBeNull();
    }
  });
});

/**
 * And the book the sessions are kept in, which is what makes a logout mean something.
 */
describe('who may open the tools', () => {
  it('starts with nobody, which is what fails the bootstrap closed', () => {
    expect(howManyAccounts(book())).toBe(0);
  });

  it('takes one account of a name and refuses a second, whatever its case', () => {
    const db = book();
    expect(addAccount(db, 'chris', 'a password')).not.toBeNull();
    expect(addAccount(db, 'chris', 'another'), 'two accounts of one name').toBeNull();
    expect(addAccount(db, 'CHRIS', 'another'), 'and not by shouting it either').toBeNull();
    expect(howManyAccounts(db)).toBe(1);
  });

  it('knows a password and does not know a wrong one', async () => {
    const db = book();
    addAccount(db, 'chris', 'a real password');
    const checking = whoIsThis(db, 'chris', 'a real password');
    expect(checking, 'password work must leave the event loop').toBeInstanceOf(Promise);
    const first = await Promise.race([
      checking.then(() => 'hash'),
      new Promise<string>((done) => setTimeout(() => done('event loop'), 0)),
    ]);
    expect(first, 'a world tick or another request must run while scrypt works').toBe('event loop');
    expect((await checking)?.name).toBe('chris');
    expect(await whoIsThis(db, 'chris', 'a real passwore')).toBeNull();
    expect(await whoIsThis(db, 'nobody', 'a real password'), 'no such person').toBeNull();
  });

  it('reports storage failures instead of calling them duplicate accounts', () => {
    const db = book();
    db.close();
    expect(() => addAccount(db, 'chris', 'a real password')).toThrow();
  });

  it('never keeps the password anywhere', () => {
    const db = book();
    addAccount(db, 'chris', 'a real password');
    expect(accountNamed(db, 'chris')?.secret).not.toContain('a real password');
  });

  /*
   * A signed token cannot be taken back, which is the whole difficulty with them. The row is what
   * makes a logout real: the signature still verifies afterwards and the session is gone.
   */
  it('ends a session without the token becoming unreadable', () => {
    const db = book();
    const account = addAccount(db, 'chris', 'p')!;
    const session = beginSession(db, account.id);
    const token = signToken({ sub: account.id, jti: session.id }, 'secret');

    expect(sessionStands(db, session.id)).toBe(true);
    endSession(db, session.id);
    expect(readToken(token, 'secret'), 'the note still reads').not.toBeNull();
    expect(sessionStands(db, session.id), 'and it is worth nothing').toBe(false);
  });

  it('lets a logout happen twice, because that is still a logout', () => {
    const db = book();
    const account = addAccount(db, 'chris', 'p')!;
    const session = beginSession(db, account.id);
    endSession(db, session.id);
    expect(() => endSession(db, session.id)).not.toThrow();
  });

  it('counts a session that has run out as gone without being told', () => {
    const db = book();
    const account = addAccount(db, 'chris', 'p')!;
    const session = beginSession(db, account.id, 1_000);
    expect(sessionStands(db, session.id, 1_000)).toBe(true);
    expect(sessionStands(db, session.id, 1_000 + (TOKEN_LASTS + 301) * 1000)).toBe(false);
  });

  it('sweeps the rows nobody can use again', () => {
    const db = book();
    const account = addAccount(db, 'chris', 'p')!;
    const old = beginSession(db, account.id, 1_000);
    const live = beginSession(db, account.id, Date.now());
    expect(sweepSessions(db, old.expires - 1), 'nothing has run out yet').toBe(0);
    expect(sweepSessions(db, old.expires), 'and now one has').toBe(1);
    expect(sessionStands(db, live.id), 'the live one is untouched').toBe(true);
  });

  /*
   * The reason foreign keys are on: an account deleted with sessions left behind is a logout that
   * never happened, and the row would go on saying somebody is logged in.
   */
  it('takes an account\'s sessions with it when the account goes', () => {
    const db = book();
    const account = addAccount(db, 'chris', 'p')!;
    const session = beginSession(db, account.id);
    db.prepare('DELETE FROM account WHERE id = ?').run(account.id);
    expect(sessionStands(db, session.id)).toBe(false);
  });

  it('is the same database after being opened again, which is the whole point of it', () => {
    const db = book();
    expect(migrate(db), 'migrating twice changes nothing').toBe(migrate(db));
  });

  it('gives every session an id nobody is going to guess', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newSessionId()));
    expect(seen.size).toBe(200);
    expect([...seen][0].length).toBeGreaterThanOrEqual(24);
  });
});
