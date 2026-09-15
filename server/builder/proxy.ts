import type { IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:http';
import type { Told } from './runs';

/**
 * The portal's end of the builder: the only thing that may speak to the worker.
 *
 * Everything the worker will do is decided here, because here is the only place that knows who
 * anybody is. The worker holds no sessions and checks no passwords — it checks that the caller is
 * *this*, with a shared secret, and does what it is told. Two things checking a login is two things
 * that can disagree about one, and the one that is wrong is the one nobody is looking at.
 *
 * So the rule is short: **a request reaches the worker only if the portal has already decided who
 * is asking.** The account id goes with it, for the book. The session token does not — the worker
 * has no use for it and a credential that travels further than it must is a credential with more
 * places to leak from.
 */

export interface BuilderAt {
  host: string;
  port: number;
  /** What the worker checks. Given to the portal by the deployment, never seen by a page. */
  secret: string;
}

/**
 * Hand a request to the worker and stream the answer straight back.
 *
 * Piped rather than gathered, which is the whole point of the exercise: a run is minutes long and
 * the page is meant to watch it happen. Gathering it would turn the builder back into a form that
 * submits and waits, which is the thing the dev server's streaming was built to avoid.
 */
export function askTheWorker(
  at: BuilderAt, who: string, path: string, body: string | null,
  res: ServerResponse, method = 'POST', watching?: (told: Told) => void,
): void {
  const out = request({
    host: at.host, port: at.port, path, method,
    headers: {
      'x-builder-secret': at.secret,
      // who, for the book. Never the token they signed in with
      'x-builder-who': who,
      ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
    },
  }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, {
      'content-type': answer.headers['content-type'] ?? 'text/plain',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // a page opened through a proxy would otherwise sit on an empty screen until the whole
      // answer had arrived, which is exactly what this is not for
      'x-accel-buffering': 'no',
      ...(answer.headers['x-builder-run'] ? { 'x-builder-run': answer.headers['x-builder-run'] } : {}),
    });
    /*
     * Watched on the way past, rather than asked for afterwards.
     *
     * The worker is a separate process on another machine and the book is here, where the durable
     * database is — so something has to carry what happened across. A reverse channel from the
     * worker would be a second door into this server, which is exactly the thing this arrangement
     * exists to avoid. The answer is already streaming through this function; reading it as it goes
     * costs nothing and adds no door.
     */
    if (watching) {
      let rest = '';
      answer.setEncoding('utf8');
      answer.on('data', (chunk: string) => {
        res.write(chunk);
        rest += chunk;
        const lines = rest.split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { watching(JSON.parse(line) as Told); } catch { /* not a line we know */ }
        }
      });
      answer.on('end', () => res.end());
      return;
    }
    answer.pipe(res);
  });
  out.on('error', (why) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    // the message rather than the address: which machine the worker is on is not a page's business
    res.end(`the builder is not answering (${why.message.split(' ').slice(0, 4).join(' ')})`);
  });
  // a page that gives up should not leave a request open against the worker
  res.on('close', () => { out.destroy(); });
  if (body !== null) out.write(body);
  out.end();
}

/** Read a body with a ceiling, so a page that has gone wrong is an error rather than a memory leak. */
export async function bodyOf(req: IncomingMessage, most = 16 * 1024): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > most) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
