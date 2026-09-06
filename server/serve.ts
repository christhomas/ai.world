import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { COMMANDS, parseCommand } from './commands';
import { PROTOCOL_VERSION, cleanName, type ClientMessage, type ServerMessage } from './protocol';
import { handle } from './messages';
import { FileVault } from './filevault';
import { Rooms, type Wire } from './rooms';
import { CLOCK_INTERVAL } from './world';
import { staticFiles } from './static';

/**
 * The plumbing: a socket per player, a room per world seed, and two clocks — one that sends
 * everybody's position several times a second, one that sends the time of day now and then.
 *
 * There is no world here. Every client grows the same terrain, the same villages and the same
 * dungeons from the same seed, so what travels is people, words, goods, the hour, and the short
 * list of things players have changed.
 */

/** How often presence goes out, in milliseconds. */
const TICK = 100;
/** Drop anyone we have not heard from in this long. */
const TIMEOUT = 30_000;

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

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const dataDir = options.dataDir ?? 'server/data';
  // a server keeps its worlds in files; a Worker running the same simulation keeps them elsewhere
  const rooms = new Rooms(dataDir, new FileVault());

  const pages = options.staticDir ? staticFiles(options.staticDir) : null;
  const http = createServer((req, res) => {
    if ((options.operatorToken || options.watchToken) && req.url === '/operate') {
      operate(rooms, options, req, res);
      return;
    }
    // the status page keeps its own address once there is a game to serve at the root
    if (pages && req.url !== '/status' && pages(req, res)) return;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ai.world server\nworlds: ${rooms.worldCount}\nplayers: ${rooms.playerCount}\n`);
  });
  const sockets = new WebSocketServer({ server: http });

  sockets.on('connection', (socket) => {
    let client: ReturnType<Rooms['admit']> | null = null;

    socket.on('message', (raw) => {
      let message: ClientMessage;
      try { message = JSON.parse(String(raw)) as ClientMessage; } catch { return; }

      if (message.type === 'join') {
        if (client) return;                      // one join per socket
        client = welcome(rooms, socket, message);
        return;
      }
      if (!client) return;                       // nothing counts until somebody has said who they are
      const room = rooms.get(client.seed);
      if (!room) return;
      client.lastSeen = Date.now();
      handle(rooms, client, room, message);
    });

    const drop = (): void => {
      if (!client) return;
      rooms.leave(client);
      client = null;
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  let lastTick = Date.now();
  const ticker = setInterval(() => {
    const now = Date.now();
    const seconds = (now - lastTick) / 1000;
    lastTick = now;

    for (const [seed, room] of rooms.entries()) {
      for (const client of room.clients) {
        if (now - client.lastSeen > TIMEOUT) { client.wire.close(); rooms.leave(client); }
      }
      if (room.clients.size === 0) { rooms.close(seed); continue; }

      room.world.tick(seconds);
      if (room.world.sweepStalls()) rooms.broadcast(seed, { type: 'stalls', stalls: room.world.stalls });
      const players = [...room.clients].map((c) => c.presence);
      for (const client of room.clients) {
        rooms.send(client, { type: 'presence', players: players.filter((p) => p.id !== client.presence.id) });
      }
    }
  }, TICK);

  /** The clock goes out rarely: clients run their own between messages and simply agree with it. */
  const clock = setInterval(() => {
    for (const [seed, room] of rooms.entries()) rooms.broadcast(seed, { type: 'clock', clock: room.world.clock });
  }, CLOCK_INTERVAL);

  const port = await listen(http, options.port ?? 8787);
  if (!options.quiet) {
    console.log(`ai.world server listening on :${port}, worlds in ${dataDir}`);
    if (pages) console.log(`serving the game itself from ${options.staticDir} — open http://<this machine>:${port}/`);
  }

  return {
    port,
    rooms,
    close: async () => {
      clearInterval(ticker);
      clearInterval(clock);
      rooms.saveAll();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((done) => sockets.close(() => done()));
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

/**
 * The handshake. A joining player is told everything they have missed: who is here, what time it
 * is, what has been changed, what is on the market stalls, who this world has met, and whether
 * anything is waiting for them at an inn.
 */
function welcome(rooms: Rooms, socket: import('ws').WebSocket, message: ClientMessage & { type: 'join' }) {
  if (message.version !== PROTOCOL_VERSION) {
    socket.send(JSON.stringify({ type: 'error', reason: 'This server speaks a different version.' } satisfies ServerMessage));
    socket.close();
    return null;
  }
  const seed = message.seed >>> 0;
  // the first player through the door sets the clock; after that the world keeps its own time
  const room = rooms.open(seed, {
    day: Math.max(1, Math.floor(message.day) || 1),
    time: Number(message.time) || 0.3,
  });
  const joining = rooms.admit(wireFor(socket), room, seed, cleanName(message.name));

  rooms.send(joining, {
    type: 'welcome', id: joining.presence.id, seed,
    players: [...room.clients].filter((c) => c !== joining).map((c) => c.presence),
    clock: room.world.clock,
    deltas: room.world.log,
  });
  rooms.send(joining, { type: 'stalls', stalls: room.world.stalls });

  const newcomer = room.world.meet(joining.presence.name);
  rooms.send(joining, { type: 'folk', names: room.world.folk });
  if (newcomer) rooms.broadcast(seed, { type: 'folk', names: room.world.folk }, joining);

  const waiting = room.world.waiting(joining.presence.name);
  if (waiting > 0) rooms.send(joining, { type: 'mail-here', from: `${waiting} parcel${waiting === 1 ? '' : 's'}` });

  rooms.broadcast(seed, { type: 'joined', player: joining.presence }, joining);
  return joining;
}

function listen(http: Server, port: number): Promise<number> {
  return new Promise((done) => {
    http.listen(port, () => {
      const address = http.address();
      done(typeof address === 'object' && address ? address.port : port);
    });
  });
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
