import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorker, changedIn, type RunningWorker } from './worker';
import { startServer, type RunningServer } from '../serve';
import { COOKIE } from '../tools/portal';
import type { Recorded } from './asked';

/**
 * The builder, end to end: a portal that knows who you are, a worker that does not, and a shared
 * secret between them.
 *
 * Claude is stood in for. What is being tested is the arrangement — who may ask, what the worker
 * refuses, what is written down, and that a page can follow a run and pick it up again after a
 * reload — and standing in for the thing that edits files makes all of that testable without a
 * login, an API key, or twenty minutes.
 *
 * The stand-in is a real child process speaking real `stream-json`, so the parsing, the streaming,
 * the argv and the exit codes are all the ones production uses. The only thing it does not do is
 * think.
 */
const PATIENCE = 20_000;

/** A script that speaks the CLI's own stream format, so nothing between here and the page is faked. */
const PRETEND = `
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const prompt = process.argv[process.argv.length - 1] ?? '';
if (prompt.includes('fail')) { process.stderr.write('it did not work\\n'); process.exit(2); }
say({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'working on ' } } });
say({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: prompt } } });
// a run long enough to still be in hand when a second one arrives, for the one test that needs it
if (prompt.includes('slowly')) { const until = Date.now() + 1500; while (Date.now() < until); }
say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/entities/animals.ts' } }] } });
require('node:fs').writeFileSync('changed.txt', prompt);
say({ type: 'result', is_error: false, duration_ms: 1200, result: 'done' });
`;

/** A build small enough for this test, but still made from the worker's actual worktree. */
const BUILD_PAGE = async (worktree: string, out: string): Promise<void> => {
  mkdirSync(join(out, 'tools'), { recursive: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  let revision = 'the first revision';
  try { revision = readFileSync(join(worktree, 'changed.txt'), 'utf8'); } catch { /* no edit yet */ }
  writeFileSync(join(out, 'tools', 'character-builder.html'),
    `<!doctype html><title>worker character builder</title><p>${revision}</p><script src="/tools/build/page/assets/revision.js"></script>`);
  writeFileSync(join(out, 'assets', 'revision.js'), `window.revision = ${JSON.stringify(revision)}`);
};

describe('the builder worker', () => {
  let dir = '', tree = '';
  let worker: RunningWorker | null = null;
  const written: Array<{ id: string; record: Recorded }> = [];
  const secret = 'what the portal presents';

  const start = async (): Promise<RunningWorker> => startWorker({
    worktree: tree, secret, port: 0, quiet: true,
    onFinished: (id, record) => { written.push({ id, record }); },
    command: { run: process.execPath, args: (prompt) => ['-e', PRETEND, prompt] },
    buildPage: BUILD_PAGE,
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'builder-'));
    tree = join(dir, 'tree');
    execFileSync('git', ['init', '-q', tree]);
    writeFileSync(join(tree, 'kept.txt'), 'a file that was already here\n');
    written.length = 0;
    worker = await start();
  });
  afterEach(async () => {
    await worker?.close();
    worker = null;
    rmSync(dir, { recursive: true, force: true });
  });

  const at = (path: string): string => `http://127.0.0.1:${worker!.port}${path}`;
  const ask = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(at('/ask'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-builder-secret': secret, ...headers },
      body: JSON.stringify(body),
    });

  it('refuses anybody who does not present the secret', async () => {
    const res = await fetch(at('/ask'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt":"hello"}',
    });
    expect(res.status, 'the worker is only ever spoken to by the portal').toBe(403);
    expect(written, 'and nothing was run').toHaveLength(0);
  });

  it('refuses a secret that is nearly right', async () => {
    const res = await ask({ prompt: 'hello' }, { 'x-builder-secret': `${secret}x` });
    expect(res.status).toBe(403);
  });

  it('serves only the built page, and only to somebody with the worker secret', async () => {
    const shut = await fetch(at('/page/tools/character-builder.html'));
    expect(shut.status, 'the page is no more public than the command route').toBe(403);

    const page = await fetch(at('/page/tools/character-builder.html'), { headers: { 'x-builder-secret': secret } });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text(), 'this came from the worker build, not a portal placeholder').toContain('the first revision');

    const source = await fetch(at('/page/../kept.txt'), { headers: { 'x-builder-secret': secret } });
    expect(source.status, 'the worktree itself is never a static root').toBe(404);
  });

  it('rebuilds from the edited worktree before saying a successful run is done', async () => {
    const answer = await ask({ prompt: 'the second revision' });
    expect(await answer.text()).toContain('"k":"end"');
    const page = await fetch(at('/page/tools/character-builder.html'), { headers: { 'x-builder-secret': secret } });
    expect(await page.text()).toContain('the second revision');
  }, PATIENCE);

  it('runs what it is asked and streams it back as it happens', async () => {
    const res = await ask({ prompt: 'make the wolf bigger', about: 'wolf' });
    expect(res.status).toBe(200);
    const said = await res.text();
    expect(said).toContain('working on ');
    expect(said).toContain('make the wolf bigger');
    expect(said, 'the tool line is what makes watching it happen literally true').toContain('"name":"Edit"');
    expect(said).toContain('"k":"end"');
  }, PATIENCE);

  it('writes down who asked, what it was about and what changed', async () => {
    await (await ask({ prompt: 'make the wolf bigger', about: 'wolf' }, { 'x-builder-who': 'acc1' })).text();
    expect(written).toHaveLength(1);
    expect(written[0].record).toMatchObject({ who: 'acc1', about: 'wolf', ok: true });
    expect(written[0].record.changed, 'the file the run actually touched').toContain('changed.txt');
    expect(written[0].record.length).toBe('make the wolf bigger'.length);
  }, PATIENCE);

  it('writes down a failure as a failure, with what it said', async () => {
    await (await ask({ prompt: 'please fail' })).text();
    expect(written[0].record.ok).toBe(false);
    expect(written[0].record.note).toContain('it did not work');
  }, PATIENCE);

  it('refuses an empty prompt and one longer than a person would type', async () => {
    expect((await ask({ prompt: '  ' })).status).toBe(400);
    expect((await ask({ prompt: 'x'.repeat(5000) })).status).toBe(413);
    expect(written).toHaveLength(0);
  });

  /*
   * Two `acceptEdits` runs in one tree is two processes editing the same files with no idea the
   * other exists, and the result is one of them writing over the other and reporting success.
   */
  it('refuses a second run while one is in hand, rather than queueing it', async () => {
    // "slowly" makes the stand-in hold the tree long enough for a second request to arrive while
    // the first is still running, which is the situation being tested
    const first = ask({ prompt: 'the first one, slowly' }, { 'x-builder-who': 'chris' });
    await new Promise((wait) => setTimeout(wait, 300));
    const second = await ask({ prompt: 'the second one' });
    expect(second.status).toBe(409);
    expect(await second.text(), 'and says whose run it is waiting on').toContain('chris');
    await (await first).text();
  }, PATIENCE);

  it('takes the next one once the first has finished', async () => {
    await (await ask({ prompt: 'the first one' })).text();
    expect((await ask({ prompt: 'the second one' })).status).toBe(200);
  }, PATIENCE);

  /*
   * The reason the transcript is on this side: the builder edits files, the page reloads, and a
   * stream being written into that page dies with it.
   */
  it('lets a reloaded page pick the run up again', async () => {
    const res = await ask({ prompt: 'make the wolf bigger' });
    const id = res.headers.get('x-builder-run');
    await res.text();
    expect(id).toBeTruthy();

    const again = await fetch(at(`/follow?run=${id}&from=0`), { headers: { 'x-builder-secret': secret } });
    expect(await again.text(), 'the whole thing, from the top').toContain('make the wolf bigger');
  }, PATIENCE);

  it('does not answer anything outside its deliberate routes', async () => {
    const res = await fetch(at('/anything-else'), { headers: { 'x-builder-secret': secret } });
    expect(res.status).toBe(404);
  });

  it('sees what changed in the worktree, and not what was already there', async () => {
    expect(changedIn(tree), 'the file that was there before is untracked and so is a change')
      .toContain('kept.txt');
    writeFileSync(join(tree, 'new.txt'), 'x');
    expect(changedIn(tree)).toContain('new.txt');
  });

  it('will not start without a secret to check', async () => {
    await expect(startWorker({ worktree: tree, secret: '', port: 0, quiet: true })).rejects.toThrow();
  });
});

/**
 * And through the portal, which is the only thing allowed to speak to it.
 */
describe('the builder behind the portal', () => {
  let dir = '', tree = '';
  let worker: RunningWorker | null = null;
  let server: RunningServer | null = null;
  const secret = 'what the portal presents';

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'builder-portal-'));
    tree = join(dir, 'tree');
    execFileSync('git', ['init', '-q', tree]);
    process.env.TOOLS_ADMIN_USER = 'chris';
    process.env.TOOLS_ADMIN_PASSWORD = 'a long enough password';
    worker = await startWorker({
      worktree: tree, secret, port: 0, quiet: true,
      command: { run: process.execPath, args: (prompt) => ['-e', PRETEND, prompt] },
      buildPage: BUILD_PAGE,
    });
    server = await startServer({
      port: 0, quiet: true, dataDir: join(dir, 'worlds'),
      durableDb: join(dir, 'ai-world.sqlite'), toolsSecret: 'a signing key',
      builder: { host: '127.0.0.1', port: worker.port, secret },
    });
  });
  afterEach(async () => {
    delete process.env.TOOLS_ADMIN_USER;
    delete process.env.TOOLS_ADMIN_PASSWORD;
    await server?.close();
    await worker?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const at = (path: string): string => `http://127.0.0.1:${server!.port}${path}`;
  const signIn = async (): Promise<string> => {
    const res = await fetch(at('/tools/login'), {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'chris', password: 'a long enough password' }).toString(),
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };

  /* #103: "prompt submission requires a valid admin JWT established by #102". */
  it('will not ask the builder for somebody who is not signed in', async () => {
    const res = await fetch(at('/tools/build/ask'), {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json' }, body: '{"prompt":"make the wolf bigger"}',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/tools/login');
  });

  it('will not ask it for a made-up cookie either', async () => {
    const res = await fetch(at('/tools/build/ask'), {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: `${COOKIE}=not.a.token` },
      body: '{"prompt":"hello"}',
    });
    expect(res.status).toBe(303);
  });

  it('asks it for somebody who is, and streams the answer back', async () => {
    const cookie = await signIn();
    const res = await fetch(at('/tools/build/ask'), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ prompt: 'make the wolf bigger', about: 'wolf' }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('make the wolf bigger');
  }, PATIENCE);

  it('serves the worker revision and its assets only through an authenticated portal', async () => {
    const shut = await fetch(at('/tools/character-builder'), { redirect: 'manual' });
    expect(shut.status).toBe(303);
    expect(shut.headers.get('location')).toBe('/tools/login');

    const cookie = await signIn();
    const page = await fetch(at('/tools/character-builder'), { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('the first revision');
    const asset = await fetch(at('/tools/build/page/assets/revision.js'), { headers: { cookie } });
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('the first revision');
  });

  it('lets a signed-in page follow a run it has lost', async () => {
    const cookie = await signIn();
    const res = await fetch(at('/tools/build/ask'), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ prompt: 'make the wolf bigger' }),
    });
    await res.text();
    const again = await fetch(at('/tools/build/follow?from=0'), { headers: { cookie } });
    expect(await again.text()).toContain('make the wolf bigger');
  }, PATIENCE);

  /*
   * The criterion, and the gap the unreached bench found: the book was written and nothing wrote
   * to it. The worker is on another machine, so the record is built here from what this end knows
   * and what the answer says as it streams past.
   */
  it('writes the run down, against the account that asked for it', async () => {
    const cookie = await signIn();
    await (await fetch(at('/tools/build/ask'), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ prompt: 'make the wolf bigger', about: 'wolf' }),
    })).text();

    const book = await (await fetch(at('/tools/build/book'), { headers: { cookie } })).text();
    expect(book, 'the book is available to the full builder page').toContain('wolf');
    expect(book, 'the file the run touched').toContain('src/entities/animals.ts');
    expect(book, 'and never the prompt itself').not.toContain('make the wolf bigger');
  }, PATIENCE);

  it('refuses to follow for somebody not signed in', async () => {
    const res = await fetch(at('/tools/build/follow?from=0'), { redirect: 'manual' });
    expect(res.status).toBe(303);
  });

  /*
   * A GET that asks, or a POST that follows, would be a door nobody meant to open. Neither is a
   * route at all under the wrong method, so the request falls past the portal to the status page —
   * which is the same "not there rather than locked" the portal itself runs on.
   */
  it('takes each route only by the method it is meant to have', async () => {
    const cookie = await signIn();
    const asGet = await fetch(at('/tools/build/ask'), { redirect: 'manual', headers: { cookie } });
    expect(await asGet.text(), 'asking is a POST').toContain('ai.world server');
    const asPost = await fetch(at('/tools/build/follow'), { method: 'POST', redirect: 'manual', headers: { cookie } });
    expect(await asPost.text(), 'following is a GET').toContain('ai.world server');
  });
});

/**
 * And a game server with no source host behind it, which is every deployment but one.
 */
describe('a portal with no builder behind it', () => {
  let dir = '';
  let server: RunningServer | null = null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'no-builder-'));
    process.env.TOOLS_ADMIN_USER = 'chris';
    process.env.TOOLS_ADMIN_PASSWORD = 'a long enough password';
    server = await startServer({
      port: 0, quiet: true, dataDir: join(dir, 'worlds'),
      durableDb: join(dir, 'ai-world.sqlite'), toolsSecret: 'a signing key',
    });
  });
  afterEach(async () => {
    delete process.env.TOOLS_ADMIN_USER;
    delete process.env.TOOLS_ADMIN_PASSWORD;
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('says so, rather than pretending or hanging', async () => {
    const login = await fetch(`http://127.0.0.1:${server!.port}/tools/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'chris', password: 'a long enough password' }).toString(),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await fetch(`http://127.0.0.1:${server!.port}/tools/build/ask`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: '{"prompt":"hello"}',
    });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('#103');
  });
});
