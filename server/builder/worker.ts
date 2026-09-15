import { execFileSync, spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GIVE_UP, OneAtATime, whatWasAsked, type Asked, type Recorded } from './asked';
import { buildBuilderPage, serveBuilderPage } from './page';
import { Runs, type Told } from './runs';

/**
 * The thing that actually runs Claude, on the machine with the checkout, and nowhere near the game.
 *
 * `tools/askclaude.ts` does this on a dev server and says what it is trusted with: anything that
 * can post to it can ask Claude for whatever Claude's permissions on that machine allow. It is
 * honest about being acceptable *"here and nowhere else — a development tool, on the owner's own
 * machine"*.
 *
 * So this is not that route moved onto the internet. It is a separate process, on the source host,
 * which the public game server cannot even reach except by being told where it is:
 *
 *   **It listens on loopback by default.** A worker with no `BUILDER_BIND` answers 127.0.0.1 and
 *     nothing else, so "unreachable from the public internet" is the default rather than a firewall
 *     rule somebody has to remember. The portal reaches it over a private address or a tunnel.
 *   **It wants a shared secret.** Loopback is not enough on a host with anything else on it, so
 *     every request carries a secret the portal was given, compared in constant time. The portal
 *     is the only thing that has it; a page never sees it.
 *   **It works in a worktree, not the checkout.** `--permission-mode acceptEdits` means edits land
 *     without asking, which is the point, so what they land in must not be the branch anybody
 *     deploys from. A worktree is a checkout of its own that shares the repository, which is
 *     exactly the shape wanted: the changes are real, reviewable, on a branch, and not on main.
 *   **One at a time.** Two `acceptEdits` runs in one tree is two processes editing the same files
 *     with no idea the other exists — and the result is not a conflict anybody is shown, it is one
 *     of them writing over the other and reporting success.
 *   **No shell, ever.** The prompt is one element of an argv array, so there is no quoting to get
 *     wrong and no backtick that means anything at all.
 *
 * What is deliberately *not* here is a login. The worker does not know who anybody is and must not:
 * the portal holds the sessions, and the worker's whole security boundary is "only the portal can
 * reach me". Two things checking a password is two things that can disagree about one.
 */

/** How a run is named. Short, sortable, and not a secret: it appears in a URL the page follows. */
const nameFor = (now: number): string => `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface WorkerOptions {
  /** The worktree Claude works in. Never the checkout anybody deploys from. */
  worktree: string;
  /** What the portal must present. Without one, the worker refuses to start. */
  secret: string;
  /** Where to listen. Loopback unless a deployment deliberately says otherwise. */
  host?: string;
  port?: number;
  /** Told when a run ends, so the portal's database can write down what happened. */
  onFinished?: (id: string, record: Recorded) => void;
  quiet?: boolean;
  /** For tests: run this instead of `claude`, so the worker can be driven without one. */
  command?: { run: string; args: (prompt: string) => string[] };
  /** For tests: make a tiny fixture instead of asking Vite to build a temporary repository. */
  buildPage?: (worktree: string, out: string) => Promise<void>;
}

/** What changed in the worktree, as git sees it. The answer the audit actually wants. */
export function changedIn(worktree: string): string[] {
  try {
    const said = execFileSync('git', ['status', '--porcelain', '-z'], { cwd: worktree, encoding: 'utf8' });
    return said.split('\0').filter((one) => one.length > 3).map((one) => one.slice(3));
  } catch {
    return [];
  }
}

/** Constant-time, because a comparison that returns early says how much of a guess was right. */
function sameSecret(sent: string | undefined, want: string): boolean {
  if (typeof sent !== 'string') return false;
  const a = Buffer.from(sent), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read a JSON body, with a ceiling: a builder prompt is small and a megabyte of one is an attack. */
async function jsonBody(req: IncomingMessage, most = 16 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > most) return null;
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { return null; }
}

/**
 * What a tool call is worth saying: the file it touched, or the pattern, or nothing.
 *
 * Cut down to where it sits in the worktree, because an absolute path is three lines of prefix
 * everybody already knows followed by the one word that matters.
 */
function about(input: unknown, root: string): string {
  if (typeof input !== 'object' || input === null) return '';
  const said = input as Record<string, unknown>;
  for (const field of ['file_path', 'path', 'pattern', 'command', 'prompt', 'url']) {
    const value = said[field];
    if (typeof value !== 'string') continue;
    const cut = value.split(`${root}/`).join('');
    return cut.length > 120 ? `${cut.slice(0, 117)}...` : cut;
  }
  return '';
}

/**
 * One line of `--output-format stream-json`, turned into what a follower is told, or nothing.
 *
 * Most of what comes down that pipe is bookkeeping and none of it belongs on screen. Anything
 * unrecognised is dropped rather than guessed at: the CLI's shapes are free to change, and a
 * builder that fell over when they did would be worse than one that occasionally says less.
 */
export function readEvent(msg: Record<string, unknown>, root: string): Told[] {
  if (msg.type === 'stream_event') {
    const event = msg.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    const delta = event?.delta;
    if (event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
      return [{ k: 'say', text: delta.text }];
    }
    return [];
  }
  if (msg.type === 'assistant') {
    const message = msg.message as { content?: Array<Record<string, unknown>> } | undefined;
    const tools: Told[] = [];
    for (const block of message?.content ?? []) {
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        tools.push({ k: 'tool', name: block.name, on: about(block.input, root) });
      }
    }
    return tools;
  }
  return [];
}

export interface RunningWorker {
  port: number;
  close: () => Promise<void>;
}

export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  if (!options.secret) throw new Error('the builder worker will not start without a secret to check');
  const { worktree, secret } = options;
  const runs = new Runs();
  const tree = new OneAtATime();
  const pageStore = mkdtempSync(join(tmpdir(), 'ai-world-builder-page-'));
  const pageRoots: string[] = [];

  const refreshPage = async (): Promise<void> => {
    const next = mkdtempSync(join(pageStore, 'revision-'));
    try {
      await (options.buildPage ?? buildBuilderPage)(worktree, next);
      pageRoots.unshift(next);
    } catch (why) {
      rmSync(next, { recursive: true, force: true });
      throw why;
    }
  };

  // Refuse to advertise a worker whose page cannot be made from its checkout. A 200 placeholder
  // here would hide the exact deployment fault this issue exists to make visible.
  try { await refreshPage(); } catch (why) {
    rmSync(pageStore, { recursive: true, force: true });
    throw why;
  }

  const begin = (who: string, asked: Asked, res: ServerResponse): void => {
    const id = nameFor(Date.now());
    const run = runs.begin(id, who, asked.about);
    const started = Date.now();
    res.setHeader('x-builder-run', id);
    runs.follow(run, res, 0);

    let settling = false;
    const done = (ok: boolean, note: string): void => {
      if (run.done || settling) return;
      settling = true;
      void (async () => {
        let finished = ok;
        let finalNote = note;
        if (finished) {
          try { await refreshPage(); } catch (why) {
            finished = false;
            finalNote = `the edit finished but its page did not build: ${why instanceof Error ? why.message : String(why)}`;
          }
        }
        const changed = changedIn(worktree);
        runs.finish(run, finished, finalNote, changed);
        tree.release();
        options.onFinished?.(id, {
          who, when: started, about: asked.about, length: asked.prompt.length,
          changed, ok: finished, note: finalNote,
        });
      })();
    };

    /*
     * `--include-partial-messages` is what makes this stream a sentence at a time rather than a
     * paragraph at the end, and it only works alongside `--output-format stream-json`, which in
     * turn only works with `--verbose`. All three or none of them.
     *
     * No shell: `spawn` with an argv array, so the prompt is one argument whatever is in it.
     */
    const how = options.command ?? {
      run: 'claude',
      args: (prompt: string) => [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--permission-mode', 'acceptEdits',
      ],
    };
    const child = spawn(how.run, how.args(asked.prompt), { cwd: worktree, stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      child.kill();
      done(false, `gave up after ${Math.round(GIVE_UP / 60000)} minutes`);
    }, GIVE_UP);

    // one object a line, but a pipe hands them over in whatever sized pieces it likes
    let rest = '';
    let said = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      rest += chunk;
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        for (const told of readEvent(msg, worktree)) {
          if (told.k === 'say') said = true;
          runs.tell(run, told);
        }
        if (msg.type === 'result') {
          // the summary carries the answer whole; said again only when nothing was streamed at all,
          // which is what happens when the work was done by a subagent
          if (!said && typeof msg.result === 'string') runs.tell(run, { k: 'say', text: msg.result });
          clearTimeout(timer);
          const seconds = typeof msg.duration_ms === 'number' ? `${Math.round(msg.duration_ms / 1000)}s` : 'done';
          done(msg.is_error !== true, seconds);
        }
      }
    });

    let complaint = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { complaint += chunk; });

    child.on('error', (why) => {
      clearTimeout(timer);
      done(false, `could not run the builder: ${why.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0, code === 0 ? 'done' : `exited ${code}: ${complaint.trim().slice(0, 400)}`);
    });
  };

  const http = createServer((req, res) => {
    void (async () => {
      if (!sameSecret(req.headers['x-builder-secret'] as string | undefined, secret)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('no');
        return;
      }
      const url = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && url.startsWith('/page/')) {
        if (await serveBuilderPage(pageRoots, url.slice('/page/'.length), res)) return;
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('there is no such file in the built builder page');
        return;
      }

      if (req.method === 'GET' && url === '/follow') {
        const from = Number(new URL(req.url ?? '/', 'http://worker').searchParams.get('from') ?? '0');
        const id = new URL(req.url ?? '/', 'http://worker').searchParams.get('run');
        runs.follow(id ? runs.find(id) : runs.latest, res, Number.isFinite(from) ? from : 0);
        return;
      }

      if (req.method !== 'POST' || url !== '/ask') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('the builder worker answers POST /ask, GET /follow, and its built page');
        return;
      }

      const asked = whatWasAsked(await jsonBody(req));
      if (typeof asked === 'string') {
        res.writeHead(asked === 'too long' ? 413 : 400, { 'content-type': 'text/plain' });
        res.end(asked === 'too long' ? `a prompt may be ${4000} characters` : 'there was nothing to ask');
        return;
      }
      // who the portal says this is. The worker does not check it and must not — see the note at
      // the top — it is written into the book and nothing else
      const who = String(req.headers['x-builder-who'] ?? '').slice(0, 64) || 'somebody';
      if (!tree.take(who)) {
        res.writeHead(409, { 'content-type': 'text/plain' });
        res.end(`the builder is busy with ${tree.busy}'s run`);
        return;
      }
      begin(who, asked, res);
    })().catch(() => {
      tree.release();
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('the builder worker could not answer that');
    });
  });

  const port = await new Promise<number>((up) => {
    // loopback unless a deployment deliberately says otherwise, so unreachable is the default
    http.listen(options.port ?? 8788, options.host ?? '127.0.0.1', () => {
      up((http.address() as { port: number }).port);
    });
  });
  if (!options.quiet) {
    console.log(`builder worker on ${options.host ?? '127.0.0.1'}:${port}, working in ${worktree}`);
  }
  return {
    port,
    close: async () => {
      await closed(http);
      rmSync(pageStore, { recursive: true, force: true });
    },
  };
}

const closed = (http: Server): Promise<void> => new Promise((done) => http.close(() => done()));
