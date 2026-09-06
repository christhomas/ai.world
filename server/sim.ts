import { handle } from './messages';
import { PROTOCOL_VERSION, cleanName, type ClientMessage, type ServerMessage } from './protocol';
import { Rooms, type Client, type Wire } from './rooms';
import type { Vault } from './vault';
import { CLOCK_INTERVAL, DAY_LENGTH } from './world';

/**
 * The simulation: everything the shared world does, and nothing about where it is running.
 *
 * It knows about players, worlds, the clock, the market, the post shelf and the log of what has
 * been changed. It does not know what a socket is, what a file is, or whether the thing at the
 * other end of a `Wire` is across a network or across a thread boundary. That is the whole point,
 * and it is a constraint rather than an aesthetic: a simulation that can tell the difference will
 * eventually depend on it, and then there is one that runs on a server and another that runs in a
 * browser, and they disagree on a Tuesday.
 *
 * Two hosts drive it. `serve.ts` gives it websockets and a directory of files; a Web Worker gives
 * it a `MessagePort` and whatever a browser can keep, so somebody playing alone is playing against
 * the same code as somebody on a shared world. `docs/server-authority.md` is where that is going.
 */
export interface SimOptions {
  /** Where worlds are kept. Left out, they are kept in memory and last as long as the process. */
  vault?: Vault;
  /** What worlds are filed under, when the vault has somewhere to put them. */
  dataDir?: string;
  /** How long since we last heard from somebody before they are dropped, in milliseconds. */
  timeout?: number;
}

/** One player's connection, from the simulation's side. */
export interface Attached {
  /** A line of JSON arrived from them. */
  receive(text: string): void;
  /** They have gone: the socket closed, the tab closed, the worker stopped. */
  leave(): void;
}

/** How often presence goes out, in milliseconds. */
export const TICK = 100;
/** Drop anyone we have not heard from in this long. */
export const TIMEOUT = 30_000;

export class Simulation {
  readonly rooms: Rooms;
  private readonly timeout: number;
  private lastTick = Date.now();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private clockTicker: ReturnType<typeof setInterval> | null = null;

  constructor(options: SimOptions = {}) {
    this.rooms = new Rooms(options.dataDir ?? '', options.vault);
    this.timeout = options.timeout ?? TIMEOUT;
  }

  /** Start the clocks. Separate from the constructor so a test can step time itself. */
  start(): void {
    if (this.ticker) return;
    this.lastTick = Date.now();
    this.ticker = setInterval(() => this.tick(), TICK);
    // the clock goes out rarely: clients run their own between messages and simply agree with it
    this.clockTicker = setInterval(() => {
      for (const [seed, room] of this.rooms.entries()) {
        this.rooms.broadcast(seed, { type: 'clock', clock: room.world.clock });
      }
    }, CLOCK_INTERVAL);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.clockTicker) clearInterval(this.clockTicker);
    this.ticker = null;
    this.clockTicker = null;
    this.rooms.saveAll();
  }

  /**
   * Somebody has connected, though they have not said who they are yet.
   *
   * Nothing counts until a `join` arrives: a connection with no name behind it is a stranger at the
   * door, and the roster has no room for one.
   */
  attach(wire: Wire): Attached {
    let client: Client | null = null;
    return {
      receive: (text: string) => {
        let message: ClientMessage;
        try { message = JSON.parse(text) as ClientMessage; } catch { return; }

        if (message.type === 'join') {
          if (client) return;                    // one join per connection
          client = this.welcome(wire, message);
          return;
        }
        if (!client) return;
        const room = this.rooms.get(client.seed);
        if (!room) return;
        client.lastSeen = Date.now();
        handle(this.rooms, client, room, message);
      },
      leave: () => {
        if (!client) return;
        this.rooms.leave(client);
        client = null;
      },
    };
  }

  /**
   * A step of the world: drop the silent, close the empty, move the clock, tell everybody where
   * everybody is.
   */
  tick(now = Date.now()): void {
    const seconds = (now - this.lastTick) / 1000;
    this.lastTick = now;

    for (const [seed, room] of this.rooms.entries()) {
      for (const client of room.clients) {
        if (now - client.lastSeen > this.timeout) { client.wire.close(); this.rooms.leave(client); }
      }
      if (room.clients.size === 0) { this.rooms.close(seed); continue; }

      room.world.tick(seconds);
      if (room.world.sweepStalls()) this.rooms.broadcast(seed, { type: 'stalls', stalls: room.world.stalls });
      const players = [...room.clients].map((c) => c.presence);
      for (const client of room.clients) {
        this.rooms.send(client, { type: 'presence', players: players.filter((p) => p.id !== client.presence.id) });
      }
    }
  }

  /**
   * The handshake. A joining player is told everything they have missed: who is here, what time it
   * is, what has been changed, what is on the market stalls, who this world has met, and whether
   * anything is waiting for them at an inn.
   */
  private welcome(wire: Wire, message: Extract<ClientMessage, { type: 'join' }>): Client | null {
    if (message.version !== PROTOCOL_VERSION) {
      wire.send(JSON.stringify({ type: 'error', reason: 'This server speaks a different version.' } satisfies ServerMessage));
      wire.close();
      return null;
    }
    const seed = message.seed >>> 0;
    // the first player through the door sets the clock; after that the world keeps its own time
    const room = this.rooms.open(seed, {
      day: Math.max(1, Math.floor(message.day) || 1),
      time: Number(message.time) || 0.3,
    });
    const joining = this.rooms.admit(wire, room, seed, cleanName(message.name));

    this.rooms.send(joining, {
      type: 'welcome', id: joining.presence.id, seed,
      players: [...room.clients].filter((c) => c !== joining).map((c) => c.presence),
      clock: room.world.clock,
      deltas: room.world.log,
    });
    this.rooms.send(joining, { type: 'stalls', stalls: room.world.stalls });

    const newcomer = room.world.meet(joining.presence.name);
    this.rooms.send(joining, { type: 'folk', names: room.world.folk });
    if (newcomer) this.rooms.broadcast(seed, { type: 'folk', names: room.world.folk }, joining);

    const waiting = room.world.waiting(joining.presence.name);
    if (waiting > 0) this.rooms.send(joining, { type: 'mail-here', from: `${waiting} parcel${waiting === 1 ? '' : 's'}` });

    this.rooms.broadcast(seed, { type: 'joined', player: joining.presence }, joining);
    return joining;
  }
}

export { DAY_LENGTH };
