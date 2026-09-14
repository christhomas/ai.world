import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type RunningServer } from '../serve';
import { COOKIE } from './portal';

/**
 * The portal, through a real server, which is where this issue's acceptance criteria live.
 *
 * Everything below is a thing #102 asks for in so many words: an anonymous visitor is sent to the
 * login page, a valid login comes back to a catalogue with both tools on it, each card opens
 * through an authenticated route, and the accounts survive the container coming back. The pieces
 * are unit-tested next door; this is the assertion that they are wired to each other.
 */
describe('the tools portal, served', () => {
  let dir = '';
  let server: RunningServer | null = null;
  const secret = 'a deployment secret for the tests';

  const start = async (): Promise<RunningServer> => startServer({
    port: 0, quiet: true, dataDir: join(dir, 'worlds'),
    toolsDb: join(dir, 'tools.sqlite'), toolsSecret: secret,
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'portal-'));
    process.env.TOOLS_ADMIN_USER = 'chris';
    process.env.TOOLS_ADMIN_PASSWORD = 'a long enough password';
    server = await start();
  });

  afterEach(async () => {
    delete process.env.TOOLS_ADMIN_USER;
    delete process.env.TOOLS_ADMIN_PASSWORD;
    await server?.close();
    server = null;
    rmSync(dir, { recursive: true, force: true });
  });

  const at = (path: string): string => `http://127.0.0.1:${server!.port}${path}`;
  const get = (path: string, cookie?: string): Promise<Response> =>
    fetch(at(path), { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const signIn = async (name: string, password: string): Promise<Response> =>
    fetch(at('/tools/login'), {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name, password }).toString(),
    });
  const cookieOut = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0];

  it('sends somebody who is not signed in to the login page', async () => {
    const res = await get('/tools/');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/tools/login');
  });

  it('shows a login form to ask with', async () => {
    const res = await get('/tools/login');
    expect(res.status).toBe(200);
    const said = await res.text();
    expect(said).toContain('name="password"');
    expect(said).toContain('/tools/login');
  });

  it('refuses a wrong password and says nothing about which half was wrong', async () => {
    const bad = await signIn('chris', 'not the password');
    expect(bad.status).toBe(401);
    expect(bad.headers.get('set-cookie'), 'a refused login must not hand out a session').toBeNull();
    const nobody = await signIn('nobody-at-all', 'a long enough password');
    expect(await nobody.text(), 'and the two refusals read the same')
      .toBe(await bad.text());
  });

  it('lets the right password in, and hands back a cookie script cannot read', async () => {
    const res = await signIn('chris', 'a long enough password');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/tools/');
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(COOKIE);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Strict');
    // plain http in a test, so it must NOT be Secure or the browser would drop it
    expect(set, 'a Secure cookie over http is a login that never sticks').not.toContain('Secure');
  });

  it('shows the catalogue, with both tools on it, to somebody signed in', async () => {
    const cookie = cookieOut(await signIn('chris', 'a long enough password'));
    const res = await get('/tools/', cookie);
    expect(res.status).toBe(200);
    const said = await res.text();
    expect(said).toContain('Character Builder');
    expect(said).toContain('Domesday Book');
  });

  it('opens each card through a route that checks the cookie', async () => {
    const cookie = cookieOut(await signIn('chris', 'a long enough password'));
    for (const id of ['character-builder', 'registry']) {
      expect((await get(`/tools/${id}`, cookie)).status, `${id} signed in`).toBe(200);
      const out = await get(`/tools/${id}`);
      expect(out.status, `${id} signed out`).toBe(303);
      expect(out.headers.get('location')).toBe('/tools/login');
    }
  });

  it('refuses a cookie somebody has made up', async () => {
    for (const made of ['nonsense', 'a.b.c', '']) {
      const res = await get('/tools/', `${COOKIE}=${made}`);
      expect(res.status, made).toBe(303);
    }
  });

  /*
   * The half a signed token cannot do on its own: after a logout the note still verifies, and the
   * session behind it is gone. Without the session row this request would succeed.
   */
  it('ends the session on logout, and the old cookie stops working', async () => {
    const cookie = cookieOut(await signIn('chris', 'a long enough password'));
    expect((await get('/tools/', cookie)).status).toBe(200);

    const out = await fetch(at('/tools/logout'), { method: 'POST', redirect: 'manual', headers: { cookie } });
    expect(out.status).toBe(303);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

    expect((await get('/tools/', cookie)).status, 'the same cookie, after logging out').toBe(303);
  });

  it('will not log anybody out on a GET, which an image tag could make them do', async () => {
    const cookie = cookieOut(await signIn('chris', 'a long enough password'));
    await get('/tools/logout', cookie);
    expect((await get('/tools/', cookie)).status, 'still signed in').toBe(200);
  });

  it('leaves the game and the status page alone', async () => {
    expect((await get('/status')).status).toBe(200);
    expect(await (await get('/status')).text()).toContain('ai.world server');
  });

  /*
   * The criterion this whole database exists for. The container comes back and the account is still
   * there — and so is the session, which is what stops a restart logging everybody out.
   */
  it('keeps its accounts and its sessions across a restart', async () => {
    const cookie = cookieOut(await signIn('chris', 'a long enough password'));
    await server!.close();
    server = await start();

    expect((await get('/tools/', cookie)).status, 'the session outlived the container').toBe(200);
    const again = await signIn('chris', 'a long enough password');
    expect(again.status, 'and so did the account').toBe(303);
  });

  it('does not make a second account when one is already in the book', async () => {
    await server!.close();
    process.env.TOOLS_ADMIN_USER = 'somebody-else';
    process.env.TOOLS_ADMIN_PASSWORD = 'another long password';
    server = await start();
    expect((await signIn('somebody-else', 'another long password')).status, 'the bootstrap runs once').toBe(401);
    expect((await signIn('chris', 'a long enough password')).status).toBe(303);
  });
});

/**
 * And the deployment that has not been told about any of this, which is most of them.
 */
describe('a server with no portal configured', () => {
  let dir = '';
  let server: RunningServer | null = null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'portal-off-'));
    server = await startServer({ port: 0, quiet: true, dataDir: join(dir, 'worlds') });
  });
  afterEach(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /*
   * Not a 401. The path is not there at all — the same rule `/operate` runs on, and for the same
   * reason: on a box reachable from the internet, a door that is not there beats a locked one.
   */
  it('has no /tools at all, rather than a locked one', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.port}/tools/`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(await res.text(), 'the status page, because that route does not exist here')
      .toContain('ai.world server');
  });
});
