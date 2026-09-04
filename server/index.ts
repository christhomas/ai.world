import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  EMOTES, PARTY_LIMIT, PROTOCOL_VERSION, cleanChat, cleanDelta, cleanLetter, cleanName, cleanStallItem,
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
  /** The party this client travels with, if any. */
  party: Party | null;
  /** Ids this client has asked to travel with, so an answer can be trusted. */
  invited: Set<string>;
}

/** A handful of players travelling together. Parties live only as long as the people in them. */
type Party = Set<Client>;

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

/** Turn a stall message into the request the world understands, dropping anything misshapen. */
const stallRequest = (message: ClientMessage & { type: `stall-${string}` }, id: string):
Parameters<SharedWorld['stall']>[1] | null => {
  switch (message.type) {
    case 'stall-rent': return { do: 'rent', id, village: String(message.village).slice(0, 40) };
    case 'stall-stock': {
      const item = cleanStallItem(message.item);
      return item ? { do: 'stock', id, item } : null;
    }
    case 'stall-buy': return { do: 'buy', id, index: Math.max(0, Math.floor(message.index)) };
    case 'stall-collect': return { do: 'collect', id };
    default: return { do: 'close', id };
  }
};

/** Tell everyone in a party who is in it now. */
const tellParty = (party: Party): void => {
  const members = [...party].map((c) => ({ id: c.presence.id, name: c.presence.name }));
  for (const member of party) send(member, { type: 'party', members });
};

/** Take somebody out of their party, dissolving it if that leaves one person standing. */
const leaveParty = (client: Client): void => {
  const party = client.party;
  if (!party) return;
  party.delete(client);
  client.party = null;
  if (party.size <= 1) {
    for (const last of party) { last.party = null; send(last, { type: 'party', members: [] }); }
    party.clear();
    return;
  }
  tellParty(party);
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
        socket, seed, lastSeen: Date.now(), offers: new Map(), party: null, invited: new Set(),
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
      send(joining, { type: 'stalls', stalls: room.world.stalls });
      const newcomer = room.world.meet(joining.presence.name);
      send(joining, { type: 'folk', names: room.world.folk });
      if (newcomer) broadcast(seed, { type: 'folk', names: room.world.folk }, joining);
      const waiting = room.world.waiting(joining.presence.name);
      if (waiting > 0) send(joining, { type: 'mail-here', from: `${waiting} parcel${waiting === 1 ? '' : 's'}` });
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
      case 'monsters':
      case 'hit': {
        // pure relay: the clients themselves agree on who owns a floor
        const place = String(message.place).slice(0, 60);
        for (const other of room.clients) {
          if (other === me || other.presence.place !== place) continue;
          send(other, message.type === 'monsters'
            ? { type: 'monsters', place, snap: message.snap.slice(0, 64), gone: message.gone.slice(0, 64), from: me.presence.id }
            : { type: 'hit', place, index: Math.floor(message.index), damage: Math.max(0, Math.floor(message.damage)), from: me.presence.id });
        }
        break;
      }
      case 'stall-rent':
      case 'stall-stock':
      case 'stall-buy':
      case 'stall-collect':
      case 'stall-close': {
        const id = String(message.stall).slice(0, 80);
        const request = stallRequest(message, id);
        if (!request) { send(me, { type: 'stall-refused', stall: id, reason: 'There is nothing to put out.' }); break; }
        const reply = room.world.stall(me.presence.name, request);
        if (!reply.ok) { send(me, { type: 'stall-refused', stall: id, reason: reply.reason }); break; }
        if (reply.kind === 'bought') send(me, { type: 'stall-bought', stall: id, item: reply.item, cost: reply.cost });
        if (reply.kind === 'collected') send(me, { type: 'stall-takings', stall: id, gold: reply.gold });
        // one description of the market goes to everyone, rather than a message per change
        broadcast(me.seed, { type: 'stalls', stalls: room.world.stalls });
        send(me, { type: 'stalls', stalls: room.world.stalls });
        break;
      }
      case 'mail-send': {
        const letter = cleanLetter({
          from: me.presence.name, to: message.to, gold: message.gold,
          items: message.items, day: room.world.clock.day,
        });
        if (!letter) { send(me, { type: 'mail-refused', reason: 'There is nothing in that parcel.' }); break; }
        if (letter.to === me.presence.name) { send(me, { type: 'mail-refused', reason: 'Post it to somebody else.' }); break; }
        if (!room.world.folk.includes(letter.to)) { send(me, { type: 'mail-refused', reason: `Nobody here has heard of ${letter.to}.` }); break; }
        room.world.post(letter);
        const recipient = [...room.clients].find((c) => c.presence.name === letter.to);
        if (recipient) send(recipient, { type: 'mail-here', from: letter.from });
        send(me, { type: 'mail-sent', to: letter.to });
        break;
      }
      case 'mail-fetch': {
        send(me, { type: 'mail', letters: room.world.collect(me.presence.name) });
        break;
      }
      case 'party-invite': {
        const target = [...room.clients].find((c) => c.presence.id === message.to);
        if (!target || target === me) break;
        if ((me.party?.size ?? 1) >= PARTY_LIMIT) { send(me, { type: 'error', reason: 'Your party is full.' }); break; }
        me.invited.add(target.presence.id);
        send(target, { type: 'party-invited', from: me.presence.id, fromName: me.presence.name });
        break;
      }
      case 'party-answer': {
        const host = [...room.clients].find((c) => c.presence.id === message.from);
        if (!host || !host.invited.delete(me.presence.id)) break;
        if (!message.yes) { send(host, { type: 'party-declined', name: me.presence.name }); break; }
        leaveParty(me);
        const party: Party = host.party ?? new Set([host]);
        if ((party.size ?? 0) >= PARTY_LIMIT) { send(me, { type: 'error', reason: 'That party is full.' }); break; }
        host.party = party;
        party.add(me);
        me.party = party;
        tellParty(party);
        break;
      }
      case 'party-leave': {
        leaveParty(me);
        send(me, { type: 'party', members: [] });
        break;
      }
      case 'party-deed': {
        const quest = String(message.quest).slice(0, 60);
        for (const mate of me.party ?? []) {
          if (mate !== me) send(mate, { type: 'party-deed', quest, from: me.presence.name });
        }
        break;
      }
      case 'emote': {
        const kind = String(message.kind).slice(0, 12);
        if (!EMOTES[kind]) break;
        broadcast(me.seed, { type: 'emoted', id: me.presence.id, name: me.presence.name, kind });
        break;
      }
      case 'ping': {
        const x = Number(message.x), z = Number(message.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) break;
        const note: ServerMessage = { type: 'pinged', x, z, name: me.presence.name };
        // a rally point is for your companions, or for the whole world when you travel alone
        const audience = me.party ?? room.clients;
        for (const other of audience) if (other !== me) send(other, note);
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
    leaveParty(leaving);
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
      if (now - client.lastSeen > TIMEOUT) { client.socket.close(); leaveParty(client); room.clients.delete(client); }
    }
    if (room.clients.size === 0) { room.world.save(); rooms.delete(seed); continue; }

    room.world.tick(seconds);
    if (room.world.sweepStalls()) broadcast(seed, { type: 'stalls', stalls: room.world.stalls });
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
