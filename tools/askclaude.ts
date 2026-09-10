import { spawn, type ChildProcess } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * The door the character builder asks Claude through.
 *
 * A page cannot shell out, and the whole point of `tools/character-builder.html` is that changing a rig is
 * asking for the change and watching it happen — so something on this side has to run the command
 * and hand the reply back as it arrives. This is that something, and it is a Vite plugin marked
 * `apply: 'serve'` for the same reason the command channel is: it exists while somebody is
 * developing and there is no build flag to get wrong.
 *
 * WHAT THIS IS TRUSTED WITH, stated plainly, because it is the only interesting thing about the
 * file. This route runs `claude -p` with text that came from a web page. Anything that can post to
 * it can ask Claude for anything Claude's own permissions on this machine allow, in this
 * repository. That is acceptable here and nowhere else: it is a development tool, on the owner's
 * own machine, opening the same door the owner already has open in a terminal two windows along.
 * What it does not do is widen that door. Four things hold it where it is:
 *
 *   the prompt is an argument, never a shell string.  `spawn` with an argv array and no `shell`,
 *     so there is no quoting to get wrong and no `;` or backtick that means anything at all. The
 *     text is one argument no matter what is in it.
 *   loopback, and whoever the owner has invited by address.  The dev server deliberately answers on
 *     the network — `host: true`, so a phone can play the game — which means "the dev server is
 *     local" is not true of this machine. The check therefore belongs on the route rather than on
 *     the server, and it is the socket's own remote address, not a header anybody could write. The
 *     invitation is `ASK_FROM`, an environment variable on the command that starts the server, and
 *     it takes addresses rather than ranges: see `INVITED`.
 *   a header a form cannot send.  A cross-site `fetch` carrying `x-ai-world-builder` is not a
 *     simple request, so the browser asks permission with a preflight first, and nothing here
 *     answers a preflight. That is what stops a page open in another tab posting here behind your
 *     back, which loopback alone does not.
 *   `--permission-mode acceptEdits`, and nothing more.  Editing files is the point, so edits land
 *     without waiting on a prompt that nobody is there to answer. It widens nothing else: what
 *     Claude may run is still exactly what this machine's own settings already let it run at a
 *     terminal, and anything they do not allow is refused rather than queued, because in print mode
 *     there is no one to ask. That last part is worth knowing when you read the transcript — if a
 *     command goes past that you did not expect, it went past because you had already allowed it.
 *
 * And it is deliberately a pipe rather than a librarian: the page composes the whole prompt, shows
 * the framing it wraps around your words, and this runs what it is given. A route that quietly
 * added instructions of its own would be a route nobody could reason about.
 */

/** Where a question is posted, and where the answer to the last one can be read back. */
const ROUTE = '/__ask';

/**
 * The header a caller must send. Its value is never checked — its presence is the whole point,
 * because a header outside the handful browsers call "simple" forces a preflight nothing answers.
 */
const HEADER = 'x-ai-world-builder';

/** The addresses this machine calls itself. Node reports an IPv4 loopback as the third of these. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Who else may ask, named one at a time by whoever started the dev server.
 *
 * Loopback alone is right for a browser on this machine and wrong for the way this game is actually
 * played on this network: the page is reached through a gateway on another box, so what arrives
 * here is the gateway's address and the builder answers 403 to the owner of the machine it is
 * running on. That is the fault this exists to fix, and the fix has to stay narrow, because what is
 * on the other side of this route is `claude -p` with the owner's own permissions.
 *
 * So: an environment variable, listing addresses, set by the person starting the server. Not a flag
 * in a file that could be committed, not a private-range rule that quietly admits every device on a
 * café's wifi, and never a header or a hostname the caller writes for itself. An address that is
 * not on the list is refused exactly as before, and a server started without the variable is the
 * loopback-only server this has always been.
 *
 *     ASK_FROM=192.168.1.20 chore dev
 *
 * Addresses rather than ranges on purpose. A range is a thing you set once and stop thinking
 * about; a list of addresses is one you have to mean.
 */
const INVITED: ReadonlySet<string> = new Set(
  (process.env.ASK_FROM ?? '').split(',').map((one) => one.trim()).filter(Boolean),
);

/**
 * May this address ask?
 *
 * Both spellings of an invited address count: node reports a caller that reached an IPv4 socket
 * over a dual-stack listener as `::ffff:192.168.1.20`, and somebody writing that in a shell will
 * write `192.168.1.20`.
 */
export function mayAsk(from: string, invited: ReadonlySet<string> = INVITED): boolean {
  if (LOOPBACK.has(from)) return true;
  const bare = from.startsWith('::ffff:') ? from.slice('::ffff:'.length) : from;
  return invited.has(from) || invited.has(bare);
}

/**
 * How long a prompt may be. Not a security boundary — a short prompt can ask for anything a long
 * one can — but a page that has gone wrong sends the same thing repeatedly, and a cap turns that
 * into an error rather than into a very expensive afternoon.
 */
const LONGEST = 8000;

/** How long a run may take before it is given up on, in case something is waiting on a prompt. */
const GIVE_UP = 10 * 60 * 1000;

/**
 * What the page is told, as newline-delimited JSON.
 *
 * Three shapes and no more: prose as it is typed, a note that a tool was used, and the end. The
 * page draws a tool line differently from a sentence, which is what makes "watching it happen"
 * literally true — you see Edit go past with the name of the file on it, and a moment later the
 * creature in the middle of the screen changes.
 */
type Told =
  | { k: 'say'; text: string }
  | { k: 'tool'; name: string; on: string }
  | { k: 'end'; ok: boolean; note: string };

/**
 * One question and everything said in answer to it, kept on this side rather than in the page.
 *
 * This is not tidiness, it is the fix for the one thing that would otherwise break the tool. Claude
 * edits `animals.ts`, Vite sees the file change and reloads the page — and a reply being streamed
 * into that page dies with it, half way through, along with the process producing it. So the run
 * belongs to the server: the page follows it, and a page that has just been reloaded out from
 * under itself simply asks to follow again from the beginning. Which has the pleasant side effect
 * that opening the builder shows you what you last asked and what came back.
 */
interface Run {
  prompt: string;
  told: Told[];
  done: boolean;
  child: ChildProcess | null;
  /** Everyone currently reading this run. A reload leaves one behind and adds another. */
  following: Set<ServerResponse>;
}

/**
 * What a tool call is worth saying: the file it touched, or the pattern, or nothing.
 *
 * The path is cut down to where it sits in the repository, because an absolute one is three lines
 * of prefix everybody already knows followed by the one word that matters, and the panel this is
 * read in is a column beside a picture rather than a terminal.
 */
function about(input: unknown, root: string): string {
  if (typeof input !== 'object' || input === null) return '';
  const i = input as Record<string, unknown>;
  for (const field of ['file_path', 'path', 'pattern', 'command', 'prompt', 'url']) {
    const value = i[field];
    if (typeof value !== 'string') continue;
    const said = value.split(`${root}/`).join('');
    return said.length > 120 ? `${said.slice(0, 117)}...` : said;
  }
  return '';
}

/**
 * One line of `--output-format stream-json`, turned into what the page is told, or nothing.
 *
 * Most of what comes down that pipe is bookkeeping — session ids, hook output, rate limits, a
 * usage summary the size of this file — and none of it belongs on screen. What is worth keeping is
 * the text as it is typed and the tools as they are used. Anything unrecognised is dropped rather
 * than guessed at, because the CLI's own shapes are free to change and a builder that fell over
 * when they did would be worse than one that occasionally says less.
 */
function readEvent(msg: Record<string, unknown>, root: string): Told[] {
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

export function askClaude(): Plugin {
  /** The last question asked, whether or not it has finished. There is only ever one. */
  let run: Run | null = null;

  const tell = (told: Told): void => {
    if (!run) return;
    run.told.push(told);
    const line = `${JSON.stringify(told)}\n`;
    for (const res of run.following) res.write(line);
  };

  const finish = (ok: boolean, note: string): void => {
    if (!run || run.done) return;
    run.done = true;
    run.child = null;
    tell({ k: 'end', ok, note });
    for (const res of run.following) res.end();
    run.following.clear();
  };

  /** Send a reader everything already said, then keep sending as more is. */
  const follow = (res: ServerResponse, from: number): void => {
    res.setHeader('content-type', 'application/x-ndjson');
    res.setHeader('cache-control', 'no-store');
    // Vite sits behind no proxy in development, but a page opened through one would otherwise sit
    // on an empty screen until the whole answer had arrived, which is exactly what this is not for
    res.setHeader('x-accel-buffering', 'no');
    if (!run) { res.end(); return; }
    for (const told of run.told.slice(from)) res.write(`${JSON.stringify(told)}\n`);
    if (run.done) { res.end(); return; }
    run.following.add(res);
    res.on('close', () => { run?.following.delete(res); });
  };

  const start = (prompt: string, cwd: string, res: ServerResponse): void => {
    run = { prompt, told: [], done: false, child: null, following: new Set() };
    const here = run;
    follow(res, 0);

    /*
     * `--include-partial-messages` is what makes this stream a sentence at a time rather than a
     * paragraph at the end, and it only works alongside `--output-format stream-json`, which in
     * turn only works with `--verbose`. All three or none of them.
     */
    const child = spawn('claude', [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode', 'acceptEdits',
    ], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    here.child = child;

    const timer = setTimeout(() => {
      child.kill();
      finish(false, `gave up after ${Math.round(GIVE_UP / 60000)} minutes`);
    }, GIVE_UP);

    // stream-json is one object a line, but a pipe hands them over in whatever sized pieces it
    // likes, so a line may arrive in two chunks and two lines in one
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
        for (const told of readEvent(msg, cwd)) {
          if (told.k === 'say') said = true;
          tell(told);
        }
        // the summary at the end carries the answer as one string. Said again only when nothing
        // was streamed at all, which happens when the work was done by a subagent
        if (msg.type === 'result') {
          if (!said && typeof msg.result === 'string') tell({ k: 'say', text: msg.result });
          clearTimeout(timer);
          const cost = typeof msg.total_cost_usd === 'number' ? `, $${msg.total_cost_usd.toFixed(3)}` : '';
          const seconds = typeof msg.duration_ms === 'number' ? `${Math.round(msg.duration_ms / 1000)}s` : 'done';
          finish(msg.is_error !== true, `${seconds}${cost}`);
        }
      }
    });

    // whatever Claude could not say down the proper channel: a missing login, a bad flag
    let complaint = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { complaint += chunk; });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish(false, `could not run claude: ${err.message}. Is it on the PATH the dev server was started with?`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0, code === 0 ? 'done' : `claude exited ${code}: ${complaint.trim().slice(0, 400)}`);
    });
  };

  return {
    name: 'ai-world:ask-claude',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(ROUTE, (req, res) => {
        const from = req.socket.remoteAddress ?? '';
        if (!mayAsk(from)) {
          res.statusCode = 403;
          res.end(`${ROUTE} answers this machine and whoever ASK_FROM invites, and you are ${from}`);
          return;
        }
        if (req.headers[HEADER] === undefined) {
          res.statusCode = 403;
          res.end(`${ROUTE} wants the ${HEADER} header, which only a page on this origin can send`);
          return;
        }

        // `use` matches a prefix, so /__ask/anything lands here too; only the route itself is a
        // route, or a stray path would be taken for a question and asked
        const asked = new URL(req.url ?? '/', 'http://localhost');
        if (asked.pathname !== '/' && asked.pathname !== '') { res.statusCode = 404; res.end(`${ROUTE} and nothing under it`); return; }

        // reading back: everything said in the last run, from wherever the page got to
        if (req.method === 'GET') {
          const at = Number(asked.searchParams.get('from') ?? 0);
          follow(res, Number.isFinite(at) && at > 0 ? at : 0);
          return;
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end('post a prompt'); return; }

        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const prompt = body.trim();
          if (!prompt) { res.statusCode = 400; res.end('nothing to ask'); return; }
          if (prompt.length > LONGEST) { res.statusCode = 413; res.end(`${LONGEST} characters is the most`); return; }
          // one at a time, because two Claudes editing the same rig is two answers to a question
          // that had one, and the loser's edit is the one you keep by accident
          if (run && !run.done) { res.statusCode = 409; res.end('still answering the last one'); return; }
          server.config.logger.info(`  ➜  Asking Claude: ${prompt.split('\n').pop()?.slice(0, 70) ?? ''}`);
          start(prompt, server.config.root, res);
        });
      });

      /*
       * Where the builder actually is, said once the server knows.
       *
       * `config.server.port` is the port that was *asked for*, which is not where anything ends up
       * when that port is taken — and on this machine 5173 is held by a virtual machine belonging
       * to another project entirely, so the asked-for port and the real one differ routinely.
       * Printing the wrong one is worse than printing nothing: you get an address, you open it, and
       * the browser says it cannot reach the page, which reads as the tool being broken.
       *
       * `resolvedUrls` is filled in after the listener is bound, so this waits for that rather than
       * guessing.
       */
      server.httpServer?.once('listening', () => {
        const at = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
        if (!at) return;
        server.config.logger.info(`  ➜  Builder: ${at}/tools/character-builder.html  (a rig, and Claude to change it)`);
      });
    },
  };
}
