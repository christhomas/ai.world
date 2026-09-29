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
    durableDb: join(dir, 'ai-world.sqlite'), toolsSecret: secret, trustProxy: true,
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

  it('opens the registry and reports the unpaired builder offline through authenticated routes', async () => {
    const cookie = cookieOut(await signIn('chris', 'a long enough password'));
    expect((await get('/tools/character-builder', cookie)).status, 'the builder has no paired worker').toBe(503);
    expect((await get('/tools/registry', cookie)).status, 'the registry is served by the portal').toBe(200);
    for (const id of ['character-builder', 'registry']) {
      const out = await get(`/tools/${id}`);
      expect(out.status, `${id} signed out`).toBe(303);
      expect(out.headers.get('location')).toBe('/tools/login');
    }
  });

  it('opens the real Domesday Book and asks its backend with the session, not an operator token', async () => {
    const cookie = cookieOut(await signIn('chris', 'a long enough password'));
    const page = await get('/tools/registry', cookie);
    const shown = await page.text();
    expect(shown, 'the card must not end at a placeholder').toContain('Domesday Book');
    expect(shown, 'the Domesday Book shares the tools title bar').toContain('class="tool-header"');
    expect(shown).toContain('← Back to tools');
    expect(shown).toContain('href="/tools/"');
    expect(shown, 'an authenticated page must not ask the operator to paste another secret')
      .not.toContain('operator or watch token');

    const answer = await get('/tools/registry/data?seed=7', cookie);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ seed: 7 });
    server!.rooms.claimWorld('Ashford', 7, 'road');
    const listed = await get('/tools/registry/data?worlds=1', cookie);
    expect(await listed.json()).toMatchObject({ worlds: [{ seed: 7, name: 'Ashford', kind: 'road' }] });
    expect((await get('/tools/registry/data?worlds=1')).status).toBe(303);
    const outside = await get('/tools/registry/data?seed=7');
    expect(outside.status).toBe(303);
    expect(outside.headers.get('location')).toBe('/tools/login');
  });

  it('turns malformed cookie encoding into an ordinary login redirect', async () => {
    const res = await get('/tools/', `${COOKIE}=%`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/tools/login');
  });

  it('slows a run of wrong passwords at the portal itself', async () => {
    const attempts = [];
    for (let n = 0; n < 6; n++) attempts.push(await signIn('chris', `wrong password ${n}`));
    expect(attempts.slice(0, 5).map((res) => res.status)).toEqual([401, 401, 401, 401, 401]);
    expect(attempts[5].status).toBe(429);
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

  it('keeps page and tools routes available when the proxy reports an internal HTTP hop', async () => {
    const headers = { 'x-forwarded-proto': 'http' };
    const page = await fetch(at('/'), { redirect: 'manual', headers });
    expect(page.status).toBe(200);
    expect(page.headers.get('location')).toBeNull();
    expect(await page.text()).toContain('ai.world server');

    const login = await fetch(at('/tools/login'), { redirect: 'manual', headers });
    expect(login.status).toBe(200);
    expect(login.headers.get('location')).toBeNull();
    expect(await login.text()).toContain('name="password"');
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

  it('explains that the tools portal needs configuration', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.port}/tools/`, { redirect: 'manual' });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('set TOOLS_SECRET and provide durable storage');
  });
});
