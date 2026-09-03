import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, cleanChat, cleanName,
  type ClientMessage, type Presence, type ServerMessage, type TradeOffer,
} from './protocol';

/**
 * A room per world seed. The server keeps no world state at all: every client derives the same
 * world from the seed, so all this has to do is pass along where people are, what they say, and
 * what they hand each other.
 */
const PORT = Number(process.env.PORT ?? 8787);
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

const rooms = new Map<number, Set<Client>>();
let nextId = 1;

const send = (client: Client, message: ServerMessage): void => {
  if (client.socket.readyState === 1) client.socket.send(JSON.stringify(message));
};

const room = (seed: number): Set<Client> => {
  let set = rooms.get(seed);
  if (!set) { set = new Set(); rooms.set(seed, set); }
  return set;
};

const broadcast = (seed: number, message: ServerMessage, except?: Client): void => {
  for (const client of room(seed)) if (client !== except) send(client, message);
};

const server = createServer((_req, res) => {
  const players = [...rooms.values()].reduce((sum, set) => sum + set.size, 0);
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
      const id = `p${nextId++}`;
      const joining: Client = {
        socket,
        seed: message.seed >>> 0,
        lastSeen: Date.now(),
        offers: new Map(),
        presence: {
          id, name: cleanName(message.name), x: 0, z: 0, yaw: 0, walk: 0,
          gear: [], place: 'surface', riding: 'foot',
        },
      };
      client = joining;
      room(joining.seed).add(joining);
      send(joining, {
        type: 'welcome', id, seed: joining.seed,
        players: [...room(joining.seed)].filter((c) => c !== joining).map((c) => c.presence),
      });
      broadcast(joining.seed, { type: 'joined', player: joining.presence }, joining);
      return;
    }

    if (!client) return;
    const me = client;
    me.lastSeen = Date.now();

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
      case 'trade-offer': {
        const target = [...room(me.seed)].find((c) => c.presence.id === message.to);
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
        const other = [...room(me.seed)].find((c) => c.presence.id === message.from);
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
    room(leaving.seed).delete(leaving);
    broadcast(leaving.seed, { type: 'left', id: leaving.presence.id });
    if (room(leaving.seed).size === 0) rooms.delete(leaving.seed);
    client = null;
  };
  socket.on('close', drop);
  socket.on('error', drop);
});

setInterval(() => {
  const now = Date.now();
  for (const [seed, set] of rooms) {
    for (const client of set) {
      if (now - client.lastSeen > TIMEOUT) { client.socket.close(); set.delete(client); }
    }
    if (set.size === 0) { rooms.delete(seed); continue; }
    const players = [...set].map((c) => c.presence);
    for (const client of set) {
      send(client, { type: 'presence', players: players.filter((p) => p.id !== client.presence.id) });
    }
  }
}, TICK);

server.listen(PORT, () => {
  console.log(`ai.world server listening on :${PORT}`);
});
