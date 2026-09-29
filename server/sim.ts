import { handle } from './messages';
import {
  LIMITS, PROTOCOL_VERSION, cleanName,
  type ClientMessage, type CreatureSnap, type ServerMessage, type WorldDelta,
} from './protocol';
import { Rooms, type Client, type Room, type Wire } from './rooms';
import { WorldRecordConflict } from './worldrecords';
import type { Vault } from './vault';
import { CLOCK_INTERVAL, DAY_LENGTH, type SharedWorld } from './world';
import { GroundWorld, oneCountry, patchedCountry } from '../src/world/groundworld';
import { Patchwork } from '../src/world/patchwork';
import { boundsOf, patchOf, patchOfChunk } from '../src/world/patchwork';
import { rebuildPatch, type PatchParts } from '../src/world/endless';
import { propFootprints } from '../src/entities/props';
import { packChunk } from '../src/world/chunkparcel';
import { blocking } from '../src/world/footprints';
import { isTold, replayTold } from '../src/world/telling';
import type { CarrierFact } from '../src/world/carrierbook';
import { advanceWorldCarriers } from './carrierflow';
import { carrierOnRoad } from './carrieractor';
import { BLOCKS_WALKING } from '../src/world/biomes';
import { Wildlife, type Standing } from './wildlife';
import type { Entity } from '../src/entities/entity';
import { peopleOf } from './people';
import type { DatabaseSync } from 'node:sqlite';
import type { Person } from '../src/world/people';
import type { Highland } from '../src/world/highland';
import type { TerrainLayer } from '../src/world/terrainlayers';
import { HeldMinds, forgetMind, keepMinds, mindsOf } from './durable/minds';
import { eventsOf, keepEvents } from './durable/events';
import { domesdayOf, type Domesday } from './domesday';
import { Chronicle } from './chronicle';
import { countryStamp, elevationFor, endlessStamp, growPatch, growWorld, islandsFor, terrainFor } from '../src/world/growworld';
import { TerrainSampler } from '../src/world/terrain';
import { WORLD } from '../src/core/config';
import { generateDungeon, asDungeonStyle } from '../src/dungeon/generate';
import { lidLifted } from './chests';
import { DungeonWorld } from '../src/dungeon/world';
import { Manifest, type Anchor } from '../src/world/manifest';
import { provinceOfHome } from '../src/world/provinces';
import { hashString } from '../src/core/rng';
import { authoredMountain, authoredTerrain, authoredSkyEyrie } from '../src/world/worldediting';

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
  /** A server host can grow expensive patches on another thread before admitting the view. */
  preparePatch?: (seed: number, patch: string, layers: readonly Highland[], terrain: readonly TerrainLayer[]) => Promise<PatchParts>;
  /** The private browser worker may accept its page's authored terrain at join. */
  localAuthoring?: boolean;
  /** How many chunks either side of a player the simulation keeps. */
  reach?: number;
  /**
   * Where to keep the half of a villager that no seed implies: their memories and their opinions.
   *
   * Left out, they last as long as the process — which is how it was, and which meant every restart
   * wiped every villager's opinion of every player with nothing anywhere saying so. See
   * `durable/minds.ts`; `serve.ts` hands this the same file the tools portal uses.
   */
  minds?: DatabaseSync;
  /** The bounded parish Chronicle, in the same durable file under its own schema. */
  chronicles?: DatabaseSync;
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
/** A late event-loop callback must not turn one creature update into a multi-tile teleport. */
const MAX_CREATURE_STEP = TICK / 1000;
/** Drop anyone we have not heard from in this long. */
export const TIMEOUT = 30_000;
/**
 * The most silence one tick is allowed to claim it heard, in milliseconds.
 *
 * Ticks are meant to arrive every `TICK`. When one arrives a minute late it is not because the
 * players went quiet for a minute — it is because nothing ran for a minute, including the tick
 * itself. Founding a world is synchronous, and on a four-core ARM box a join measured **50817ms,
 * 62642ms and 58701ms**, all of it inside one `receive`. Nobody was given a chance to speak in
 * that gap, so charging it to them as silence dropped the player who had just opened the world,
 * the instant it was ready for them.
 *
 * That is what it cost: `operate.test.ts` joined two players, saw both welcomed, and then had the
 * operator door count nought of them — `expected +0 to be 2`. It failed the 0.100.1 release, and
 * it is not a test fault. A player joining a fresh world on the homelab box was being thrown out
 * of it for the wait the server had just put them through.
 *
 * Two ticks, because that is the most a tick that is merely *late* can honestly claim, and every
 * number above is hundreds of times larger. A running server fills this every tick, so real silence
 * still arrives at full speed and a patience shorter than this one is still a patience.
 *
 * It follows — and it cost two tests to notice — that **a clock jump is no longer a way to be
 * silent**. `sim.tick(now + 5_000)` used to drop a player because the reaper read the jump off a
 * wall clock; it cannot now, because a five-second jump is indistinguishable from five seconds of
 * the loop being held, which is the whole fault being fixed. A test that wants somebody let go of
 * ticks the way a live server does, a tenth of a second at a time.
 */
export const HEARD_AT_MOST = TICK * 2;
/**
 * How often each player is told what is alive near them, in milliseconds.
 *
 * A third of a second. Presence is ten times a second because a hero that stutters is unplayable;
 * a deer in the middle distance is not, and the client draws between what it is told anyway. Three
 * a second for two hundred creatures is about six kilobytes a second a player, which a domestic
 * router and a Raspberry Pi can both carry.
 */
export const CREATURE_INTERVAL = 330;

/**
 * How close a creature has to be before it is worth describing every tick, in tiles.
 *
 * Everything a player fights is within a few tiles of them, and a third of a second is a long time
 * in a fight: a wolf covers a tile in it. The client draws between what it is told and guesses the
 * rest, and measured on a live village that guess was out by about a tile — which is the whole of a
 * wolf. So the player swings where the wolf is drawn, the world answers about where the wolf is,
 * and nothing connects; the same wolf bites out of what looks like empty grass.
 *
 * The fix is not to describe two hundred creatures ten times a second. It is to notice that the
 * argument for three a second was always about the middle distance — a deer forty tiles off is
 * perfectly legible at that rate — and that the handful of things close enough to matter are
 * cheap to send often.
 */
export const CLOSE_ENOUGH_TO_FIGHT = 14;

/** How many chunks either side of a player the ground is held for, by default. */
export const REACH = 3;

/**
 * How much country the world keeps grown and ready to hand over, in chunks either side of a player.
 *
 * Wider than `REACH` on purpose, and they are two different jobs. `REACH` is what the world's own
 * creatures walk on, and it is narrow because everything inside it is being thought about. This is
 * what a page can *see*, and a page that could see less than it can ask for would be a page waiting
 * on ground the world had decided not to have ready.
 *
 * So it is the page's own view radius, read from the config both halves share, rather than a number
 * the server picked. The world holding exactly the country its players are looking at is the whole
 * of what makes a first view arrive inside the fifth of a second a page will wait.
 */
export const VIEW = WORLD.VIEW_RADIUS;

/**
 * How many chunks the world will hand over in answer to one asking.
 *
 * A view is a hundred and twenty-one, so this is a comfortable armful and well short of what a page
 * could ask for by mistake or on purpose. Anything beyond it is asked for again next time, which
 * costs a message and no country.
 */
export const CHUNKS_AT_ONCE = 200;

/** The private worker accepts only the small, finite list its title editor can make. */
function localTerrain(value: unknown): TerrainLayer[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const layers: TerrainLayer[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const layer = row as Partial<TerrainLayer>;
    if (layer.kind !== 'land' && layer.kind !== 'sea') return null;
    if (![layer.x, layer.z, layer.reach, layer.seed].every(Number.isSafeInteger)) return null;
    const { x, z, reach, seed } = layer as TerrainLayer;
    if (Math.abs(x) > 1_000_000 || Math.abs(z) > 1_000_000 || reach < 1 || reach > 2048 || seed < 0 || seed > 0xffffffff) return null;
    layers.push({ x, z, reach, seed, kind: layer.kind });
  }
  return layers;
}

/** A private worker accepts only complete, bounded highland anchors. */
const MAX_LOCAL_HIGHLANDS = 16_384;
export function localHighlands(value: unknown): Anchor[] | null {
  if (!Array.isArray(value) || value.length > MAX_LOCAL_HIGHLANDS) return null;
  const layers: Anchor[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const a = row as Partial<Anchor>;
    if (a.kind !== 'highland' || typeof a.id !== 'string' || a.id.length === 0
      || a.id.length > 180 || ids.has(a.id) || a.parent !== null
      || (a.version !== 1 && a.version !== 2)
      || !Number.isSafeInteger(a.x) || !Number.isSafeInteger(a.z)
      || Math.abs(a.x!) > 1_000_000 || Math.abs(a.z!) > 1_000_000
      || !Number.isSafeInteger(a.seed) || a.seed! < 0 || a.seed! > 0xffffffff
      || !a.layer || !Number.isSafeInteger(a.layer.reach) || !Number.isSafeInteger(a.layer.lift)
      || (a.layer.roughness !== undefined && (!Number.isFinite(a.layer.roughness)
        || a.layer.roughness < 0 || a.layer.roughness > 1))
      || (a.version === 1 && a.layer.roughness !== undefined)
      || (a.version === 2 && a.layer.roughness === undefined)
      || a.layer.reach < 1 || a.layer.reach > 2048 || a.layer.lift < 1 || a.layer.lift > 100) return null;
    ids.add(a.id);
    layers.push(a as Anchor);
  }
  return layers;
}

/** The deepest floor anybody may claim to be standing on, so a number is not a way to spend memory. */
const FLOORS = 40;

export class Simulation {
  readonly rooms: Rooms;
  private readonly timeout: number;
  private readonly growGround: boolean;
  private readonly localAuthoring: boolean;
  private readonly reach: number;
  /** The ground of each world, for the worlds anybody is standing in. */
  private readonly ground = new Map<number, GroundWorld>();
  private readonly patchworks = new Map<number, Patchwork>();
  private readonly warming = new Map<number, Promise<void>>();
  private readonly warmingClients = new Set<Client>();
  /** Chunk requests heard while a client's first country was still being prepared. */
  private readonly wantedWhileWarming = new Map<Client, Array<Extract<ClientMessage, { type: 'want-chunks' }>>>();
  private readonly preparePatch?: SimOptions['preparePatch'];
  /** A survey may grow an unnamed seed before its first player chooses which country it is. */
  private readonly groundKinds = new Map<number, 'road' | 'endless'>();
  /** Who lives in each world, kept so the endless ones can be told about country as it arrives. */
  private readonly folk = new Map<number, { catchUp: () => void; register: { living(village: string): readonly Person[]; settled(): readonly string[] } }>();
  /** Where the non-derived half of a villager is kept between one visit and the next. */
  private readonly minds: DatabaseSync | null;
  /** Meaningful register changes kept across a process restart. */
  private readonly chronicleDb: DatabaseSync | null;
  /**
   * What was read back off the disk, waiting for the villagers it belongs to.
   *
   * A village is lived when somebody walks into it, so the register's roll starts empty and fills
   * as the world is explored. See `HeldMinds`: each villager is given theirs once, the first time
   * they exist, and never again.
   */
  private readonly held = new Map<number, HeldMinds>();
  /** The fingerprint of each of those countries, so a joining page can check it grew the same one. */
  private readonly countryStamps = new Map<number, string>();
  /** And what lives on it: the herds, the villagers, the things that hunt at night. */
  private readonly wildlife = new Map<number, Wildlife>();
  /** What has happened lately in each world, for anybody watching one. See `chronicle.ts`. */
  private readonly chronicles = new Map<number, Chronicle>();
  /**
   * The dungeon floors somebody is standing on, and what lives in them, keyed by world and place.
   *
   * A floor is a world of its own: its own rooms, its own monsters, its own numbering. It is grown
   * when the first person walks down the stairs into it and dropped when the last one leaves,
   * because a world that has been explored should cost nothing to have been explored.
   */
  private readonly underworlds = new Map<string, Wildlife>();
  /**
   * The same floors again, as rooms rather than as monsters.
   *
   * Kept beside `underworlds` because the two are asked different questions: what is walking about
   * down there moves every tick, and where the chests are never moves at all. Grown and dropped
   * together, so a floor nobody is standing in costs nothing either way.
   */
  private readonly floors = new Map<string, { world: DungeonWorld; seed: number }>();
  private lastTick = Date.now();
  /** Milliseconds since the creatures last went out, which is rarer than presence. */
  private sinceCreatures = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private clockTicker: ReturnType<typeof setInterval> | null = null;

  constructor(options: SimOptions = {}) {
    this.localAuthoring = options.localAuthoring ?? false;
    this.minds = options.minds ?? null;
    this.chronicleDb = options.chronicles ?? null;
    this.rooms = new Rooms(options.dataDir ?? '', options.vault);
    this.timeout = options.timeout ?? TIMEOUT;
    this.growGround = options.ground ?? false;
    this.preparePatch = options.preparePatch;
    this.reach = options.reach ?? REACH;
  }

  /**
   * What a world's ground was authored with, on this side of the wire.
   *
   * The manifest is the page's word for the same thing and `elevationFor` is the one reading of
   * it, so the two halves are not two implementations that agree — they are one function called
   * twice. Asked rather than kept, because the answer comes from the room when a world is open and
   * from its file when it is not, and a copy held here would be the stale one of the two.
   */
  private layersOf(seed: number): readonly Highland[] {
    return elevationFor(this.rooms.manifestOf(seed));
  }

  private terrainOf(seed: number): readonly TerrainLayer[] {
    return terrainFor(this.rooms.manifestOf(seed));
  }

  /** The manifest revision shown to an editor before it proposes an addition. */
  namedWorldRevision(name: string): string | null {
    const record = this.rooms.worldRecord(name);
    if (!record || record.kind === 'road') return null;
    return hashString(JSON.stringify(this.rooms.manifestOf(record.seed).toJSON())).toString(16);
  }

  namedWorldReminders(name: string, x: number, z: number, reach: number) {
    const record = this.rooms.worldRecord(name);
    if (!record || record.kind === 'road') throw new Error('Choose an existing endless world.');
    const history = this.rooms.rememberedForEdit(record.seed, x, z, reach);
    const held = this.minds ? mindsOf(this.minds, record.seed) : null;
    return { ...history, protectAllVillages: !!held && (held.minds.size > 0 || held.unreadable.length > 0) };
  }

  /** Commit one prepared mountain while nobody is using this world, then discard every old sampler. */
  authorNamedMountain(name: string, expected: string, candidate: unknown, sites: readonly Anchor[] = []): string {
    const anchor = authoredMountain(candidate);
    if (!anchor) throw new Error('The mountain parameters are invalid.');
    return this.authorNamedEdit(name, expected, sites, (world) => {
      if (!world.authorMountain(anchor)) throw new Error('This mountain already exists or the world has 32 mountains.');
      return () => { world.manifest.anchors.delete(anchor.id); };
    });
  }

  authorNamedTerrain(name: string, expected: string, candidate: unknown, sites: readonly Anchor[] = []): string {
    const layer = authoredTerrain(candidate);
    if (!layer) throw new Error('The land or sea parameters are invalid.');
    return this.authorNamedEdit(name, expected, sites, (world) => {
      if (world.manifest.terrain.length >= 32) throw new Error('This world already has 32 land and sea edits.');
      world.appendTerrain(layer);
      return () => { world.manifest.terrain.pop(); };
    });
  }

  authorNamedSkyEyrie(name: string, expected: string, candidate: unknown): string {
    const record = this.rooms.worldRecord(name);
    if (!record || record.kind === 'road') throw new Error('Choose an existing endless world.');
    const anchor = authoredSkyEyrie(this.rooms.manifestOf(record.seed), candidate);
    if (!anchor) throw new Error('The skyward eyrie is invalid.');
    return this.authorNamedEdit(name, expected, [], (world) => {
      if (!world.authorSkyEyrie(anchor)) throw new Error('This eyrie is already placed.');
      return () => { world.manifest.anchors.delete(anchor.id); };
    });
  }

  private authorNamedEdit(name: string, expected: string, sites: readonly Anchor[],
    edit: (world: SharedWorld) => () => void): string {
    const record = this.rooms.worldRecord(name);
    if (!record || record.kind === 'road') throw new Error('Choose an existing endless world.');
    const seed = record.seed;
    const active = this.rooms.get(seed);
    if (active?.clients.size || this.warming.has(seed)) throw new Error('Leave this world before editing its ground.');
    const current = this.namedWorldRevision(name);
    if (current !== expected) throw new Error('This world changed. Reload its map before saving.');
    const room = active ?? this.rooms.open(seed, { day: 1, time: 0.3 }, record, 'endless');
    const pinned: string[] = [];
    const upgraded: string[] = [];
    for (const site of sites) {
      if (site.kind !== 'skyisle' || !site.skySite) continue;
      const currentSite = room.world.manifest.get(site.id);
      if (currentSite) {
        if (!currentSite.skySite) { currentSite.skySite = site.skySite; upgraded.push(site.id); }
      } else { room.world.manifest.anchors.set(site.id, site); pinned.push(site.id); }
    }
    try {
      const undo = edit(room.world);
      try {
        room.world.keepNear([], true);
        this.keepMindsOf(seed, true);
        room.world.save(true);
      } catch (error) { undo(); throw error; }
    } catch (error) {
      for (const id of pinned) room.world.manifest.anchors.delete(id);
      for (const id of upgraded) delete room.world.manifest.get(id)!.skySite;
      throw error;
    }
    this.rooms.close(seed);
    this.keepMindsOf(seed);
    this.ground.delete(seed);
    this.patchworks.delete(seed);
    this.groundKinds.delete(seed);
    this.countryStamps.delete(seed);
    this.folk.delete(seed);
    this.held.delete(seed);
    this.wildlife.delete(seed);
    this.rooms.forgetGround(seed);
    return this.namedWorldRevision(name)!;
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
    const room = this.rooms.get(seed);
    const kind = room?.kind ?? this.rooms.worldRecordForSeed(seed)?.kind ?? 'endless';
    const held = this.ground.get(seed);
    if (held && this.groundKinds.get(seed) === kind) return held;
    // A read-only survey can precede the first road join. Replace its provisional endless ground.
    if (held) {
      this.ground.delete(seed);
      this.patchworks.delete(seed);
      this.countryStamps.delete(seed);
      this.folk.delete(seed);
      this.wildlife.delete(seed);
      this.held.delete(seed);
    }
    /*
     * There is no whole country to grow. `Patchwork` retains the squares somebody has approached,
     * and every one of them is grown from the seed *and the list* — the layers this world was
     * authored with, read out of its manifest exactly as the page reads them out of its save.
     *
     * That list was missing here until #377 and the omission was inert only by luck: no world had
     * any layers, so the page's list and this default were the same empty list. The day one is
     * authored, a page draws a mountain and this grows the plain underneath it — and this is the
     * half that decides where a hero may stand, where a creature walks and what the ground under a
     * village is. A hero would walk through a hillside the page had drawn, which is the exact
     * failure `growworld.ts` exists to make impossible, arriving through the one door #376 could
     * not close from the other side.
     */
    const layers = this.layersOf(seed);
    const terrain = this.terrainOf(seed);
    const patches = kind === 'endless'
      ? (this.patchworks.get(seed) ?? new Patchwork(seed, growPatch, undefined, layers, terrain)) : null;
    if (patches) this.patchworks.set(seed, patches);
    const roadGraph = patches ? null : growWorld(seed, islandsFor(this.rooms.manifestOf(seed), seed));
    const country = patches ? patchedCountry(patches) : oneCountry(new TerrainSampler(roadGraph!));
    this.countryStamps.set(seed, roadGraph ? countryStamp(roadGraph, layers, terrain) : endlessStamp(seed, layers, terrain));
    const grown = new GroundWorld(country, blocking(propFootprints(), BLOCKS_WALKING));
    this.ground.set(seed, grown);
    this.groundKinds.set(seed, kind);
    /*
     * The square the players are in, before anybody is put in a street.
     *
     * A patchwork with nothing in it has no villages at all, so the register would be handed an
     * empty country and the first hero would arrive somewhere with nobody in it. The origin is
     * where a fresh endless world puts somebody, it costs about half a second, and every other
     * square arrives as it is walked into — which is what `catchUp` below is for.
     */
    patches?.at(0, 0);
    // The people too, now. They were held back for a long time on the argument that a village is the
    // seed and the register and every client already agrees about it — which was true until a
    // villager was given something of his own to remember, and then it was two men of the same name
    // holding two different views of you. `server/people.ts` says how one is assembled.
    const folk = peopleOf(seed, country, Math.floor(room?.world.clock.day ?? 1), {
      onFallen: (who, id) => this.buried(seed, who, id),
      onArrest: (by, whom) => this.tellOfArrest(seed, by, whom),
      onDeparted: (change) => this.forgetTheMind(seed, change.id),
    }, room?.world.manifest);
    this.folk.set(seed, folk);
    const alive = new Wildlife(seed, grown, grown, folk);
    // and the book goes to the world, which is the one thing that knows when a place has stopped
    // being anybody's business — the moment ten slights are worth settling into one opinion
    room?.world.keepsTheRegister(folk.register);
    // Catch the authoritative register up with both kinds of village fact before anybody is put in
    // a street: deaths and declarations are replayed on their recorded mornings.
    const log = room?.world.log ?? [];
    replayTold(log.filter(isTold), (change) => folk.register.apply(change));
    for (const fact of log.filter((delta): delta is CarrierFact =>
      delta.kind === 'cart-loaded' || delta.kind === 'cart-finished')) folk.register.recordCarrier(fact);
    /*
     * And what the people of this world hold, which the seed cannot grow back.
     *
     * Here, and not a line earlier or later: the register has just been built and caught up with
     * the told facts, and nobody has been admitted yet. Earlier there would be no people to put it
     * into; later the first player through the door meets a village that has forgotten them.
     */
    if (this.minds) {
      const { minds, unreadable } = mindsOf(this.minds, seed);
      const waiting = new HeldMinds(minds);
      // A replay can already have settled villages. Restore those people before welcome() admits a
      // client; the held copy remains for villages that are grown lazily later.
      waiting.giveTo(everybodyIn(folk.register));
      this.held.set(seed, waiting);
      if (unreadable.length > 0) {
        // said out loud rather than swallowed: a villager who has forgotten you is a thing somebody
        // should be told about, and a silent loss is the whole complaint behind 129 and 135
        console.error(`world ${seed}: ${unreadable.length} villagers' memories would not read back`
          + ` and were left behind — ${unreadable.slice(0, 5).join(', ')}`);
      }
      if (minds.size > 0) console.log(`world ${seed}: ${minds.size} villagers remember somebody`);
    }
    alive.syncBuildings();
    // C2's coarse tier, joined up. A herd belongs to the province its home is in and never to the
    // one it is standing in (`provinceOfHome`, which is C3's whole rule); a province knows how long
    // it was nobody's business because it was stamped on the way out and read back on the way in
    // (`SharedWorld.asleep`); and the manager asks that of every herd the ground hands it, the
    // moment it hands it over. A week away is one calculation for the province and no ticks at all.
    //
    // The room is fetched fresh each time rather than closed over: this world's room is opened
    // before its ground is grown and is closed when its last player leaves, and a stale reference
    // to a closed room would keep answering with the clock it had when it closed.
    alive.crowd.sleptFor = (herd) => this.rooms.get(seed)?.world.asleep(provinceOfHome(herd)) ?? 0;
    this.wildlife.set(seed, alive);
    // so that a blow arriving through the roster can find whatever is running the creatures
    this.rooms.ownCreatures(seed, 'surface', alive);
    // and the same ground the players are walking on, so a hero can be walked against it rather
    // than taken on trust from the machine he is being walked on
    this.rooms.ownGround(seed, grown);
    return grown;
  }

  /**
   * The Domesday Book for one world: everybody in it, and what each of them is doing.
   *
   * Here rather than on a client because only this side has the whole country and only this side
   * knows what anybody is presently up to — see `domesday.ts`. Growing the world if it has not been
   * grown is deliberate and is what `groundOf` already does for every other question: a survey that
   * answered "nothing there" for a world nobody had opened would be a survey of the visitors rather
   * than of the world.
   */
  surveyOf(seed: number): Domesday | null {
    const alive = this.livesIn(seed);
    const register = alive?.register;
    if (!alive || !register) return null;
    return domesdayOf({
      seed,
      day: this.rooms.get(seed)?.world.clock.day ?? register.today,
      villages: alive.villages,
      register,
      crowd: alive.crowd,
    });
  }

  /**
   * The last while of one world's history: births, deaths, villages emptied and resettled.
   *
   * Made on being asked and hydrated first where this server has a durable book. A world nobody has
   * looked at still has one, because the thing that fills it is the day turning over rather than
   * anybody reading it — a chronicle that only recorded while somebody was watching would be a
   * chronicle that is empty exactly when it is opened.
   */
  chronicleOf(seed: number): Chronicle {
    const had = this.chronicles.get(seed);
    if (had) return had;
    const restored = this.chronicleDb
      ? eventsOf(this.chronicleDb, seed)
      : { entries: [], unreadable: [], latest: 0 };
    if (restored.unreadable.length > 0) {
      console.error(`world ${seed}: chronicle rows ${restored.unreadable.join(', ')} could not be read`);
    }
    const fresh = new Chronicle(restored.entries, this.chronicleDb
      ? (entries) => { keepEvents(this.chronicleDb!, seed, entries); }
      : undefined, restored.latest + 1);
    this.chronicles.set(seed, fresh);
    return fresh;
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
    this.keepTheMinds();
  }

  /** Give a capture harness a fixed origin before it drives explicit ticks. */
  captureAt(now: number): void {
    if (this.ticker) throw new Error('a running simulation cannot use the capture clock');
    this.lastTick = now;
  }

  /**
   * Write down what every villager of every open world holds.
   *
   * Alongside `saveAll`, and for the same reason it exists: the world's own JSON and this are two
   * halves of one save, and a restart between them is a world whose told facts and whose
   * memories disagree about which day it is.
   */
  keepTheMinds(): void {
    if (!this.minds) return;
    for (const [seed] of this.folk) this.keepMindsOf(seed);
  }

  /** Save one live register, shared by shutdown, timeout teardown, and an orderly final leave. */
  private keepMindsOf(seed: number, strict = false): void {
    const folk = this.folk.get(seed);
    if (!this.minds || !folk) return;
    try { keepMinds(this.minds, seed, everybodyIn(folk.register)); }
    catch (why) {
      if (strict) throw why;
      // a save that throws must not prevent the room and its sockets from being closed
      console.error(`world ${seed}: could not write down what its people hold — ${String(why)}`);
    }
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
        client.silent = 0;
        if (this.warmingClients.has(client)) {
          // A page asks for its opening view as soon as it is welcomed. Dropping that ask would
          // leave it waiting for bytes it believes are coming; answer it once the country is ready.
          if (message.type === 'want-chunks') {
            const held = this.wantedWhileWarming.get(client) ?? [];
            if (held.length < 8) held.push(message);
            this.wantedWhileWarming.set(client, held);
          }
          return;
        }
        // A floor is the one thing a message can ask the simulation to *make*, so it is answered
        // here rather than in the roster: growing one costs a world, and only the thing that holds
        // the worlds can decide to.
        if (message.type === 'floor') { this.standOn(client, message); return; }
        // asking to open a chest needs the floor it stands on, which is held here for the same
        // reason growing one is: the worlds live with the simulation, not with the roster
        if (message.type === 'open') { this.lift(client, room, message); return; }
        // a piece of the world itself, which is bytes rather than words and so is answered here
        // where the ground is, rather than in the roster which knows only about people
        if (message.type === 'want-chunks') { this.sendChunks(client, message); return; }
        handle(this.rooms, client, room, message);
      },
      leave: () => {
        if (!client) return;
        if (this.rooms.get(client.seed)?.clients.size === 1) this.keepMindsOf(client.seed);
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
    // The world clock accounts for elapsed wall time below, but bodies can only take one ordinary
    // simulation step when the event loop wakes up. Passing a long stall through to EntityManager
    // lets a goat move several tiles in one update; the following timer callbacks then arrive in a
    // burst with near-zero deltas, which clients cannot smooth into ordinary movement.
    const creatureSeconds = Math.max(0, Math.min(seconds, MAX_CREATURE_STEP));
    // Silence is counted in time the server was awake for, not in wall clock: see `HEARD_AT_MOST`.
    const heard = Math.min(now - this.lastTick, HEARD_AT_MOST);
    this.lastTick = now;

    for (const [seed, room] of this.rooms.entries()) {
      for (const client of room.clients) {
        if (this.warmingClients.has(client)) { client.silent = 0; continue; }
        client.silent += heard;
        if (client.silent > this.timeout) { client.wire.close(); this.rooms.leave(client); }
      }
      if (room.clients.size === 0) {
        // the loudest "nobody is here" there is, so the provinces are put away properly rather than
        // dropped with the room: written, stamped with the hour the last of them left, and their
        // villagers' memories settled. Without it the stamp on a world everybody has quit would be
        // whenever it was last changed, and the next player through the door would be handed a
        // stretch of absence that started before anybody had actually gone.
        room.world.keepNear([]);
        this.rooms.close(seed);
        this.keepMindsOf(seed);
        this.ground.delete(seed);
        this.patchworks.delete(seed);
        this.groundKinds.delete(seed);
        this.countryStamps.delete(seed);
        this.folk.delete(seed);
        this.held.delete(seed);
        this.wildlife.delete(seed);
        this.rooms.forgetGround(seed);
        continue;
      }

      room.world.tick(seconds);
      // Whatever country has arrived since last tick, folded in: a hero walking into a square that
      // was not there grows it, and its villages have to reach the register before anybody is put
      // in one of their streets. Costs one set lookup per patch held in a world nobody is
      // exploring, which is every tick of a road world for ever. See `server/people.ts`.
      this.folk.get(seed)?.catchUp();
      /*
       * And whoever has just been settled gets what was kept for them, before anybody can talk to
       * them. A village is lived when somebody walks into it, so this is the moment its people
       * first exist — see `HeldMinds`, which gives each of them theirs exactly once.
       */
      const waiting = this.held.get(seed);
      const folk = this.folk.get(seed);
      if (waiting && folk && waiting.waiting > 0) waiting.giveTo(everybodyIn(folk.register));
      // The book catches up before anybody walks a villager anywhere. A day turning over buries the
      // old, fills the gaps, grows the children up and pays everybody for a day's work, and the
      // street is brought back into line with it on the next step — so the order is the register
      // first and the people second, exactly as it is on a client.
      const wildlife = this.wildlife.get(seed);
      const beforeDay = wildlife?.register?.today;
      const turned = wildlife?.register && advanceWorldCarriers(
        wildlife.register, room.world.clock.day, (delta) => {
          if (room.world.apply(delta)) this.rooms.broadcast(seed, { type: 'delta', delta, from: '' });
        },
      );
      if (wildlife?.register?.today !== beforeDay) wildlife?.syncBuildings();
      // and what the day turned up goes into the world's chronicle, which is the only thing in the
      // game that keeps what *changed* rather than what is true. See `chronicle.ts`
      if (turned?.length) this.chronicleOf(seed).record(turned);
      if (room.world.sweepStalls()) this.rooms.broadcast(seed, { type: 'stalls', stalls: room.world.stalls });
      // who is where. A world is several worlds at once — the country, and a floor under every
      // staircase somebody is standing on — and each of them is stepped for the people in it.
      const above = [...room.clients].filter((c) => c.standingIn === 'surface' && !this.warmingClients.has(c));
      const players = above.map((c) => c.presence);
      this.sinceCreatures += TICK;
      const tellNow = this.sinceCreatures >= CREATURE_INTERVAL;
      if (tellNow) this.sinceCreatures = 0;

      // The leavings of the country they are standing in: what has been sown, dug or opened near
      // them is in memory, and what is not is on disk until somebody walks back to it.
      //
      // Outside the ground's block below on purpose, and unconditional on purpose. A province is
      // state rather than terrain, so a host that does not grow the country still has to let go of
      // the squares nobody is on — both hosts happen to pass `ground: true` today, which is exactly
      // how a coupling like that goes years without being noticed. And an empty list is a real
      // answer rather than a case to skip: with the whole party down a staircase there is nobody on
      // the surface at all, so every province is written and let go, and the time they spend down
      // there is time the country above them was genuinely asleep. `SharedWorld.asleep` is where
      // that lands, and a coarse tier will want it to be the truth rather than the tidy answer.
      room.world.keepNear(players);
      // the ground exists where somebody is standing, and nowhere else: a chunk nobody is near is a
      // chunk with nobody to tell about it
      const ground = this.ground.get(seed) ?? (this.warming.has(seed) ? null : this.groundOf(seed));
      if (ground && players.length > 0) {
        // First the country they can see, then the country they can be bitten in. In that order
        // because the second is a subset of the first and is taken out of it for nothing: a chunk
        // grown to be handed over is the same chunk a wolf walks on.
        for (const who of players) ground.ready(who.x, who.z, VIEW);
        ground.keepReadyNear(players, VIEW + 1);
        for (const who of players) ground.reach(who.x, who.z, this.reach);
        ground.keepOnly(players, this.reach + 1);
        // and the creatures on it, following the players about
        const alive = this.wildlife.get(seed);
        if (alive) {
          this.stepAndTell(alive, 'surface', above, creatureSeconds, room.world.clock.time, tellNow, () => {
            // `alive.step` is what first puts a village's residents on its register. Restore them
            // before `tellAboutCreatures` introduces the people to a client, which is the first
            // moment that client can know an id well enough to change its mind.
            if (waiting && folk && waiting.waiting > 0) waiting.giveTo(everybodyIn(folk.register));
          }, alive.register ? carrierOnRoad(alive.register, alive.villages, ground,
            Math.floor(room.world.clock.day), room.world.clock.time) : null);
        }
      }
      this.stepFloors(seed, room, creatureSeconds, tellNow);
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
    beforeTell?: () => void, carrier?: CreatureSnap | null,
  ): void {
    // Each of them as much of a player as the creatures need: where, what they are wearing, and how
    // badly the law wants them. The object is the client's own and is refreshed rather than remade,
    // so anything the world says happened to one of these — a bite, an arrest — can be handed back
    // as the very object it was about and matched by identity rather than by guessing.
    const standing = who.map((c) => {
      c.standing.x = c.presence.x;
      c.standing.z = c.presence.z;
      c.standing.gear = c.presence.gear;
      c.standing.guilt = c.guilt;
      return c.standing;
    });
    // told rather than taken: hearts live in a player's own save, so the world says a wolf bit you
    // and how hard, and your own game works out what your guard was worth and which way it threw you
    for (const bite of alive.step(dt, standing, time)) {
      const bitten = who.find((c) => c.standing === bite.who);
      if (bitten) this.rooms.send(bitten, { type: 'bitten', place, id: bite.id, damage: bite.damage });
    }
    beforeTell?.();
    // everything in sight, at the rate the middle distance deserves; and what is close enough to
    // fight, every tick, because that is what the player is aiming at
    if (tell) this.tellAboutCreatures(alive, place, who, null, carrier);
    this.tellAboutCreatures(alive, place, who, CLOSE_ENOUGH_TO_FIGHT, carrier);
  }

  /**
   * Somebody who lived in one of this world's villages has been killed by something.
   *
   * The one fact about a village that nothing could have worked out for itself, which is why it has
   * always been the one fact that travelled. It used to be reported by whichever client happened to
   * be watching; the villagers are the world's now, so it starts here — the book loses him, the log
   * of what has changed carries him, and every client applies the same death on the same day and
   * ends up holding the same village.
   *
   * They are told twice on purpose, and the two say different things. The delta is that he is off
   * the register for good. The `killed` is that a body fell here, which is what leaves a pack in the
   * grass and puts a line on the screen of whoever was near enough to hear it — and those are
   * decided by each player's own save, which the world has never held.
   */
  private buried(seed: number, who: Entity, id: number): void {
    const room = this.rooms.get(seed);
    if (!room || who.person === '') return;
    const day = Math.floor(room.world.clock.day);
    this.wildlife.get(seed)?.register?.bury(who.person, day);
    const delta: WorldDelta = { kind: 'died', who: who.person, village: who.herd.tag, day };
    room.world.apply(delta);
    this.rooms.broadcast(seed, { type: 'delta', delta, from: '' });
    this.rooms.broadcast(seed, { type: 'killed', place: 'surface', id, by: '' });
  }

  /** Remove only a recorded departure; rows for people whose village is not settled stay held. */
  private forgetTheMind(seed: number, id: string): void {
    if (!this.minds) return;
    try { forgetMind(this.minds, seed, id); }
    catch (why) {
      console.error(`world ${seed}: could not forget departed villager ${id} — ${String(why)}`);
    }
  }

  /**
   * A constable has laid hands on one of the players.
   *
   * Only the man it happened to is told, and only that it happened: how long he is held, what it
   * costs him and which cell he wakes in are his own game's arithmetic, on his own save, exactly as
   * a bite is. The constable travels as the number the client is already drawing him under, so it
   * has a name to put in the sentence.
   */
  private tellOfArrest(seed: number, by: number, whom: Standing): void {
    const room = this.rooms.get(seed);
    if (!room) return;
    for (const client of room.clients) {
      if (client.standing === whom) { this.rooms.send(client, { type: 'arrested', id: by }); return; }
    }
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
        this.floors.delete(key);
        this.rooms.forgetCreatures(seed, place);
        continue;
      }
      this.stepAndTell(alive, place, here, dt, room.world.clock.time, tell);
    }
  }

  /**
   * @param within when given, only creatures this close are described and nothing is reported as
   * gone — this is the frequent pass over what the player is close enough to fight, and a creature
   * that has merely walked out of arm's reach has not walked out of sight.
   */
  private tellAboutCreatures(alive: Wildlife, place: string, who: ReadonlyArray<Client>, within: number | null,
    carrier?: CreatureSnap | null): void {
    for (const client of who) {
      const near = alive.inSightOf(client.presence.x, client.presence.z, within ?? undefined);
      if (carrier && Math.hypot(carrier.x - client.presence.x, carrier.z - client.presence.z)
        <= (within ?? 60)) near.push({ ...carrier, who: { ...carrier.who! } });
      const changed: CreatureSnap[] = [];
      const now = new Map<number, string>();
      for (const c of near) {
        // what a client would draw differently: where it is, which way it faces, what it is doing
        const shape = `${c.x},${c.z},${c.y},${c.yaw},${c.walk},${c.state},${c.hp}`;
        now.set(c.id, shape);
        // And who he is, for the few of them who are anybody. It changes on a scale of days — a
        // trade taken up, a face swapped in when somebody dies in the night, something he will not
        // forget — while everything above changes three times a second, so it is sent when it is new
        // to this client and taken off again when it is not. A villager who cost his name and his
        // whole memory on the wire every third of a second would cost more than the herd he lives
        // beside, and say nothing.
        if (c.who) {
          const told = JSON.stringify(c.who);
          if (client.knows.get(c.id) === told) delete c.who;
          else client.knows.set(c.id, told);
        }
        if (client.seeing.get(c.id) !== shape || c.who) changed.push(c);
      }
      if (within !== null) {
        // a partial view: correct what it covers and leave the rest of what this client is seeing
        for (const [id, shape] of now) client.seeing.set(id, shape);
        if (changed.length > 0) this.rooms.send(client, { type: 'creatures', place, near: changed, gone: [] });
        continue;
      }
      const gone: number[] = [];
      for (const id of client.seeing.keys()) if (!now.has(id)) gone.push(id);
      // and whoever has gone is forgotten as a person too, so that walking back into a village is
      // being told who is standing in it rather than being handed bodies with no names on them
      for (const id of gone) client.knows.delete(id);
      client.seeing = now;
      if (changed.length === 0 && gone.length === 0) continue;
      this.rooms.send(client, { type: 'creatures', place, near: changed, gone });
    }
  }

  /**
   * Hand over pieces of the world a page says it does not have.
   *
   * The world grows these chunks anyway — it has to, to walk creatures across them — so sending one
   * costs the packing and the wire and nothing else. A page asks only for what it is missing, and a
   * page that has been here before asks for nothing, so a country is paid for once by whoever walks
   * it and never again.
   *
   * Capped per message because a client asking for ten thousand chunks is either broken or trying
   * it on, and the answer to both is the same: as many as anybody could want at once, and no more.
   */
  private sendChunks(client: Client, message: Extract<ClientMessage, { type: 'want-chunks' }>): void {
    if (this.warmingClients.has(client)) return;
    const ground = this.groundOf(client.seed);
    if (!ground) return;
    const wanted = Array.isArray(message.chunks) ? message.chunks.slice(0, CHUNKS_AT_ONCE) : [];
    for (const pair of wanted) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const cx = Math.trunc(Number(pair[0])), cz = Math.trunc(Number(pair[1]));
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const parcel = ground.parcelOf(cx, cz);
      if (parcel) this.rooms.sendBytes(client, packChunk(parcel));
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
    const kind = message.kind === 'cave' || message.kind === 'thicket' || message.kind === 'wreck'
      ? message.kind : 'dungeon';
    const floor = Math.max(1, Math.min(FLOORS, Math.floor(Number(message.floor) || 1)));
    const seed = new Manifest(client.seed).deriveSeed(anchorId, kind, null);
    /*
     * What the rooms are grown as, which is not always what the anchor is.
     *
     * A page that says nothing is a page from before the drowned places existed, and it means what
     * it has always meant: grow it the way the anchor kind says. A page that does say is taken at
     * its word within the four the generator knows — a whirlpool's cavern and a wreck's hold are
     * both `sunken` and hang off anchors of two different kinds, so this cannot be worked out from
     * `kind` at either end.
     */
    const style = asDungeonStyle(message.style, kind === 'dungeon' || kind === 'wreck' ? 'vault' : kind);
    const world = new DungeonWorld(generateDungeon(seed, style, floor), place, style);
    // a floor has no chunks streaming into it: what lives down there is put there once, now
    const alive = new Wildlife(seed + floor, world, { getTiles: () => null });
    alive.fill(world.map, seed, floor, style);
    this.underworlds.set(key, alive);
    this.floors.set(key, { world, seed });
    this.rooms.ownCreatures(client.seed, place, alive);
  }

  /**
   * Somebody has lifted the lid on a chest, and the world says whether that was theirs to lift.
   *
   * The rule is in `chests.ts`; this only hands it what it needs, which is the floor as this world
   * grew it and the hero as this world has been walking him — neither of them anything the asking
   * client chose.
   */
  private lift(client: Client, room: Room, message: Extract<ClientMessage, { type: 'open' }>): void {
    lidLifted({
      floor: this.floors.get(`${client.seed}|${client.standingIn}`) ?? null,
      // where the world has him: the position it walked him to out of doors, and the one it was last
      // told below ground, which are the same object either way
      hero: client.hero ?? client.presence,
      standingIn: client.standingIn,
      apply: (delta) => room.world.apply(delta),
      broadcast: (delta) => this.rooms.broadcast(client.seed, { type: 'delta', delta, from: client.presence.id }, client),
      send: (reply) => this.rooms.send(client, reply),
    }, message);
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
    const requestedSeed = message.seed >>> 0;
    const kind = message.kind === 'road' ? 'road' : 'endless';
    let record = message.worldName === undefined
      ? this.rooms.worldRecordForSeed(requestedSeed)
      : undefined;
    if (message.worldName !== undefined) {
      try {
        record = this.rooms.claimWorld(message.worldName, requestedSeed, kind);
      } catch (error) {
        const reason = error instanceof WorldRecordConflict ? error.message : 'That world name could not be opened.';
        wire.send(JSON.stringify({ type: 'error', reason } satisfies ServerMessage));
        wire.close();
        return null;
      }
    }

    // A named record is the authority. An unnamed join still opens old seed-numbered saves exactly
    // as it did before names existed.
    const seed = record?.seed ?? requestedSeed;
    let room: Room;
    try {
      room = this.rooms.open(seed, {
        day: Math.max(1, Math.floor(message.day) || 1),
        time: Number(message.time) || 0.3,
      }, record, kind);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'That world could not be opened.';
      wire.send(JSON.stringify({ type: 'error', reason } satisfies ServerMessage));
      wire.close();
      return null;
    }
    if (this.localAuthoring && message.terrain !== undefined) {
      const terrain = localTerrain(message.terrain);
      if (!terrain || ((this.ground.has(seed) || room.clients.size > 0)
        && JSON.stringify(room.world.manifest.terrain) !== JSON.stringify(terrain))) {
        wire.send(JSON.stringify({ type: 'error', reason: 'This world could not accept those terrain layers.' } satisfies ServerMessage));
        wire.close();
        return null;
      }
      if (JSON.stringify(room.world.manifest.terrain) !== JSON.stringify(terrain)) room.world.authorTerrain(terrain);
    }
    if (this.localAuthoring && message.highlands !== undefined) {
      const highlands = localHighlands(message.highlands);
      const changed = highlands?.some((a) => !room.world.manifest.get(a.id));
      const conflicting = highlands?.some((a) => {
        const known = room.world.manifest.get(a.id);
        return known && JSON.stringify(known) !== JSON.stringify(a);
      });
      if (!highlands || conflicting || (changed && (this.ground.has(seed) || room.clients.size > 0))) {
        wire.send(JSON.stringify({ type: 'error', reason: 'This world could not accept that highland prayer.' } satisfies ServerMessage));
        wire.close();
        return null;
      }
      room.world.authorHighlands(highlands);
    }
    const x = Number(message.x), z = Number(message.z);
    const at = Number.isFinite(x) && Number.isFinite(z) ? { x, z } : undefined;
    const joining = this.rooms.admit(wire, room, seed, cleanName(message.name), at, message.playerId);

    this.rooms.send(joining, {
      type: 'welcome', id: joining.presence.id, seed, world: record,
      players: [...room.clients].filter((c) => c !== joining).map((c) => c.presence),
      clock: room.world.clock,
      deltas: room.world.log,
      holdingDays: room.world.holdingDays,
    });
    this.rooms.send(joining, { type: 'stalls', stalls: room.world.stalls });

    const newcomer = room.world.meet(joining.presence.name);
    this.rooms.send(joining, { type: 'folk', names: room.world.folk });
    if (newcomer) this.rooms.broadcast(seed, { type: 'folk', names: room.world.folk }, joining);

    const waiting = room.world.waiting(joining.presence.name);
    if (waiting > 0) this.rooms.send(joining, { type: 'mail-here', from: `${waiting} parcel${waiting === 1 ? '' : 's'}` });

    this.rooms.broadcast(seed, { type: 'joined', player: joining.presence }, joining);
    if (this.preparePatch && this.growGround) {
      this.warmingClients.add(joining);
      const previous = this.warming.get(seed) ?? Promise.resolve();
      let current: Promise<void>;
      current = previous.then(() => this.readyForAsync(joining, message)).catch((error: unknown) => {
        this.rooms.send(joining, { type: 'error', reason: error instanceof Error ? error.message : 'The country could not be grown.' });
        wire.close();
      }).finally(() => {
        this.warmingClients.delete(joining);
        const held = this.wantedWhileWarming.get(joining) ?? [];
        this.wantedWhileWarming.delete(joining);
        if (joining.wire.open && this.rooms.get(seed)?.clients.has(joining)) {
          for (const asked of held) this.sendChunks(joining, asked);
        }
        if (this.warming.get(seed) === current) this.warming.delete(seed);
      });
      this.warming.set(seed, current);
    } else this.readyFor(joining, message);
    return joining;
  }

  /** Prepare the first view without making the HTTP and socket event loop grow its patches. */
  private async readyForAsync(client: Client, message: Extract<ClientMessage, { type: 'join' }>): Promise<void> {
    const seed = client.seed;
    const x = Number(message.x), z = Number(message.z);
    const standing = Number.isFinite(x) && Number.isFinite(z);
    const kind = this.rooms.get(seed)?.kind ?? 'endless';
    const chunks = new Set<string>();
    if (standing) {
      const cx = Math.floor(x / WORLD.CHUNK_SIZE), cz = Math.floor(z / WORLD.CHUNK_SIZE);
      for (let dz = -VIEW; dz <= VIEW; dz++) for (let dx = -VIEW; dx <= VIEW; dx++) {
        chunks.add(patchOfChunk(cx + dx, cz + dz));
      }
    }
    const patchwork = kind === 'endless' ? (this.patchworks.get(seed)
      ?? new Patchwork(seed, growPatch, undefined, this.layersOf(seed), this.terrainOf(seed))) : null;
    const patches = patchwork
      ? [...new Set([...(this.ground.has(seed) ? [] : [patchOf(0, 0)]), ...chunks])]
        .filter((patch) => !patchwork.has(patch)) : [];
    const totalChunks = standing ? (VIEW * 2 + 1) ** 2 : 0;
    const total = patches.length + totalChunks;
    let done = 0;
    const progress = () => this.rooms.send(client, { type: 'country-progress', done, total });
    progress();
    const heartbeat = setInterval(progress, 3000);
    try {
      if (patches.length && this.preparePatch) {
        const layers = this.layersOf(seed), terrain = this.terrainOf(seed);
        for (const patch of patches) {
          const parts = await this.preparePatch(seed, patch, layers, terrain);
          if (!client.wire.open || !this.rooms.get(seed)?.clients.has(client)) return;
          patchwork!.put(patch, rebuildPatch(seed, boundsOf(patch), parts));
          done++;
          progress();
        }
      }
      if (!client.wire.open || !this.rooms.get(seed)?.clients.has(client)) return;
      if (patchwork) this.patchworks.set(seed, patchwork);
      const ground = this.groundOf(seed);
      if (ground && standing) {
        const cx = Math.floor(x / WORLD.CHUNK_SIZE), cz = Math.floor(z / WORLD.CHUNK_SIZE);
        for (let dz = -VIEW; dz <= VIEW; dz++) for (let dx = -VIEW; dx <= VIEW; dx++) {
          ground.ready((cx + dx) * WORLD.CHUNK_SIZE, (cz + dz) * WORLD.CHUNK_SIZE, 0);
          done++;
          if (done % 8 === 0) progress();
          // One chunk is short work; hand the loop back to other players between groups.
          if (done % 8 === 0) await new Promise<void>((resume) => setTimeout(resume, 0));
        }
      }
      progress();
      this.rooms.send(client, { type: 'country', stamp: ground ? this.countryStamps.get(seed) ?? '' : '', kind });
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Grow the country a joining player is about to ask for, before they ask for it.
   *
   * This is the last of the streaming, and it is entirely about arithmetic that never worked out.
   * A page waits a fifth of a second for the world and then draws the ground itself, because a page
   * that waited would stare at nothing every time a socket hiccupped. A world starting from nothing
   * takes about a third of a second to stand its terrain up and another third to grow the hundred
   * and twenty-one chunks of a first view — so the guard written for a hiccup was firing on every
   * new country, and the first minute anywhere new was spent on ground that was right by luck.
   *
   * Nothing here is faster than it was. It happens *earlier*: at the join rather than at the first
   * asking, while the page is still starting up its own renderer, and the chunks are kept instead
   * of being thrown away and grown again for every page that wants one. By the time a page asks,
   * the answer is packing bytes it already has.
   *
   * The `country` that goes out afterwards is the page's cue that the waiting is over, and its
   * stamp is the evidence. It said nothing at all until #377 — *"an endless country has no
   * whole-country fingerprint"* — which was true of the road graph and false of the world: an
   * endless country has a layer list, that list is whole-country, and it is the one thing about
   * such a world that two halves can hold differently. See `endlessStamp`, which says what it can
   * and cannot catch.
   *
   * Still silent where this server grows no ground at all, which is a test harness rather than a
   * game. A stamp taken off a country nobody grew would be a fingerprint of nothing, and the page
   * reads an empty string as silence rather than as agreement.
   *
   * A join that does not say where it is standing gets the country but not the first view. There is
   * nowhere to grow, and guessing a place would be growing the wrong one.
   */
  private readyFor(client: Client, message: Extract<ClientMessage, { type: 'join' }>): void {
    const ground = this.groundOf(client.seed);
    const x = Number(message.x), z = Number(message.z);
    if (ground && Number.isFinite(x) && Number.isFinite(z)) ground.ready(x, z, VIEW);
    const kind = this.rooms.get(client.seed)?.kind ?? 'endless';
    const stamp = ground ? this.countryStamps.get(client.seed) ?? '' : '';
    this.rooms.send(client, { type: 'country', stamp, kind });
  }
}

export { DAY_LENGTH };

/**
 * Everybody a register is holding, across every village it has settled.
 *
 * The register answers per village because that is how a village is lived; the durable half wants
 * the world. One place that turns the first into the second, so the save and the restore cannot
 * come to different answers about who is in this world.
 */
function everybodyIn(register: { living(village: string): readonly Person[]; settled(): readonly string[] }): Person[] {
  return register.settled().flatMap((village) => [...register.living(village)]);
}
