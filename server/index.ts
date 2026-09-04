import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, cleanChat, cleanDelta, cleanName,
  type ClientMessage, type Presence, type ServerMessage, type TradeOffer,
} from './protocol';
import { CLOCK_INTERVAL, SharedWorld, worldPath } from './world';

/**
 * A room per world seed. The server grows no terrain and knows no villages: every client builds
 * the same world from the same seed. What it does keep is the time of day and the short list of
 * things players have changed, so that two people in one world are really in one world.
 */
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? 'server/data';
/** How often presence goes out, in milliseconds. */
const TICK = 100;
/** Drop anyone who has not spoken in this long. */
const TIMEOUT = 30_000;

interface Client {
  socket: WebSocket;
  presence: Presence;
  seed: number;
  lastSeen: number;
  /** Offers this client has made, keyed by the id they were made to. */
  offers: Map<string, TradeOffer>;
}

interface Room {
  clients: Set<Client>;
  world: SharedWorld;
}

const rooms = new Map<number, Room>();
let nextId = 1;
let lastTick = Date.now();

const send = (client: Client, message: ServerMessage): void => {
  if (client.socket.readyState === 1) client.socket.send(JSON.stringify(message));
};

/** The room for a seed, opened from disk the first time anybody asks for it. */
const roomFor = (seed: number, start: { day: number; time: number }): Room => {
  let room = rooms.get(seed);
  if (!room) {
    room = { clients: new Set(), world: new SharedWorld(seed, worldPath(DATA_DIR, seed), { ...start }) };
    rooms.set(seed, room);
  }
  return room;
};

const broadcast = (seed: number, message: ServerMessage, except?: Client): void => {
  const room = rooms.get(seed);
  if (!room) return;
  for (const client of room.clients) if (client !== except) send(client, message);
};

const server = createServer((_req, res) => {
  const players = [...rooms.values()].reduce((sum, room) => sum + room.clients.size, 0);
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`ai.world server\nworlds: ${rooms.size}\nplayers: ${players}\n`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  let client: Client | null = null;

  socket.on('message', (raw) => {
    let message: ClientMessage;
    try { message = JSON.parse(String(raw)) as ClientMessage; } catch { return; }

    if (message.type === 'join') {
      if (message.version !== PROTOCOL_VERSION) {
        socket.send(JSON.stringify({ type: 'error', reason: 'This server speaks a different version.' } satisfies ServerMessage));
        socket.close();
        return;
      }
      const seed = message.seed >>> 0;
      // the first player through the door sets the clock; after that the world keeps its own time
      const room = roomFor(seed, { day: Math.max(1, Math.floor(message.day) || 1), time: Number(message.time) || 0.3 });
      const id = `p${nextId++}`;
      const joining: Client = {
        socket, seed, lastSeen: Date.now(), offers: new Map(),
        presence: {
          id, name: cleanName(message.name), x: 0, z: 0, yaw: 0, walk: 0,
          gear: [], place: 'surface', riding: 'foot',
        },
      };
      client = joining;
      room.clients.add(joining);
      send(joining, {
        type: 'welcome', id, seed,
        players: [...room.clients].filter((c) => c !== joining).map((c) => c.presence),
        clock: room.world.clock,
        deltas: room.world.log,
      });
      broadcast(seed, { type: 'joined', player: joining.presence }, joining);
      return;
    }

    if (!client) return;
    const me = client;
    me.lastSeen = Date.now();
    const room = rooms.get(me.seed);
    if (!room) return;

    switch (message.type) {
      case 'move': {
        const p = me.presence;
        p.x = message.x; p.z = message.z; p.yaw = message.yaw; p.walk = message.walk;
        p.place = String(message.place).slice(0, 60);
        p.riding = message.riding;
        p.gear = message.gear.slice(0, 4).map((id) => String(id).slice(0, 24));
        break;
      }
      case 'say': {
        const text = cleanChat(message.text);
        if (!text) break;
        broadcast(me.seed, { type: 'said', id: me.presence.id, name: me.presence.name, text });
        send(me, { type: 'said', id: me.presence.id, name: me.presence.name, text });
        break;
      }
      case 'delta': {
        const delta = cleanDelta(message.delta);
        if (!delta || !room.world.apply(delta)) break;
        broadcast(me.seed, { type: 'delta', delta, from: me.presence.id }, me);
        break;
      }
      case 'trade-offer': {
        const target = [...room.clients].find((c) => c.presence.id === message.to);
        if (!target) break;
        const offer: TradeOffer = {
          from: me.presence.id,
          to: message.to,
          gold: Math.max(0, Math.floor(message.gold)),
          items: message.items.slice(0, 12).map(([id, n]) => [String(id).slice(0, 24), Math.max(1, Math.floor(n))] as [string, number]),
        };
        me.offers.set(target.presence.id, offer);
        send(target, { type: 'trade-offered', offer, fromName: me.presence.name });
        break;
      }
      case 'trade-accept':
      case 'trade-decline': {
        const other = [...room.clients].find((c) => c.presence.id === message.from);
        const offer = other?.offers.get(me.presence.id);
        if (!other || !offer) break;
        other.offers.delete(me.presence.id);
        const accepted = message.type === 'trade-accept';
        // both sides are told; each applies the change to its own save
        send(other, { type: 'trade-result', with: me.presence.id, accepted, offer });
        send(me, { type: 'trade-result', with: other.presence.id, accepted, offer });
        break;
      }
    }
  });

  const drop = (): void => {
    if (!client) return;
    const leaving = client;
    const room = rooms.get(leaving.seed);
    client = null;
    if (!room) return;
    room.clients.delete(leaving);
    broadcast(leaving.seed, { type: 'left', id: leaving.presence.id });
    if (room.clients.size === 0) {
      // hold the world on disk, then let it go: it will be read back when somebody returns
      room.world.save();
      rooms.delete(leaving.seed);
    }
  };
  socket.on('close', drop);
  socket.on('error', drop);
});

setInterval(() => {
  const now = Date.now();
  const seconds = (now - lastTick) / 1000;
  lastTick = now;

  for (const [seed, room] of rooms) {
    for (const client of room.clients) {
      if (now - client.lastSeen > TIMEOUT) { client.socket.close(); room.clients.delete(client); }
    }
    if (room.clients.size === 0) { room.world.save(); rooms.delete(seed); continue; }

    room.world.tick(seconds);
    const players = [...room.clients].map((c) => c.presence);
    for (const client of room.clients) {
      send(client, { type: 'presence', players: players.filter((p) => p.id !== client.presence.id) });
    }
  }
}, TICK);

/** The clock goes out rarely: clients run their own between messages and simply agree with it. */
setInterval(() => {
  for (const [seed, room] of rooms) broadcast(seed, { type: 'clock', clock: room.world.clock });
}, CLOCK_INTERVAL);

const shutDown = (): void => {
  for (const room of rooms.values()) room.world.save();
  process.exit(0);
};
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);

server.listen(PORT, () => {
  console.log(`ai.world server listening on :${PORT}, worlds in ${DATA_DIR}`);
});
