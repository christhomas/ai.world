import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, cleanName, type ClientMessage, type ServerMessage } from './protocol';
import { handle } from './messages';
import { Rooms } from './rooms';
import { CLOCK_INTERVAL } from './world';

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
  /** Log a line when the server is up. Off in tests. */
  quiet?: boolean;
}

export interface RunningServer {
  /** The port actually listening, which matters when the port asked for was 0. */
  readonly port: number;
  readonly rooms: Rooms;
  /** Save every open world and stop. */
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const dataDir = options.dataDir ?? 'server/data';
  const rooms = new Rooms(dataDir);

  const http = createServer((_req, res) => {
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
        if (now - client.lastSeen > TIMEOUT) { client.socket.close(); rooms.leave(client); }
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
  if (!options.quiet) console.log(`ai.world server listening on :${port}, worlds in ${dataDir}`);

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
  const joining = rooms.admit(socket, room, seed, cleanName(message.name));

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
