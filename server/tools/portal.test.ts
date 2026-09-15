import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { addAccount, migrate } from './accounts';
import {
  CATALOGUE, COOKIE, bootstrapAccount, cookieCleared, cookieFor, cookieFrom, overHttps, whatIsAsked,
} from './portal';
import type { IncomingMessage } from 'node:http';

/**
 * The door in front of the tools.
 *
 * Every piece of what it decides is pulled out of the request handler and asked here, because the
 * handler ends in sockets and the decisions are the part that can be wrong in a way nobody notices
 * until somebody is inside.
 */
describe('what the portal is being asked for', () => {
  it('takes everything under /tools and nothing else', () => {
    expect(whatIsAsked('GET', '/')).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', '/status')).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', '/registry?seed=3')).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', '/toolshed')).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', '/toolshed/registry')).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', undefined)).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', '/tools')).toEqual({ want: 'catalogue' });
  });

  it('reads a trailing slash as the same page, because that is a thing people type', () => {
    expect(whatIsAsked('GET', '/tools/')).toEqual({ want: 'catalogue' });
    expect(whatIsAsked('GET', '/tools///')).toEqual({ want: 'catalogue' });
    expect(whatIsAsked('GET', '/tools/?x=1')).toEqual({ want: 'catalogue' });
  });

  it('tells the login form from the login', () => {
    expect(whatIsAsked('GET', '/tools/login')).toEqual({ want: 'login-form' });
    expect(whatIsAsked('POST', '/tools/login')).toEqual({ want: 'login' });
  });

  /*
   * A logout that a GET can do is a logout anybody can do to you with an `<img>` tag.
   */
  it('will not log anybody out on a GET', () => {
    expect(whatIsAsked('POST', '/tools/logout')).toEqual({ want: 'logout' });
    expect(whatIsAsked('GET', '/tools/logout')).toEqual({ want: 'nothing' });
  });

  it('names a tool, and refuses anything shaped like a path', () => {
    expect(whatIsAsked('GET', '/tools/registry')).toEqual({ want: 'tool', id: 'registry' });
    expect(whatIsAsked('GET', '/tools/../secrets')).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', '/tools/a/b')).toEqual({ want: 'nothing' });
    expect(whatIsAsked('GET', '/tools/..')).toEqual({ want: 'nothing' });
  });
});

describe('the cookie a session rides in', () => {
  it('is read out of a header with other cookies in it', () => {
    expect(cookieFrom(`other=1; ${COOKIE}=abc; third=2`, COOKIE)).toBe('abc');
    expect(cookieFrom(`${COOKIE}=abc`, COOKIE)).toBe('abc');
    expect(cookieFrom('other=1', COOKIE)).toBeNull();
    expect(cookieFrom(undefined, COOKIE)).toBeNull();
  });

  it('is not confused by a cookie whose name ends in the same letters', () => {
    expect(cookieFrom(`not_${COOKIE}=wrong; ${COOKIE}=right`, COOKIE)).toBe('right');
  });

  it('reads malformed encoding as no cookie rather than throwing over the request', () => {
    expect(cookieFrom(`${COOKIE}=%`, COOKIE)).toBeNull();
    expect(cookieFrom(`${COOKIE}=%xy`, COOKIE)).toBeNull();
  });

  /*
   * HttpOnly is the difference between one bad dependency and a stolen session; SameSite=Strict is
   * because nothing on another site has business making this request on somebody's behalf; the
   * path keeps it off the game's own traffic, which is nearly every request this server sees.
   */
  it('is HttpOnly, Strict, and scoped to the tools', () => {
    const set = cookieFor('a.token', { secure: false });
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Strict');
    expect(set).toContain('Path=/tools');
  });

  /*
   * A `Secure` cookie is simply not sent over plain http, so setting it unconditionally is a login
   * that appears to work and never sticks on every in-house deployment.
   */
  it('is Secure over https and not over plain http', () => {
    expect(cookieFor('t', { secure: true })).toContain('Secure');
    expect(cookieFor('t', { secure: false })).not.toContain('Secure');
  });

  it('is taken away with the same attributes, or the browser keeps the old one', () => {
    const gone = cookieCleared({ secure: true });
    expect(gone).toContain('Max-Age=0');
    expect(gone).toContain('Path=/tools');
    expect(gone).toContain('Secure');
  });
});

describe('whether the request came in over https', () => {
  const asking = (headers: Record<string, string>, encrypted = false): IncomingMessage =>
    ({ headers, socket: { encrypted } } as unknown as IncomingMessage);

  it('reads its own socket when there is no proxy to believe', () => {
    expect(overHttps(asking({}, true), false)).toBe(true);
    expect(overHttps(asking({}, false), false)).toBe(false);
  });

  /*
   * `X-Forwarded-Proto` is a header anybody can send. Believing it on a server with nothing in
   * front is how somebody talks a portal into calling a plain request secure.
   */
  it('ignores a forwarded header when nothing was said to be in front', () => {
    expect(overHttps(asking({ 'x-forwarded-proto': 'https' }, false), false)).toBe(false);
  });

  it('believes it when the deployment says there is a proxy', () => {
    expect(overHttps(asking({ 'x-forwarded-proto': 'https' }), true)).toBe(true);
    expect(overHttps(asking({ 'x-forwarded-proto': 'http' }), true)).toBe(false);
    expect(overHttps(asking({ 'x-forwarded-proto': 'https, http' }), true)).toBe(true);
  });
});

/**
 * And the bootstrap, which has exactly one job: never to invent a password.
 */
describe('the first account', () => {
  const book = (): DatabaseSync => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE IF NOT EXISTS schema (domain TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    migrate(db);
    return db;
  };

  it('is made from the deployment\'s own secrets', () => {
    const db = book();
    const said = bootstrapAccount(db, { TOOLS_ADMIN_USER: 'chris', TOOLS_ADMIN_PASSWORD: 'a long enough one' }, addAccount);
    expect(said.made).toBe(true);
    expect(said.say).toContain('chris');
    expect(said.say, 'the log must never carry the password').not.toContain('a long enough one');
  });

  it('is not made at all when there is nothing to make it from, and says how to open it', () => {
    const said = bootstrapAccount(book(), {}, addAccount);
    expect(said.made, 'a portal that starts with a default password has a known password').toBe(false);
    expect(said.say).toContain('TOOLS_ADMIN_USER');
    expect(said.say).toContain('stays shut');
  });

  it('refuses half the secrets as firmly as none of them', () => {
    expect(bootstrapAccount(book(), { TOOLS_ADMIN_USER: 'chris' }, addAccount).made).toBe(false);
    expect(bootstrapAccount(book(), { TOOLS_ADMIN_PASSWORD: 'a long enough one' }, addAccount).made).toBe(false);
  });

  it('refuses a password somebody could sit and guess', () => {
    const said = bootstrapAccount(book(), { TOOLS_ADMIN_USER: 'chris', TOOLS_ADMIN_PASSWORD: 'hunter2' }, addAccount);
    expect(said.made).toBe(false);
    expect(said.say).toContain('twelve');
  });

  it('does nothing at all once somebody is already in the book', () => {
    const db = book();
    addAccount(db, 'chris', 'a long enough one');
    const said = bootstrapAccount(db, { TOOLS_ADMIN_USER: 'someone-else', TOOLS_ADMIN_PASSWORD: 'another long one' }, addAccount);
    expect(said.made).toBe(false);
    expect(said.say).toBe('');
  });
});

describe('the catalogue', () => {
  it('is the same list the guard checks against, so a card cannot lead somewhere unguarded', () => {
    for (const tool of CATALOGUE) {
      expect(whatIsAsked('GET', `/tools/${tool.id}`)).toEqual({ want: 'tool', id: tool.id });
    }
  });
});
