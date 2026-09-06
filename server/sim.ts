import { handle } from './messages';
import { PROTOCOL_VERSION, cleanName, type ClientMessage, type ServerMessage } from './protocol';
import { Rooms, type Client, type Wire } from './rooms';
import type { Vault } from './vault';
import { CLOCK_INTERVAL, DAY_LENGTH } from './world';
import { GroundWorld } from '../src/world/groundworld';
import { generateWebGraph } from '../src/world/roadweb';
import { TerrainSampler } from '../src/world/terrain';

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
  /**
   * Whether to grow the ground of a world when somebody is standing in it.
   *
   * Off by default, because today nothing on the server needs it and standing a world up costs
   * about a tenth of a second and twenty megabytes. On, the simulation holds the same terrain the
   * players are walking on, which is what owning the creatures in it will need.
   */
  ground?: boolean;
  /** How many chunks either side of a player the simulation keeps. */
  reach?: number;
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

/** How many chunks either side of a player the ground is held for, by default. */
export const REACH = 3;

export class Simulation {
  readonly rooms: Rooms;
  private readonly timeout: number;
  private readonly growGround: boolean;
  private readonly reach: number;
  /** The ground of each world, for the worlds anybody is standing in. */
  private readonly ground = new Map<number, GroundWorld>();
  private lastTick = Date.now();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private clockTicker: ReturnType<typeof setInterval> | null = null;

  constructor(options: SimOptions = {}) {
    this.rooms = new Rooms(options.dataDir ?? '', options.vault);
    this.timeout = options.timeout ?? TIMEOUT;
    this.growGround = options.ground ?? false;
    this.reach = options.reach ?? REACH;
  }

  /**
   * The ground of a world, grown the first time anybody stands in it.
   *
   * The same terrain the players have: the same seed through the same generator, so what the
   * server believes about a tile and what a player sees on their screen are the same thing by
   * construction rather than by agreement. It costs about a tenth of a second to stand one up and
   * a millisecond a chunk after that, measured — which is what makes this affordable on a
   * Raspberry Pi and worth doing lazily anyway.
   *
   * A world with nobody in it has no ground, and loses it again when the last player leaves.
   */
  groundOf(seed: number): GroundWorld | null {
    if (!this.growGround) return null;
    const held = this.ground.get(seed);
    if (held) return held;
    // Which kind of world a seed grows is the client's business today — it is written into a save
    // and shared through a link — so the server grows the polygon world, which is the one that has
    // mountains, villages on real ground, and everything phase three is about.
    const graph = generateWebGraph(seed);
    const grown = new GroundWorld(new TerrainSampler(graph));
    this.ground.set(seed, grown);
    return grown;
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
      if (room.clients.size === 0) { this.rooms.close(seed); this.ground.delete(seed); continue; }

      room.world.tick(seconds);
      if (room.world.sweepStalls()) this.rooms.broadcast(seed, { type: 'stalls', stalls: room.world.stalls });
      const players = [...room.clients].map((c) => c.presence);
      // the ground exists where somebody is standing, and nowhere else: a chunk nobody is near is a
      // chunk with nobody to tell about it
      const ground = this.groundOf(seed);
      if (ground) {
        for (const who of players) ground.reach(who.x, who.z, this.reach);
        ground.keepOnly(players, this.reach + 1);
      }
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
