import { handle } from './messages';
import { LIMITS, PROTOCOL_VERSION, cleanName, type ClientMessage, type CreatureSnap, type ServerMessage } from './protocol';
import { Rooms, type Client, type Room, type Wire } from './rooms';
import type { Vault } from './vault';
import { CLOCK_INTERVAL, DAY_LENGTH } from './world';
import { GroundWorld } from '../src/world/groundworld';
import { Wildlife } from './wildlife';
import { generateWebGraph } from '../src/world/roadweb';
import { generateDungeon } from '../src/dungeon/generate';
import { DungeonWorld } from '../src/dungeon/world';
import { Manifest } from '../src/world/manifest';
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
/**
 * How often each player is told what is alive near them, in milliseconds.
 *
 * A third of a second. Presence is ten times a second because a hero that stutters is unplayable;
 * a deer in the middle distance is not, and the client draws between what it is told anyway. Three
 * a second for two hundred creatures is about six kilobytes a second a player, which a domestic
 * router and a Raspberry Pi can both carry.
 */
export const CREATURE_INTERVAL = 330;

/** How many chunks either side of a player the ground is held for, by default. */
export const REACH = 3;

/** The deepest floor anybody may claim to be standing on, so a number is not a way to spend memory. */
const FLOORS = 40;

export class Simulation {
  readonly rooms: Rooms;
  private readonly timeout: number;
  private readonly growGround: boolean;
  private readonly reach: number;
  /** The ground of each world, for the worlds anybody is standing in. */
  private readonly ground = new Map<number, GroundWorld>();
  /** And what lives on it: the herds, the villagers, the things that hunt at night. */
  private readonly wildlife = new Map<number, Wildlife>();
  /**
   * The dungeon floors somebody is standing on, and what lives in them, keyed by world and place.
   *
   * A floor is a world of its own: its own rooms, its own monsters, its own numbering. It is grown
   * when the first person walks down the stairs into it and dropped when the last one leaves,
   * because a world that has been explored should cost nothing to have been explored.
   */
  private readonly underworlds = new Map<string, Wildlife>();
  private lastTick = Date.now();
  /** Milliseconds since the creatures last went out, which is rarer than presence. */
  private sinceCreatures = 0;
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
    const sampler = new TerrainSampler(graph);
    const grown = new GroundWorld(sampler);
    this.ground.set(seed, grown);
    // Animals only. The people of a village are worked out from the seed and the register of who
    // has died, so every client already agrees about them without being told — and a villager the
    // server owned would be one the player could not talk to, because a conversation is a thing the
    // client holds. What players disagree about is the wildlife, so that is what moves across.
    const alive = new Wildlife(seed, grown, grown);
    this.wildlife.set(seed, alive);
    // so that a blow arriving through the roster can find whatever is running the creatures
    this.rooms.ownCreatures(seed, 'surface', alive);
    // and the same ground the players are walking on, so a hero can be walked against it rather
    // than taken on trust from the machine he is being walked on
    this.rooms.ownGround(seed, grown);
    return grown;
  }

  /** What is alive in a world, when the simulation is the thing keeping it alive. */
  livesIn(seed: number): Wildlife | null {
    this.groundOf(seed);
    return this.wildlife.get(seed) ?? null;
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
        // A floor is the one thing a message can ask the simulation to *make*, so it is answered
        // here rather than in the roster: growing one costs a world, and only the thing that holds
        // the worlds can decide to.
        if (message.type === 'floor') { this.standOn(client, message); return; }
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
      if (room.clients.size === 0) {
        this.rooms.close(seed);
        this.ground.delete(seed);
        this.wildlife.delete(seed);
        this.rooms.forgetGround(seed);
        continue;
      }

      room.world.tick(seconds);
      if (room.world.sweepStalls()) this.rooms.broadcast(seed, { type: 'stalls', stalls: room.world.stalls });
      // who is where. A world is several worlds at once — the country, and a floor under every
      // staircase somebody is standing on — and each of them is stepped for the people in it.
      const above = [...room.clients].filter((c) => c.standingIn === 'surface');
      const players = above.map((c) => c.presence);
      this.sinceCreatures += TICK;
      const tellNow = this.sinceCreatures >= CREATURE_INTERVAL;
      if (tellNow) this.sinceCreatures = 0;

      // the ground exists where somebody is standing, and nowhere else: a chunk nobody is near is a
      // chunk with nobody to tell about it
      const ground = this.groundOf(seed);
      if (ground && players.length > 0) {
        for (const who of players) ground.reach(who.x, who.z, this.reach);
        ground.keepOnly(players, this.reach + 1);
        // and the creatures on it, following the players about
        const alive = this.wildlife.get(seed);
        if (alive) {
          this.stepAndTell(alive, 'surface', above, seconds, room.world.clock.time, tellNow);
        }
      }
      this.stepFloors(seed, room, seconds, tellNow);
      for (const client of room.clients) {
        this.rooms.send(client, { type: 'presence', players: players.filter((p) => p.id !== client.presence.id) });
      }
    }
  }

  /**
   * Tell each player what is alive near them, and what has gone from their sight.
   *
   * Per player rather than per world, because "near" is a different place for each of them — that
   * is the whole of interest management, and it is what makes two hundred creatures a world affordable
   * rather than two hundred creatures a player. Only the difference is sent: what is new or has
   * moved, and the numbers of what has walked out of view.
   *
   * Sent at its own rate rather than every tick. Presence goes out ten times a second because a
   * player's own hero must not stutter; a deer forty tiles away is perfectly legible at three.
   */
  /**
   * One world, one step: move what lives there, tell whoever it bit, and describe it to the people
   * standing in it. The country and every floor under it go through this, which is what makes a
   * dungeon the same kind of thing as a hillside rather than a special case with its own rules.
   */
  private stepAndTell(
    alive: Wildlife, place: string, who: ReadonlyArray<Client>, dt: number, time: number, tell: boolean,
  ): void {
    // told rather than taken: hearts live in a player's own save, so the world says a wolf bit you
    // and how hard, and your own game works out what your guard was worth and which way it threw you
    for (const bite of alive.step(dt, who.map((c) => c.presence), time)) {
      const bitten = who.find((c) => c.presence === bite.who);
      if (bitten) this.rooms.send(bitten, { type: 'bitten', place, id: bite.id, damage: bite.damage });
    }
    if (tell) this.tellAboutCreatures(alive, place, who);
  }

  /**
   * Every floor somebody is standing on, and the ones nobody is standing on any more.
   *
   * A floor is grown when the first person walks down into it and dropped when the last one leaves.
   * Nothing is kept for a world that has been explored: the rooms are the same every time they are
   * grown, and what was in them is not worth remembering — the point of a floor is that it is
   * dangerous while you are in it.
   */
  private stepFloors(seed: number, room: Room, dt: number, tell: boolean): void {
    for (const [key, alive] of this.underworlds) {
      if (!key.startsWith(`${seed}|`)) continue;
      const place = key.slice(String(seed).length + 1);
      const here = [...room.clients].filter((c) => c.standingIn === place);
      if (here.length === 0) {
        this.underworlds.delete(key);
        this.rooms.forgetCreatures(seed, place);
        continue;
      }
      this.stepAndTell(alive, place, here, dt, room.world.clock.time, tell);
    }
  }

  private tellAboutCreatures(alive: Wildlife, place: string, who: ReadonlyArray<Client>): void {
    for (const client of who) {
      const near = alive.inSightOf(client.presence.x, client.presence.z);
      const changed: CreatureSnap[] = [];
      const now = new Map<number, string>();
      for (const c of near) {
        // what a client would draw differently: where it is, which way it faces, what it is doing
        const shape = `${c.x},${c.z},${c.y},${c.yaw},${c.walk},${c.state},${c.hp}`;
        now.set(c.id, shape);
        if (client.seeing.get(c.id) !== shape) changed.push(c);
      }
      const gone: number[] = [];
      for (const id of client.seeing.keys()) if (!now.has(id)) gone.push(id);
      client.seeing = now;
      if (changed.length === 0 && gone.length === 0) continue;
      this.rooms.send(client, { type: 'creatures', place, near: changed, gone });
    }
  }

  /**
   * Somebody has gone underground. Grow the floor they are standing on, if nobody has yet.
   *
   * The seed is derived here rather than sent: the same root seed and the same anchor name give the
   * same rooms on every machine, which is the whole of how this world is shared. So a client says
   * which floor it walked into and the world works out what that floor is — and two people who name
   * the same floor are standing in the same one by construction.
   */
  private standOn(client: Client, message: Extract<ClientMessage, { type: 'floor' }>): void {
    const place = String(message.place).slice(0, LIMITS.PLACE);
    client.standingIn = place;
    client.seeing = new Map();
    if (!this.growGround) return;
    const key = `${client.seed}|${place}`;
    if (this.underworlds.has(key)) return;

    const anchorId = String(message.anchor).slice(0, LIMITS.PLACE);
    const kind = message.kind === 'cave' || message.kind === 'thicket' ? message.kind : 'dungeon';
    const floor = Math.max(1, Math.min(FLOORS, Math.floor(Number(message.floor) || 1)));
    const seed = new Manifest(client.seed).deriveSeed(anchorId, kind, null);
    const style = kind === 'dungeon' ? 'vault' : kind;
    const world = new DungeonWorld(generateDungeon(seed, style, floor), place, style);
    // a floor has no chunks streaming into it: what lives down there is put there once, now
    const alive = new Wildlife(seed + floor, world, { getTiles: () => null });
    alive.fill(world.map, seed, floor);
    this.underworlds.set(key, alive);
    this.rooms.ownCreatures(client.seed, place, alive);
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
