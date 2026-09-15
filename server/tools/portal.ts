import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { beginSession, endSession, howManyAccounts, sessionStands, whoIsThis } from './accounts';
import { TOKEN_LASTS, readToken, signToken } from './tokens';
import registryPage from '../../tools/registry.html?raw';

/**
 * A door in front of the tools, so nobody has to paste an operator token into a page again.
 *
 * The Domesday Book asks for a token in its own form today, which means the token lives in
 * somebody's clipboard, in their browser's memory of what they typed, and in whatever they pasted
 * it into by accident. The Character Builder is worse: it has no door at all, because it has never
 * been reachable anywhere but a dev server.
 *
 * So: log in once, see what there is, and use it. The tools get the server's identity rather than
 * the other way round — a page behind this never sees an operator token, and cannot leak one.
 *
 * ## What is here and what is not
 *
 * This is the door and the catalogue. Running the Character Builder's Claude half through it is
 * #103 and is deliberately a separate thing, because it wants a worker on another machine with
 * different privileges; putting a command runner behind the same `if` as a login form is how a
 * portal becomes the most dangerous thing in a deployment.
 */

/** What the portal was asked for. Worked out from the request alone, so it can be read in a test. */
export type Asked =
  | { want: 'login-form' }
  | { want: 'login' }
  | { want: 'logout' }
  | { want: 'catalogue' }
  | { want: 'registry-data' }
  | { want: 'tool'; id: string }
  | { want: 'nothing' };

/** The tools a signed-in person may open. Named here so the catalogue and the guard cannot differ. */
export const CATALOGUE: readonly { id: string; name: string; blurb: string }[] = [
  { id: 'character-builder', name: 'Character Builder', blurb: 'Every creature and prop, and a prompt that changes one.' },
  { id: 'registry', name: 'Domesday Book', blurb: 'A survey of a world: who lives where, and what they hold.' },
];

/**
 * What this request is asking the portal for.
 *
 * Everything under `/tools` and nothing else, so the portal cannot accidentally shadow the game at
 * the root. A trailing slash is the same page as none — that is a thing people type, not a
 * different request — and anything with `..` in it is nothing at all, because this id reaches a
 * lookup and a path traversal that gets as far as the lookup has already won half its argument.
 */
export function whatIsAsked(method: string | undefined, url: string | undefined): Asked {
  if (!url) return { want: 'nothing' };
  const path = url.split('?')[0].replace(/\/+$/, '') || '/tools';
  if (path !== '/tools' && !path.startsWith('/tools/')) return { want: 'nothing' };
  if (path === '/tools') return { want: 'catalogue' };
  if (path === '/tools/login') return { want: method === 'POST' ? 'login' : 'login-form' };
  if (path === '/tools/logout') return method === 'POST' ? { want: 'logout' } : { want: 'nothing' };
  if (path === '/tools/registry/data') return { want: 'registry-data' };
  const id = path.slice('/tools/'.length);
  if (id === '' || id.includes('/') || id.includes('..')) return { want: 'nothing' };
  return { want: 'tool', id };
}

/** One cookie out of a `Cookie:` header, or nothing. */
export function cookieFrom(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return null; }
  }
  return null;
}

/** The name the session cookie goes by. `__Host-` where it can be, which pins it to this origin. */
export const COOKIE = 'ai_world_tools';

/**
 * The `Set-Cookie` line for a session.
 *
 * `HttpOnly` so script cannot read it, which is the difference between one bad dependency and a
 * stolen session. `SameSite=Strict` because nothing on another site has any business making a
 * request to this one on somebody's behalf. `Path=/tools` so it is not sent with the game's own
 * traffic at the root, which is most of the requests this server ever sees.
 *
 * **`Secure` only over https**, and that is not a compromise: a `Secure` cookie is simply not sent
 * over plain http, so setting it unconditionally would break every local and in-house deployment
 * silently — a login that appears to work and never sticks. The public hostname is behind TLS and
 * gets the flag; a box on a home network does not, and does not need it.
 */
export function cookieFor(token: string, opts: { secure: boolean; seconds?: number }): string {
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/tools',
    `Max-Age=${opts.seconds ?? TOKEN_LASTS}`,
  ];
  if (opts.secure) bits.push('Secure');
  return bits.join('; ');
}

/** And the one that takes it away again. Same attributes, or the browser keeps the old one. */
export function cookieCleared(opts: { secure: boolean }): string {
  return cookieFor('', { ...opts, seconds: 0 });
}

/**
 * Whether this request arrived over https.
 *
 * Behind a reverse proxy the socket is plain http and only `X-Forwarded-Proto` knows, which is a
 * header anybody can send — so it is believed only when the deployment says there is a proxy in
 * front. A server told it is public without a proxy reads its own socket and nothing else.
 */
export function overHttps(req: IncomingMessage, trustProxy: boolean): boolean {
  if (trustProxy) {
    const said = req.headers['x-forwarded-proto'];
    const first = (Array.isArray(said) ? said[0] : said)?.split(',')[0]?.trim();
    if (first) return first === 'https';
  }
  return (req.socket as { encrypted?: boolean }).encrypted === true;
}

/** Who this request is, or nobody: the signature first, then the session row that can revoke it. */
export function whoIsAsking(db: DatabaseSync, cookie: string | null, secret: string): string | null {
  if (!cookie) return null;
  const claims = readToken(cookie, secret);
  if (!claims) return null;
  return sessionStands(db, claims.jti) ? claims.sub : null;
}

export interface PortalOptions {
  db: DatabaseSync;
  /** The key the notes are signed with. No default, ever; see `bootstrapAccount`. */
  secret: string;
  /** Whether an `X-Forwarded-Proto` header in front of this server can be believed. */
  trustProxy?: boolean;
  /** The read-only Domesday answer, reached only after this portal has established a session. */
  survey?: (req: IncomingMessage, res: ServerResponse) => void;
}

const registryThroughPortal = registryPage
  .replace('  <input id="where" placeholder="http://localhost:8080" value="">\n', '')
  .replace('  <input id="token" type="password" placeholder="operator or watch token">\n', '');

const LOGIN_WINDOW = 60_000;
const LOGIN_ATTEMPTS = 5;

const html = (res: ServerResponse, code: number, body: string, headers: Record<string, string> = {}): void => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
};

const page = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<title>${title}</title><style>`
  + `body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#14161c;color:#e7e9f0;display:flex;min-height:100vh;align-items:center;justify-content:center}`
  + `main{width:min(34rem,92vw);padding:2rem}h1{font-size:1.4rem;letter-spacing:.02em}`
  + `a{color:inherit;text-decoration:none}label{display:block;margin:.8rem 0 .2rem;font-size:.85rem;opacity:.7}`
  + `input{width:100%;padding:.6rem .7rem;border-radius:.4rem;border:1px solid #39405a;background:#1b1e27;color:inherit;font:inherit}`
  + `button{margin-top:1rem;padding:.6rem 1rem;border-radius:.4rem;border:0;background:#5b76ff;color:#fff;font:inherit;cursor:pointer}`
  + `.card{display:block;padding:1rem;margin:.6rem 0;border:1px solid #39405a;border-radius:.5rem}`
  + `.card:hover{border-color:#5b76ff}.blurb{opacity:.65;font-size:.9rem}.why{color:#ffb4a2;font-size:.9rem;margin-top:.8rem}`
  + `</style><main>${body}</main>`;

const loginPage = (why?: string): string => page('Sign in — ai.world tools', `
  <h1>ai.world tools</h1>
  <form method="post" action="/tools/login">
    <label for="u">Name</label><input id="u" name="name" autocomplete="username" autofocus>
    <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password">
    <button type="submit">Sign in</button>
  </form>${why ? `<p class="why">${why}</p>` : ''}`);

const cataloguePage = (): string => page('ai.world tools', `
  <h1>ai.world tools</h1>
  ${CATALOGUE.map((tool) => `<a class="card" href="/tools/${tool.id}"><strong>${tool.name}</strong>`
    + `<div class="blurb">${tool.blurb}</div></a>`).join('')}
  <form method="post" action="/tools/logout"><button type="submit">Sign out</button></form>`);

/** Read a form body, with a ceiling on it: a login form is small and a megabyte of it is an attack. */
async function formBody(req: IncomingMessage, most = 4096): Promise<URLSearchParams | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > most) return null;
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The portal, as one thing the server can ask to take a request.
 *
 * Returns whether it took it, so the caller's routing stays a list of `if`s and this file owns
 * every path under `/tools` rather than having them spread across two files.
 */
export function portalFor(options: PortalOptions) {
  const { db, secret } = options;
  const secureFor = (req: IncomingMessage): boolean => overHttps(req, options.trustProxy ?? false);
  const attempts = new Map<string, { since: number; count: number }>();
  const requester = (req: IncomingMessage): string => {
    if (options.trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };
  const mayTry = (req: IncomingMessage, now = Date.now()): { allowed: boolean; key: string } => {
    const key = requester(req);
    const previous = attempts.get(key);
    if (!previous && attempts.size >= 1_000) {
      for (const [address, entry] of attempts) {
        if (now - entry.since >= LOGIN_WINDOW) attempts.delete(address);
      }
      if (attempts.size >= 1_000) attempts.delete(attempts.keys().next().value as string);
    }
    const entry = !previous || now - previous.since >= LOGIN_WINDOW
      ? { since: now, count: 1 } : { ...previous, count: previous.count + 1 };
    attempts.set(key, entry);
    return { allowed: entry.count <= LOGIN_ATTEMPTS, key };
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const asked = whatIsAsked(req.method, req.url);
    if (asked.want === 'nothing') return false;
    const who = whoIsAsking(db, cookieFrom(req.headers.cookie, COOKIE), secret);

    if (asked.want === 'login-form') {
      if (who) { res.writeHead(303, { location: '/tools/' }); res.end(); return true; }
      html(res, 200, loginPage());
      return true;
    }

    if (asked.want === 'login') {
      const tried = mayTry(req);
      if (!tried.allowed) {
        html(res, 429, loginPage('Too many attempts. Wait a minute and try again.'), { 'retry-after': '60' });
        return true;
      }
      const form = await formBody(req);
      const name = form?.get('name') ?? '';
      const password = form?.get('password') ?? '';
      const account = name && password ? await whoIsThis(db, name, password) : null;
      if (!account) {
        // one sentence for both, because "no such user" tells somebody which names to keep trying
        html(res, 401, loginPage('That name and password do not go together.'));
        return true;
      }
      attempts.delete(tried.key);
      const session = beginSession(db, account.id);
      const token = signToken({ sub: account.id, jti: session.id }, secret);
      res.writeHead(303, { location: '/tools/', 'set-cookie': cookieFor(token, { secure: secureFor(req) }) });
      res.end();
      return true;
    }

    if (asked.want === 'logout') {
      const cookie = cookieFrom(req.headers.cookie, COOKIE);
      const claims = cookie ? readToken(cookie, secret) : null;
      if (claims) endSession(db, claims.jti);
      res.writeHead(303, { location: '/tools/login', 'set-cookie': cookieCleared({ secure: secureFor(req) }) });
      res.end();
      return true;
    }

    // everything past here wants somebody signed in, and says so the same way
    if (!who) {
      res.writeHead(303, { location: '/tools/login' });
      res.end();
      return true;
    }

    if (asked.want === 'catalogue') { html(res, 200, cataloguePage()); return true; }

    if (asked.want === 'registry-data') {
      if (options.survey) options.survey(req, res);
      else html(res, 404, page('Not a tool', '<h1>The Domesday Book is not available.</h1>'));
      return true;
    }

    const tool = CATALOGUE.find((one) => one.id === asked.id);
    if (!tool) { html(res, 404, page('Not a tool', '<h1>There is no such tool.</h1>')); return true; }
    if (tool.id === 'registry' && options.survey) { html(res, 200, registryThroughPortal); return true; }
    // #103 puts the Character Builder's worker behind this; until then a tool is a named door that
    // is open to the right people and honest about having nothing behind it yet
    html(res, 200, page(tool.name, `<h1>${tool.name}</h1><p class="blurb">${tool.blurb}</p>`
      + `<p class="why">Not wired up yet — see issue #103.</p><a class="card" href="/tools/">Back</a>`));
    return true;
  };
}

/**
 * Put the first account in, from the deployment's own secrets, or refuse to start.
 *
 * Fails closed and says how to open it, which is the one thing a bootstrap must get right: a portal
 * that invents a default password is a portal with a known password, and one that quietly starts
 * with nobody in it is a locked building whose owner finds out at the worst moment.
 *
 * The password is read once and never logged. What the log gets is the name and the fact, because
 * an operator needs to know an account was made and nobody needs the password twice.
 */
export function bootstrapAccount(
  db: DatabaseSync, env: Record<string, string | undefined>,
  add: (db: DatabaseSync, name: string, password: string) => unknown,
): { made: boolean; say: string } {
  if (howManyAccounts(db) > 0) return { made: false, say: '' };
  const name = env.TOOLS_ADMIN_USER?.trim();
  const password = env.TOOLS_ADMIN_PASSWORD;
  if (!name || !password) {
    return {
      made: false,
      say: 'the tools portal has no accounts and no TOOLS_ADMIN_USER/TOOLS_ADMIN_PASSWORD to make one from'
        + ' — set both in the deployment secrets and restart; the portal stays shut until then',
    };
  }
  if (password.length < 12) {
    return { made: false, say: 'TOOLS_ADMIN_PASSWORD is shorter than twelve characters; the portal stays shut' };
  }
  add(db, name, password);
  return { made: true, say: `the tools portal made its first account, ${name}` };
}
