import type { WebSocket } from 'ws';
import type { PartyMember, Presence, ServerMessage, TradeOffer } from './protocol';
import { SharedWorld, worldPath } from './world';

/**
 * Who is in which world, and who is with whom. This is the roster: it knows nothing about what
 * any message means, only about people — how to reach one, how a party holds together, and when
 * a world has emptied and can be put back on disk.
 *
 * `messages.ts` decides what to do about a message; this decides who hears it.
 */

/** One connected player. */
export interface Client {
  socket: WebSocket;
  presence: Presence;
  seed: number;
  /** When we last heard anything from them, for dropping the silent. */
  lastSeen: number;
  /** Offers this client has made, keyed by the id they were made to. */
  offers: Map<string, TradeOffer>;
  /** The party this client travels with, if any. */
  party: Party | null;
  /** Ids this client has asked to travel with, so an answer can be trusted. */
  invited: Set<string>;
  /** Ids this client has challenged to a bout, for the same reason. */
  challenged: Set<string>;
  /** Ids this client has asked to a fight with sides, so an answer can be trusted. */
  mustered: Set<string>;
  /** Who they are fighting with sides now. */
  warband: Client | null;
  /** How many hired men they say are behind them, which is all the far side is ever told. */
  swords: number;
  /** Who they are dueling now. */
  duel: Client | null;
}

/** A handful of players travelling together. A party lives only as long as the people in it. */
export type Party = Set<Client>;

/** Everyone in one world, and the little of that world the server keeps. */
export interface Room {
  clients: Set<Client>;
  world: SharedWorld;
}

export class Rooms {
  private readonly rooms = new Map<number, Room>();
  private nextId = 1;

  constructor(private readonly dataDir: string) {}

  get worldCount(): number { return this.rooms.size; }

  get playerCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.clients.size;
    return total;
  }

  /** Every open world, for the ticker to walk. */
  entries(): Array<[number, Room]> { return [...this.rooms]; }

  get(seed: number): Room | undefined { return this.rooms.get(seed); }

  /** The room for a seed, read back from disk the first time anybody asks for it. */
  open(seed: number, start: { day: number; time: number }): Room {
    let room = this.rooms.get(seed);
    if (!room) {
      room = { clients: new Set(), world: new SharedWorld(seed, worldPath(this.dataDir, seed), { ...start }) };
      this.rooms.set(seed, room);
    }
    return room;
  }

  /** Put a newcomer in a room and hand back the client the rest of the server will talk to. */
  admit(socket: WebSocket, room: Room, seed: number, name: string): Client {
    const client: Client = {
      socket, seed, lastSeen: Date.now(), offers: new Map(), party: null,
      invited: new Set(), challenged: new Set(), duel: null, mustered: new Set(), warband: null, swords: 0,
      presence: { id: `p${this.nextId++}`, name, x: 0, z: 0, yaw: 0, walk: 0, gear: [], place: 'surface', riding: 'foot' },
    };
    room.clients.add(client);
    return client;
  }

  send(client: Client, message: ServerMessage): void {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify(message));
  }

  broadcast(seed: number, message: ServerMessage, except?: Client): number {
    const room = this.rooms.get(seed);
    if (!room) return 0;
    let sent = 0;
    for (const client of room.clients) if (client !== except) { this.send(client, message); sent++; }
    return sent;
  }

  /**
   * Everybody, in every world. Only whoever is operating the server has any business saying
   * something to all of them at once, which is why nothing in the game itself calls this.
   */
  everyone(message: ServerMessage): number {
    let sent = 0;
    for (const seed of this.rooms.keys()) sent += this.broadcast(seed, message);
    return sent;
  }

  /** The player with this id in this room, if they are still here. */
  byId(room: Room, id: string): Client | undefined {
    for (const client of room.clients) if (client.presence.id === id) return client;
    return undefined;
  }

  /** The player answering to this name, for anything addressed to a person rather than a session. */
  byName(room: Room, name: string): Client | undefined {
    for (const client of room.clients) if (client.presence.name === name) return client;
    return undefined;
  }

  // --- parties ---

  /** Tell everyone in a party who is in it now. */
  tellParty(party: Party): void {
    const members: PartyMember[] = [...party].map((c) => ({ id: c.presence.id, name: c.presence.name }));
    for (const member of party) this.send(member, { type: 'party', members });
  }

  /** Take somebody out of their party, dissolving it if that leaves one person standing. */
  leaveParty(client: Client): void {
    const party = client.party;
    if (!party) return;
    party.delete(client);
    client.party = null;
    if (party.size <= 1) {
      for (const last of party) { last.party = null; this.send(last, { type: 'party', members: [] }); }
      party.clear();
      return;
    }
    this.tellParty(party);
  }

  // --- duels ---

  /** Close a bout for both sides, naming whoever gave it up. */
  endDuel(client: Client, winner: string, loserName: string): void {
    const other = client.duel;
    client.duel = null;
    if (other) other.duel = null;
    this.send(client, { type: 'duel-over', winner, name: loserName });
    if (other) this.send(other, { type: 'duel-over', winner, name: loserName });
  }

  // --- fights with sides ---

  /** Close a fight for both sides, naming whoever gave it up. */
  endWarband(client: Client, winner: string, loserName: string): void {
    const other = client.warband;
    client.warband = null;
    client.swords = 0;
    if (other) { other.warband = null; other.swords = 0; }
    this.send(client, { type: 'warband-over', winner, name: loserName });
    if (other) this.send(other, { type: 'warband-over', winner, name: loserName });
  }

  // --- leaving ---

  /**
   * Somebody has gone: dropped, timed out, or closed the tab. Their bout ends, their party
   * carries on without them, everyone is told, and a world nobody is left in goes back to disk.
   */
  leave(client: Client): void {
    const room = this.rooms.get(client.seed);
    if (!room || !room.clients.delete(client)) return;
    if (client.duel) this.endDuel(client, client.duel.presence.id, client.presence.name);
    if (client.warband) this.endWarband(client, client.warband.presence.id, client.presence.name);
    this.leaveParty(client);
    this.broadcast(client.seed, { type: 'left', id: client.presence.id });
    if (room.clients.size === 0) this.close(client.seed);
  }

  /** Hold a world on disk and let it go; it will be read back when somebody returns. */
  close(seed: number): void {
    const room = this.rooms.get(seed);
    if (!room) return;
    room.world.save();
    this.rooms.delete(seed);
  }

  saveAll(): void {
    for (const room of this.rooms.values()) room.world.save();
  }
}
