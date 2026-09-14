import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { COMMANDS, parseCommand } from './commands';
import type { ServerMessage, WorldRecord } from './protocol';
import { FileVault } from './filevault';
import { Simulation } from './sim';
import { Rooms, type Wire } from './rooms';
import { staticFiles } from './static';
import { addAccount, migrate as migrateAccounts, sweepSessions } from './tools/accounts';
import { migrateDomain, openDurable } from './durable/db';
import { MINDS_SCHEMA } from './durable/minds';
import { lastRuns, migrateBook, writeDown } from './builder/book';
import type { BuilderAt } from './builder/proxy';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { bootstrapAccount, portalFor, whatIsAsked } from './tools/portal';

/**
 * The plumbing: a socket per player, a room per world seed, and two clocks — one that sends
 * everybody's position several times a second, one that sends the time of day now and then.
 *
 * There is no world here. Every client grows the same terrain, the same villages and the same
 * dungeons from the same seed, so what travels is people, words, goods, the hour, and the short
 * list of things players have changed.
 */

export interface ServerOptions {
  /** 0 asks the operating system for a free port, which is what the tests want. */
  port?: number;
  dataDir?: string;
  /**
   * A built copy of the game to hand out alongside the world. Set it and one box serves both:
   * the page over http and the world over ws, on one origin, which is what makes a server on
   * your own network reachable without a certificate.
   */
  staticDir?: string;
  /** Log a line when the server is up. Off in tests. */
  quiet?: boolean;
  /**
   * The password for `POST /operate`, which sends a command to the players in a world.
   *
   * Given none, the route is not registered at all. That is the difference between a door that is
   * locked and a door that is not there, and for a box on somebody's home network reachable from
   * the internet, the second is the one worth having. `index.ts` reads it from the environment.
   */
  operatorToken?: string;
  /**
   * A second password that may only ask questions.
   *
   * A dashboard watching a world wants `where` and `towns`; it has no business teleporting anybody.
   * Two tokens rather than one with a flag, because the difference is who holds it — a thing that
   * can only look is a thing that can be given to something you trust less.
   */
  watchToken?: string;
  /**
   * Where the tools portal keeps its accounts and sessions, and the key it signs with.
   *
   * Given neither, the portal is not registered at all — the same rule `/operate` runs on, and for
   * the same reason: on a box reachable from the internet, a door that is not there beats a door
   * that is locked. `index.ts` reads both from the environment.
   */
  toolsSecret?: string;
  /**
   * Where the durable database lives. Defaults to `ai-world.sqlite` beside the worlds; `null`
   * turns it off entirely, which is what a test that wants nothing on disk asks for.
   */
  durableDb?: string | null;
  /** Whether an `X-Forwarded-Proto` in front of this server can be believed. See `overHttps`. */
  trustProxy?: boolean;
  /**
   * Where the builder's worker is, if this deployment has one behind it.
   *
   * A separate process on the machine with the checkout, which this server reaches and nothing else
   * can — see `builder/worker.ts`. Left out, the two build routes are not there at all: a game
   * server with no source host behind it should not have a door onto one.
   */
  builder?: BuilderAt;
}

export interface RunningServer {
  /** The port actually listening, which matters when the port asked for was 0. */
  readonly port: number;
  readonly rooms: Rooms;
  /** Save every open world and stop. */
  close(): Promise<void>;
}

/**
 * A websocket, as the roster sees it.
 *
 * The whole of what the server needs from a connection is a way to send text, a way to know it is
 * still there, and a way to end it — which is also the whole of what a `MessagePort` to a Worker
 * offers. Keeping it this thin is what lets the same simulation run on a server and inside a
 * browser tab without knowing which it is in.
 */
function wireFor(socket: WebSocket): Wire {
  return {
    send: (text) => socket.send(text),
    get open(): boolean { return socket.readyState === 1; },
    close: () => socket.close(),
  };
}

/**
 * Open the portal's database, make its first account if the deployment said to, and hand back
 * something the router can offer a request to.
 *
 * `takes` answers synchronously and the work happens after, because `createServer`'s handler is not
 * an async function and a route that returns a promise to a caller checking it for `true` is a
 * route that never fires. The handler owns the response from the moment it says yes.
 */
function openTools(
  db: DatabaseSync, secret: string, trustProxy: boolean, quiet: boolean,
  sim: Simulation, builder?: BuilderAt,
) {
  migrateAccounts(db);
  // the builder's own book lives in the same file, as its own domain: who asked for what, and
  // what came of it. See `builder/book.ts`
  if (builder) migrateBook(db);
  const { made, say } = bootstrapAccount(db, process.env, addAccount);
  if (say && !quiet) (made ? console.log : console.error)(say);
  sweepSessions(db);
  const portal = portalFor({
    db, secret, trustProxy, builder,
    // The portal has already proved the session before calling this. No operator token is made,
    // copied into a page, or sent over the wire.
    survey: (req, res) => registry(sim, null, req, res),
    // written where the durable database is, from what the answer says as it streams past
    record: builder ? (run, id) => {
      try { writeDown(db, id, run); } catch (why) {
        // a record that cannot be written safely must not take the run down with it, but it is a
        // bug in whatever built it and has to be said out loud rather than dropped
        console.error(`a builder run was not written down: ${String(why)}`);
      }
    } : undefined,
    recorded: builder ? () => lastRuns(db, 8) : undefined,
  });
  return {
    takes: (req: IncomingMessage, res: ServerResponse): boolean => {
      if (whatIsAsked(req.method, req.url).want === 'nothing') return false;
      void portal(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('the tools portal could not answer that');
      });
      return true;
    },
  };
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const dataDir = options.dataDir ?? 'server/data';
  // The simulation is the game. This is the thing that gives it sockets, files and an address; a
  // Web Worker gives the same simulation a MessagePort and a browser's idea of storage instead.
  // `ground: true`: the server grows the world it is serving and owns the creatures in it, which
  // is what makes two players in one field look at the same deer. It costs about a tenth of a
  // second and twenty megabytes a world, measured, plus a couple of per cent of a core per player.
  /*
   * The one durable database, if this deployment has been given one.
   *
   * Both the tools portal and the half of a villager that no seed implies live in it, in their own
   * tables — see `durable/db.ts` for why that is one file rather than two. Opened here so that the
   * simulation and the portal are handed the same handle rather than each opening the same path,
   * which is two write locks on one file and a `SQLITE_BUSY` waiting to happen.
   */
  const durable = options.durableDb === null ? null
    : openDurable(options.durableDb ?? join(dataDir, 'ai-world.sqlite'));
  // the villagers' own tables, migrated here rather than in `minds.ts`: that file is imported by
  // `sim.ts`, which a page playing alone runs in a Web Worker, and a value import of `node:sqlite`
  // anywhere in that chain is a browser bundle reaching for a node built-in
  if (durable) migrateDomain(durable, 'register', MINDS_SCHEMA);
  const sim = new Simulation({ dataDir, vault: new FileVault(), ground: true, minds: durable ?? undefined });
  const rooms = sim.rooms;

  const pages = options.staticDir ? staticFiles(options.staticDir) : null;
  /*
   * The tools portal, if this deployment has been given somewhere to keep accounts and something to
   * sign with. Opened before the first request rather than on one, because a bootstrap that fails
   * has to fail at boot where somebody is reading the log.
   */
  const tools = durable && options.toolsSecret
    ? openTools(durable, options.toolsSecret, options.trustProxy ?? false, options.quiet ?? false,
      sim, options.builder)
    : null;
  const http = createServer((req, res) => {
    if (tools && tools.takes(req, res)) return;
    if ((options.operatorToken || options.watchToken) && req.url === '/operate') {
      operate(rooms, options, req, res);
      return;
    }
    /*
     * The Domesday Book, which is a window rather than a door.
     *
     * Behind the same tokens `/operate` uses and happy with the read-only one, because that is what
     * this is: a survey of a world, computed from state that already exists, changing nothing. A
     * world nobody has opened is grown to answer — a book that said "nothing there" about an unvisited
     * county would be a book about visitors.
     */
    if ((options.operatorToken || options.watchToken) && req.url?.startsWith('/registry')) {
      registry(sim, options, req, res);
      return;
    }
    // A named invite reaches this before the game is grown, so seed, kind and manifest all come
    // from the server's record rather than from facts copied into a link.
    if (req.method === 'GET' && req.url?.startsWith('/world?')) {
      namedWorld(rooms, req, res);
      return;
    }
    // the status page keeps its own address once there is a game to serve at the root
    if (pages && req.url !== '/status' && pages(req, res)) return;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ai.world server\nworlds: ${rooms.worldCount}\nplayers: ${rooms.playerCount}\n`);
  });
  const sockets = new WebSocketServer({ server: http });

  // every socket is a player attached to the simulation, and nothing here knows what they say
  sockets.on('connection', (socket) => {
    const player = sim.attach(wireFor(socket));
    socket.on('message', (raw) => player.receive(String(raw)));
    socket.on('close', () => player.leave());
    socket.on('error', () => player.leave());
  });

  sim.start();

  const port = await listen(http, options.port ?? 8787);
  if (!options.quiet) {
    console.log(`ai.world server listening on :${port}, worlds in ${dataDir}`);
    if (pages) console.log(`serving the game itself from ${options.staticDir} — open http://<this machine>:${port}/`);
  }

  return {
    port,
    rooms,
    close: async () => {
      sim.stop();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((done) => sockets.close(() => done()));
      await new Promise<void>((done) => http.close(() => done()));
      // and the database, or a test that opens twenty servers holds twenty write locks
      durable?.close();
    },
  };
}

function listen(http: Server, port: number): Promise<number> {
  return new Promise((done) => {
    http.listen(port, () => {
      const address = http.address();
      done(typeof address === 'object' && address ? address.port : port);
    });
  });
}
/** Resolve one durable world name for a title/invite before the client grows its country. */
function namedWorld(rooms: Rooms, req: IncomingMessage, res: ServerResponse): void {
  const asked = new URL(req.url ?? '/', 'http://world.invalid').searchParams.get('name');
  const record: WorldRecord | undefined = rooms.worldRecord(asked);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  if (!record) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'No world has that name.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(record));
}

/**
 * Operating a running world from outside it.
 *
 * A line of text goes to the players in one world — or to everybody, if no seed is named — and they
 * run it on their own command bus. The server does not run it: today it owns no simulation to run
 * one against, and saying so plainly here is better than pretending otherwise. When the simulation
 * moves across (`docs/server-authority.md`) this is where it will be run instead, and the shape of
 * the request will not have to change.
 *
 * The token is compared in full and only after the body has been read, so a wrong one costs the
 * same as a right one. It is not a login: whoever has it can do anything the vocabulary allows.
 */
/**
 * Hand out the survey of one world.
 *
 * A GET, because it is a read and because a person wants to be able to open it in a browser. The
 * seed comes off the query string; without one it answers about every world the server is holding,
 * which is the shape somebody wants when they are watching a box rather than a country.
 *
 * Both tokens are accepted and neither is privileged over the other here. `/operate` distinguishes
 * them because it can change a world; nothing down this path can, so a watcher sees exactly what an
 * operator does.
 */
function registry(sim: Simulation, options: ServerOptions | null, req: IncomingMessage, res: ServerResponse): void {
  /*
   * Readable from a page that is not this server's.
   *
   * `tools/registry.html` is opened off a dev server or a file while the world it is surveying runs
   * somewhere else, and a custom header is enough to make a browser ask permission first — so
   * without this the tool cannot read its own endpoint from anywhere but the server's own origin.
   *
   * A wildcard is safe here and would not be on `/operate`. There is nothing to steal: the door is
   * a token in a header rather than a cookie, so a browser will not attach it on somebody else's
   * behalf, and every answer is a read. The rule that matters is the one in the router — this path
   * cannot change a world — and not who is allowed to ask.
   */
  const allow = options ? {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'x-operator-token, authorization',
    'access-control-max-age': '600',
  } : { 'cache-control': 'no-store' };
  const say = (code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json', ...allow });
    res.end(JSON.stringify(body));
  };
  if (options && req.method === 'OPTIONS') { res.writeHead(204, allow); res.end(); return; }
  if (req.method !== 'GET') { say(405, { error: 'ask, do not tell' }); return; }

  if (options) {
    const given = String(req.headers['x-operator-token'] ?? '')
      || String(req.headers.authorization ?? '').replace(/^Bearer /, '')
      || new URL(req.url ?? '/', 'http://x').searchParams.get('token') || '';
    const known = given !== ''
      && (given === options.operatorToken || given === options.watchToken);
    if (!known) { say(401, { error: 'no' }); return; }
    if (!withinRate(given)) { say(429, { error: 'too many' }); return; }
  }

  const query = new URL(req.url ?? '/', 'http://x').searchParams;
  const asked = query.get('seed');
  if (asked !== null) {
    const seed = Number(asked);
    if (!Number.isFinite(seed)) { say(400, { error: 'that is not a seed' }); return; }
    const book = sim.surveyOf(seed);
    if (!book) { say(404, { error: `no world ${seed}` }); return; }
    /*
     * And what has happened since the caller last looked.
     *
     * `since` is a number they were handed rather than a time, because a world lives a day in a
     * second and two things in one millisecond are ordinary — a reader polling on a clock would see
     * one of them and never the other. Absent means "everything the ring still holds", which is
     * what somebody opening the page for the first time wants.
     */
    const since = Number(query.get('since') ?? 0);
    const chronicle = sim.chronicleOf(seed);
    say(200, {
      ...book,
      happened: chronicle.since(Number.isFinite(since) ? since : 0),
      latest: chronicle.latest,
    });
    return;
  }
  // no seed: whatever this server is presently holding, which is what a watcher wants
  const books = sim.rooms.entries()
    .map(([seed]) => sim.surveyOf(seed))
    .filter((b): b is NonNullable<typeof b> => b !== null);
  say(200, { worlds: books.length, books });
}

function operate(rooms: Rooms, options: ServerOptions, req: IncomingMessage, res: ServerResponse): void {
  const say = (code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') { say(405, { error: 'post a command' }); return; }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    // a command is a line, not a payload: anything longer is somebody trying it on
    if (body.length > 4_000) req.destroy();
  });
  req.on('end', () => {
    const given = String(req.headers['x-operator-token'] ?? '')
      || String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const may: 'anything' | 'ask' | 'nothing' =
      options.operatorToken && given === options.operatorToken ? 'anything'
        : options.watchToken && given === options.watchToken ? 'ask'
          : 'nothing';
    if (may === 'nothing') { say(401, { error: 'no' }); return; }
    // A busy door is a door being tried. The limit is far above what operating a world takes and
    // far below what a script working through a wordlist would want.
    if (!withinRate(given)) { say(429, { error: 'too many' }); return; }

    let asked: { line?: string; seed?: number };
    try { asked = JSON.parse(body || '{}') as { line?: string; seed?: number }; }
    catch { say(400, { error: 'that is not json' }); return; }

    const line = (asked.line ?? '').trim();
    // read here as well as on the client, so a line nobody could run is refused at the door rather
    // than sent to every player in the world for each of them to reject separately
    const read = parseCommand(line, 'operator');
    if (!read.ok) { say(400, { error: read.error }); return; }

    if (may === 'ask' && !COMMANDS[read.command.name]?.reads) {
      say(403, { error: `${read.command.name} changes the world; this token may only ask` });
      return;
    }

    const message: ServerMessage = { type: 'command', line, issuer: 'operator' };
    const sent = asked.seed === undefined ? rooms.everyone(message) : rooms.broadcast(asked.seed, message);
    // Said out loud, because a command sent into somebody else's world should leave a trace in the
    // place a person would look for one. There is no other record: the game is on the clients.
    console.log(`operate: ${may === 'ask' ? 'watcher' : 'operator'} ran ${JSON.stringify(line)}`
      + ` on ${asked.seed === undefined ? 'every world' : `world ${asked.seed}`} — ${sent} player${sent === 1 ? '' : 's'}`);
    say(200, { sent: line, players: sent });
  });
}

/**
 * How often one token may knock, and how a knock is counted.
 *
 * A fixed window rather than anything cleverer: the point is to make a wordlist pointless, not to
 * be fair to a busy operator, and a minute of memory for something with no state to lose is the
 * whole of what this deserves.
 */
const KNOCKS = 120;
const WINDOW = 60_000;
const knocks = new Map<string, { until: number; count: number }>();

function withinRate(token: string): boolean {
  const now = Date.now();
  const seen = knocks.get(token);
  if (!seen || seen.until < now) { knocks.set(token, { until: now + WINDOW, count: 1 }); return true; }
  seen.count++;
  // whoever is knocking this hard is not operating a world
  return seen.count <= KNOCKS;
}
