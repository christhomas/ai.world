import * as THREE from 'three';
import { HEALTH } from '../world/health';
import { BEHAVIOUR } from '../entities/properties';
import { thermalsAround } from '../world/thermals';
import { maelstromsAround } from '../world/maelstroms';
import { shaftsAround } from '../world/shafts';
import { openCountry } from './shafts';
import { CAMERA, GAMEPLAY } from '../core/config';
import { PropKind } from '../world/biomes';
import { nameOfProp } from '../world/catalogue';
import { BASE_LEVEL, DTile, levelAt } from '../dungeon/map';
import type { ChunkManager } from '../world/chunkManager';
import type { EntityManager } from '../entities/manager';
import type { Entity } from '../entities/entity';
import type { Player } from '../entities/player';
import { bodyMotion } from '../entities/motion';
import type { Register } from '../world/register';
import type { SkyIsland } from '../world/skyisland';
import type { Site, Structures } from '../world/structures';
import type { EntityRenderer } from '../entities/pool';
import type { Mount } from './mount';
import { StructureKind } from '../world/structures';
import type { Jail } from './jail';
import { bodyOf } from '../entities/entity';
import type { TerrainSampler } from '../world/terrain';
import type { WorldKind } from '../save/store';
import type { Drift } from './wildlife';
import type { CommandBus } from '../core/commandbus';
import type { IsoCamera } from '../render/camera';
import type { SceneRig } from '../render/scene';
import { BUILDS, buildable, stageAt, type Houses } from './building';
import type { CommandWorld } from './commands';
import { installPeopleProbes } from './probesPeople';
import type { Director } from './director';
import type { Eyrie } from './eyries';
import type { Plots } from './farming';
import type { Market } from './market';
import { mineIdOf, type Mines, type Working } from './mines';
import type { Nemesis } from './nemesis';
import type { Online } from './online';
import type { Places } from './places';
import type { Quest } from './quests';
import type { Remains } from './remains';
import { bandAt, bandsNear, type Roaming } from './roaming';
import type { Sailing } from './sailing';
import type { Skies } from './skies';
import { stableAt } from './stables';
import type { GameState } from './state';
import type { TalkCtx } from './talk';
import type { Warband } from './warband';
import { worldSeconds } from './ferry';
import { whaleAt, type Pod } from './whales';

/**
 * The handles a headless browser drives the game by, hung on `window` and stripped from anything
 * a player ever downloads.
 *
 * They exist because the only honest way to know whether a world works is to walk about in it, and
 * nobody can walk about in it a hundred times a day. Every one of them answers a question a
 * screenshot cannot: where the whales are this hour, what the register thinks happened in a
 * village overnight, whether the thing standing in front of you is the world's or ours.
 *
 * Most are now a thin wrapper round a command, because the console, a test and the server should
 * all be saying the same words — see `docs/server-authority.md`. The ones that are not are reading
 * something out of the running game that has no business being a command.
 */
export interface Probed {
  seed: number;
  world: WorldKind;
  state: GameState;
  player: Player;
  rig: SceneRig;
  iso: IsoCamera;
  sampler: TerrainSampler;
  structures: Structures;
  chunks: ChunkManager;
  entities: EntityManager;
  register: Register;
  places: Places;
  online: Online;
  market: Market;
  warband: Warband;
  remains: Remains;
  plots: Plots;
  houses: Houses;
  sailing: Sailing;
  skies: Skies;
  skyIsles: readonly SkyIsland[];
  eyries: readonly Eyrie[];
  /** Asked rather than held: which families are out there depends on where the hero is. */
  pods: () => readonly Pod[];
  mines: Mines;
  /** The country's cells, and so its charge sheets. */
  jail: Jail;
  /** Whatever the hero is riding, so a script can get on a horse without finding a stable first. */
  mount: Mount;
  /**
   * Lay a village's descent on the table, without walking into a town hall and paying for it.
   *
   * The same argument `__enterCastle` makes: the thing is reachable only through a conversation,
   * which a person has in ten seconds and a script cannot have at all — so without this there is
   * no way to look at the family tree from outside the browser, and a drawing nobody can look at
   * is a drawing nobody checks.
   */
  drawLineage: (village: string) => void;
  /** And where a bought horse is drawn, which is the overworld's own pool. */
  overworldRenderer: EntityRenderer;
  roaming: Roaming;
  nemesis: Nemesis;
  director: Director;
  /** Which cave each village calls its mine, so a test can walk into one without finding it. */
  claimed: Map<string, Site>;
  minesWorked: () => Working[];
  fightingInAMine: () => string | null;
  questList: readonly Quest[];
  talkCtx: TalkCtx;
  commands: CommandBus;
  commandWorld: CommandWorld;
  /** Put a body on the ground where one can be looked at. Dev only, like everything in this file. */
  leaveOne: (kind: string, x: number, z: number) => void;
  /** The canvas wing: opening it, and whether it is open. */
  wing: { open: () => boolean; flying: boolean; altitude: number; climbing: boolean };
  callOut: (to: string) => void;
  placeName: () => string;
  carcasses: () => unknown;
  markers: () => unknown;
  /** How the client's guess and the world's answer are getting on. */
  walking: { answers: number; corrections: number; worst: number };
  /** The doorstep watcher, so a test can say why a door did or did not open. */
  doorsteps: { ready: boolean; resting: number };
  /** What the country streaming has done: waiting on, asked for, read back, arrived. */
  streamTally: { asked: number; kept: number; arrived: number; wanted: number };
  /** How far behind the world the drawn creatures are, in tiles. */
  drift: () => Drift;
  /** What has bitten the hero lately, and how far off the biter was drawn. */
  bites: ReadonlyArray<{ at: number; id: number; damage: number; away: number | null }>;
  /** What the water listener last worked out. Read live: it changes every frame. */
  heard: () => { nearness: number; drop: number };
  /** The one Old Nettle standing in the world, and his lot. Read live: they come and go. */
  nettleAbout: () => Entity | null;
  sentOut: () => readonly Entity[];
}

export function installProbes(ctx: Probed): void {
  const {
    seed, world, state, player, rig, iso, sampler, structures, chunks, entities, register, places,
    online, market, warband, remains, plots, houses, sailing, skies, skyIsles, eyries, pods, mines,
    roaming, nemesis, director, claimed, minesWorked, fightingInAMine, questList, talkCtx, commands,
    commandWorld, callOut, placeName, carcasses, markers, walking, drift, bites, doorsteps, streamTally, wing, leaveOne,
    heard, nettleAbout, sentOut, mount, overworldRenderer,
  } = ctx;

  const debug = window as unknown as {
    __state?: unknown; __doors?: unknown; __player?: unknown;
    __teleport?: (x: number, z: number) => void; __standAtCounter?: () => void;
  };
  debug.__state = state;
  (debug as { __scene?: unknown }).__scene = rig.scene;
  (debug as { __rig?: unknown }).__rig = rig;
  (debug as { __iso?: unknown }).__iso = iso;
  (debug as { __sampler?: unknown }).__sampler = sampler;
  (debug as { __pods?: () => unknown }).__pods = () => pods();
  (debug as { __sailing?: unknown }).__sailing = sailing;
  (debug as { __whaleY?: () => number[] }).__whaleY = () => {
    const now = worldSeconds(state.day, state.time);
    return pods().flatMap((pod) => Array.from({ length: pod.size }, (_, i) => Math.round(whaleAt(pod, i, now).y * 100) / 100));
  };
  (debug as { __three?: unknown }).__three = THREE;
  (debug as { __online?: unknown }).__online = online;
  debug.__doors = structures.doors;
  (debug as { __villages?: unknown }).__villages = structures.villages;
  (debug as { __piers?: unknown }).__piers = structures.piers;
  // where the hulls are, so a test can walk up to one and go down into it
  (debug as { __wrecks?: unknown }).__wrecks = structures.wrecks;
  (debug as { __descent?: () => unknown }).__descent = () => places.underground?.world.map.descent ?? null;
  (debug as { __boss?: () => unknown }).__boss = () => places.underground?.world.map.boss ?? null;
  (debug as { __descend?: () => void }).__descend = () => commandWorld.descend();
  (debug as { __climbOut?: () => void }).__climbOut = () => commandWorld.climbOut();
  (debug as { __plots?: () => unknown }).__plots = () => plots.count;
  (debug as { __houses?: () => unknown }).__houses = () => ({
    hired: houses.hired,
    jobs: houses.entries().map((job) => ({ ...job, stage: stageAt(job, state.day + state.time) })),
  });
  /*
   * Put a finished building on the ground where you stand, for checking that a wall is a wall.
   *
   * Takes what as well as where, now that a builder can be told to put up more than a house: a
   * storey and a pool go on a house you already own, so `to` is the id of the one they belong to —
   * `__houses()` lists them with their ids. Everything is paid for and back-dated past its own
   * number of days, because what this probe is for is the finished thing rather than the waiting.
   */
  (debug as { __build?: (x: number, z: number, what?: string, to?: string) => unknown }).__build =
    (x, z, what = BUILDS.HOUSE, to) => {
      const wants = buildable(what);
      houses.takeOn('Crossroads Town', wants.price, wants.price, wants.id);
      const job = houses.place(x, z, state.day - wants.days - 1, 0, to);
      state.version++;
      return job;
    };
  (debug as { __solid?: (x: number, z: number) => boolean }).__solid = (x, z) => chunks.blocked(x, z);
  (debug as { __place?: () => string }).__place = () => placeName();
  /*
   * Which world this is, in the two facts that decide everything about it.
   *
   * A seed is not a world: the same number grows a road country or a polygon one, sharing nothing.
   * When the server was growing the wrong one the symptoms were spectacular and impossible to name
   * from inside the game — walls in open fields, wolves biting from nowhere — and the first
   * question anybody needed answering was "which world am I actually in", which nothing could say.
   */
  // read rather than called, because half of these are functions and half are not, and the one you
  // reach for while something is badly wrong should not also ask you to remember which
  Object.defineProperty(debug, '__world', { configurable: true, get: () => ({ seed, world, online: online.status }) });
  /*
   * How far the drawn world is behind the real one.
   *
   * The world owns the creatures and sends where they are three times a second; the game eases
   * them towards it so they do not jump. Both halves are honest and the player still swings at a
   * wolf that is not there any more, because what is drawn is where it was. This is that gap, in
   * tiles, so it can be argued about with a number instead of a feeling.
   */
  /*
   * The room the hero is standing in, and what stops him in it.
   *
   * Indoors is a different world with its own walls and its own furniture, and nothing could see
   * into it from outside — `__solid` answers about the hillside, which indoors is a question about
   * a place the hero is not. So a bed you could walk through was invisible to every probe there
   * was.
   */
  (debug as { __room?: () => unknown }).__room = () => {
    const room = places.indoors;
    if (!room) return null;
    return {
      name: room.world.map.name,
      size: [room.world.map.w, room.world.map.h],
      door: room.world.map.door,
      entry: room.world.map.entry,
      furniture: room.world.map.furniture.map((f) => ({ kind: f.kind, x: f.x, z: f.z, rot: Math.round(f.rot * 100) / 100 })),
      solid: (x: number, z: number) => room.world.blocked(x, z),
      /** Whether the hero is standing in the doorway, and what the doorstep is waiting for. */
      atTheDoor: room.world.inDoorway(player.x, player.z, 0.68, 0.49),
      resting: Math.round(doorsteps.resting * 10) / 10,
      armed: doorsteps.ready,
    };
  };
  // where the ground is coming from: the world, or what this page kept
  /**
   * What this page asked the world for, what it had already, and what it grew itself.
   *
   * `grown` is the one worth watching: it is the number of chunks this page drew from its own
   * generation because the world had not answered, and it is the only way left for the two halves
   * of the game to be standing in different countries. It should be nought on a connected page.
   */
  Object.defineProperty(debug, '__stream', {
    configurable: true,
    get: () => ({ ...streamTally, grown: chunks.grown }),
  });
  Object.defineProperty(debug, '__wire', {
    configurable: true,
    get: () => ({ sent: Object.fromEntries(online.tally.sent), heard: Object.fromEntries(online.tally.heard) }),
  });
  Object.defineProperty(debug, '__drift', { configurable: true, get: () => drift() });
  Object.defineProperty(debug, '__bites', { configurable: true, get: () => bites });
  (debug as { __walking?: () => unknown }).__walking = () => ({
    ...walking, worst: Math.round(walking.worst * 1000) / 1000,
  });
  (debug as { __stalls?: () => unknown }).__stalls = () => {
    const village = structures.villages
      .map((v) => ({ v, d: Math.hypot(v.x - player.x, v.z - player.z) }))
      .sort((a, b) => a.d - b.d)[0]?.v;
    return village ? { village: village.name, pitches: market.pitchesOf(village) } : null;
  };
  (debug as { __enterShrine?: () => void }).__enterShrine = () => { commandWorld.enterShrine(); };
  // Everything on the floor, whoever owns it: the world's monsters arrive as guests rather than
  // as entries in this manager's own roster, so reading the roster showed an empty dungeon.
  (debug as { __monsters?: () => unknown }).__monsters = () =>
    (places.underground?.monsters.within(player.x, player.z, 999) ?? []).map((m) => ({
      kind: m.kind.id, world: m.worldId,
      x: Math.round(m.x * 100) / 100, z: Math.round(m.z * 100) / 100, hp: m.hp,
    }));
  (debug as { __drop?: () => void }).__drop = () => { commandWorld.drop(); };
  (debug as { __packs?: () => unknown }).__packs = () => remains.all;
  (debug as { __sow?: (x: number, z: number) => void }).__sow = (x, z) => { commandWorld.sow(x, z); };
  (debug as { __discover?: (n: string) => void }).__discover = (n) => { commandWorld.discover(n); };
  (debug as { __reportChest?: (id: string) => void }).__reportChest = (id) => { state.opened.add(id); online.report({ kind: 'chest', id }); state.version++; };
  (debug as { __shrines?: unknown }).__shrines = structures.pois.filter((p) => p.kind === StructureKind.Shrine).map((p) => ({ name: p.name, x: p.x, z: p.z }));
  /**
   * The crowd the hero is actually standing in.
   *
   * There is more than one `EntityManager` in this game — the country has one, and every dungeon
   * floor, mine and castle keep has its own — and `places.crowd` is whichever of them owns what is
   * around the hero right now. Every probe that answers "who is near me" has to ask it that way or
   * it answers about the fields overhead while the hero is four floors down, which reads as an
   * empty cave and is how a crew of miners went unnoticed for a night.
   */
  const crowdAround = (): EntityManager => places.crowd ?? entities;

  (debug as { __entitiesFull?: () => unknown }).__entitiesFull = () =>
    // hearts and which way it is facing included: a fight cannot be watched from outside without
    // them, and "did that blow land" was unanswerable while the only readouts were name and place.
    // Whichever crowd the hero is standing in, for the same reason `__entities` asks that way: a
    // mine's crew and a dungeon's monsters are a manager of their own, and a probe that only ever
    // reads the overworld one reports an empty cave to somebody standing in a crowded one
    crowdAround().within(player.x, player.z, 90).map((e) => ({
      kind: e.kind.id, name: e.name, role: e.role, x: e.x, z: e.z,
      hp: e.hp, dead: e.dead, yaw: Math.round(e.yaw * 100) / 100, id: e.worldId ?? null,
      // the box it is collided against, so a test can ask whether two of them are inside each other
      body: bodyOf(e.kind),
    }));
  (debug as { __entities?: () => unknown }).__entities = () => commandWorld.entities();
  /*
   * Who the game would talk to if you pressed Enter, and why it would not.
   *
   * `Enter` ends at `entities.nearest`, and when that answers nothing the player is told "no one
   * close enough" — which is the same sentence whether there is genuinely nobody there or whether
   * somebody standing at arm's length is being skipped for a reason. This reports both sides of
   * that: what the crowd answers, and what the nearest few look like to the rule it uses.
   */
  (debug as { __talkable?: () => unknown }).__talkable = () => {
    const crowd = crowdAround();
    const found = crowd.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
    return {
      range: GAMEPLAY.TALK_RANGE,
      found: found ? { kind: found.kind.id, name: found.name } : null,
      near: crowd.within(player.x, player.z, 6)
        .map((e) => ({
          kind: e.kind.id, name: e.name, indoors: e.indoors, dead: e.dead, dying: e.dying,
          away: Math.round(Math.hypot(e.x - player.x, e.z - player.z) * 100) / 100,
        }))
        .sort((a, b) => a.away - b.away)
        .slice(0, 6),
    };
  };
  installPeopleProbes(ctx);
  (debug as { __callOut?: (id: string) => void }).__callOut = (id) => callOut(id);
  /*
   * Walk the hero somewhere, and say when he has got there.
   *
   * The thing `Player.autopilot` was for. A script driving the game used to have to hold keys down
   * and hope — `keyboard.down('w')`, wait, `keyboard.up('w')` — which measures the keyboard as much
   * as it measures the game, and cannot say "go to the village" at all. This hands the hero the
   * same steer the keyboard would have handed him and clears itself when he arrives.
   *
   * Not a teleport, and that is the whole value: `__teleport` puts him somewhere and drags his
   * hired company with him, so it can never answer a question about walking. This walks.
   *
   * Poll `__player.steering` to know when he has finished, and `__player.x`/`z` to know whether
   * finishing meant arriving: he gives up on a place he cannot reach rather than leaning on the
   * thing in the way of it, so a script never waits on him for ever.
   */
  (debug as { __walkTo?: (x?: number, z?: number) => unknown }).__walkTo = (x, z) => {
    player.walkTo(x, z);
    return { steering: player.steering, at: [Math.round(player.x), Math.round(player.z)] };
  };
  (debug as { __hire?: (n: number) => unknown }).__hire = (n) => commandWorld.hire(n);
  // tell everybody in your pay the same thing, for checking from outside that an order changes
  // what a man actually does rather than only what the books say about him
  (debug as { __tell?: (order: string) => unknown }).__tell = (order) => commandWorld.tell(order);
  (debug as { __spawn?: (kind: string, away?: number) => unknown }).__spawn = (kind, away = 2) => commandWorld.spawn(kind, away);
  /*
   * Hurt whoever is nearest, without hitting them: the flash and the bar, with none of the fight.
   *
   * Deliberately not `damageEntity` — no knockback, nobody turning on you — because what this is
   * for is photographing a wounded creature standing still.
   */
  (debug as { __hurt?: (damage?: number) => unknown }).__hurt = (damage = HEALTH.A_SCRATCH) => {
    const near = crowdAround().within(player.x, player.z, 30)
      .filter((e) => !e.dead && e.kind.id !== 'hero')
      .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    const hit = near[0];
    if (!hit) return null;
    hit.hp = Math.max(1, hit.hp - damage);
    hit.hurt = BEHAVIOUR.HURT_TIME;
    hit.bar = BEHAVIOUR.BAR_TIME;
    return { kind: hit.kind.id, name: hit.name, hp: hit.hp, of: hit.kind.hp ?? 1, x: hit.x, z: hit.z };
  };
  // the wing, so a headless browser can take off without having to land two keypresses a tenth of
  // a second apart
  (debug as { __wing?: unknown }).__wing = wing;
  // where the holes in the ground are, and whether each is on ground that could really have one
  (debug as { __shafts?: () => unknown }).__shafts = () =>
    shaftsAround(player.x, player.z, 400, seed)
      .filter((one) => openCountry(chunks, one.x, one.z))
      .map((one) => ({ ...one, away: Math.round(Math.hypot(one.x - player.x, one.z - player.z)) }))
      .sort((a, b) => a.away - b.away);
  // Leave a body on the ground without hunting one: what a drop looks like is checked by looking,
  // and an animal that runs away at four frames a second cannot be photographed.

  (debug as { __leave?: (kind?: string) => unknown }).__leave = (kind = 'deer') => {
    leaveOne(kind, player.x + 2, player.z);
    return { kind, x: Math.round(player.x + 2), z: Math.round(player.z) };
  };
  // and where the sea goes down, for the same reason: a whirlpool four hundred tiles away is not
  // a thing a headless browser can go and find by sailing about
  (debug as { __swallows?: () => unknown }).__swallows = () =>
    maelstromsAround(player.x, player.z, 900, seed)
      // the ones actually at sea: a cell whose spot fell on grass has no whirlpool in it
      .filter((one) => chunks.waterAt(one.x, one.z) !== null)
      .map((one) => ({ ...one, away: Math.round(Math.hypot(one.x - player.x, one.z - player.z)) }))
      .sort((a, b) => a.away - b.away);
  // and where the warm air stands, so a photograph of it can be taken from the right hillside
  (debug as { __thermals?: () => unknown }).__thermals = () =>
    thermalsAround(player.x, player.z, 300, seed)
      .map((one) => ({ x: Math.round(one.x), z: Math.round(one.z), away: Math.round(Math.hypot(one.x - player.x, one.z - player.z)) }))
      .sort((a, b) => a.away - b.away);
  (debug as { __blow?: () => unknown }).__blow = () => ({
    hero: { blow: player.entity.blow, strike: Math.round(player.entity.strike * 100) / 100 },
    others: crowdAround().within(player.x, player.z, 30)
      .filter((e) => e.strike > 0)
      .map((e) => `${e.kind.id}: ${e.blow} ${Math.round(e.strike * 100) / 100}`),
  });
  (debug as { __dying?: () => unknown }).__dying = () => entities.theFallen().map((e) => {
    const body = bodyMotion(e);
    return {
      kind: e.kind.id, left: Math.round(e.dying * 100) / 100,
      roll: Math.round(body.roll * 100) / 100, bob: Math.round(body.bob * 100) / 100,
    };
  });
  (debug as { __eyries?: () => unknown }).__eyries = () => eyries.map((e) => ({
    id: e.id, name: e.name, x: Math.round(e.x), z: Math.round(e.z), partner: e.partner, fare: e.fare,
  }));
  (debug as { __skies?: () => unknown }).__skies = () => ({
    aloft: skies.aloft?.name ?? null,
    isles: skyIsles.map((s) => ({
      id: s.site.id, name: s.name, x: s.site.x, z: s.site.z, y: s.site.y, radius: s.site.radius,
      perch: s.perch, loft: s.loft, fall: { x: s.fall.x, z: s.fall.z, lipY: Math.round(s.fall.lipY * 100) / 100 },
    })),
    crags: skyIsles.map((s) => ({ name: s.name, ...s.crag })),
  });
  // Fly up without walking to a crag, so the place can be looked at without playing to it.
  // Coming back down is the ordinary way down, because that is the path that has to work.
  (debug as { __sky?: (n?: number) => unknown }).__sky = (n = 0) => {
    const isle = skyIsles[n];
    if (!isle) return null;
    skies.fly(isle, { x: player.x, z: player.z });
    return { on: isle.name, perch: isle.perch, y: isle.site.y };
  };
  (debug as { __ground?: () => unknown }).__ground = () => { skies.descend(); return { on: 'the ground' }; };
  (debug as { __director?: () => unknown }).__director = () => ({ quietFor: Math.round(director.quietFor), reach: Math.round(director.reach * 100) / 100, last: director.last });
  (debug as { __water?: () => unknown }).__water = () => { const now = heard(); return { ...now, drop: Math.round(now.drop * 10) / 10 }; };
  (debug as { __bodies?: () => unknown }).__bodies = () => carcasses();
  (debug as { __warband?: () => unknown }).__warband = () => ({
    active: warband.active, opponent: warband.opponentName, muster: warband.muster, readout: warband.readout(),
  });
  (debug as { __bands?: () => unknown }).__bands = () => {
    const abroad = roaming.abroad();
    return {
      abroad: abroad.length,
      near: bandsNear(abroad, player.x, player.z, state.day).map((b) => ({
        id: b.id, kind: b.kind, left: roaming.alive(b).length, standing: entities.packSizeOf(b.id),
        at: bandAt(b, state.day),
      })),
      pressing: roaming.pressings(structures.villages, state.day).map((p) => `${p.village}: ${p.said}`),
    };
  };
  (debug as { __nettle?: () => unknown }).__nettle = () => {
    const him = nettleAbout();
    return {
      where: nemesis.whereabouts,
      scheme: nemesis.scheme,
      standing: him ? { x: Math.round(him.x), z: Math.round(him.z), hp: him.hp } : null,
      sent: sentOut().filter((e) => !e.dead).map((e) => `${e.kind.id} hp${e.hp}`),
    };
  };
  (debug as { __enterMine?: (village: string) => unknown }).__enterMine = (village) => {
    const cave = claimed.get(village);
    if (!cave) return null;
    places.enterDungeon(cave, 'cave', mineIdOf(cave));
    return { mine: cave.name, id: mineIdOf(cave) };
  };
  /**
   * Walk straight into a castle by name, the way `__enterMine` walks into a mine.
   *
   * A castle is entered through its gatehouse, which means standing on one tile and pressing a
   * key, and that is a thing a person does easily and a headless probe does badly. Without this
   * there is no way to look at the inside of a castle from outside the browser at all — which is
   * how a floor's furniture went a week without anybody noticing you could walk through it.
   */
  (debug as { __enterCastle?: (name: string) => unknown }).__enterCastle = (name) => {
    const want = name.toLowerCase();
    const castle = structures.castles.find((c) => c.name.toLowerCase() === want);
    if (!castle) return null;
    // out at the gate, which is where anybody leaving a castle is put
    places.enterDungeon({ name: castle.name, x: castle.x, z: castle.z, out: [castle.gateX, castle.gateZ] },
      'castle', castle.id);
    return { castle: castle.name, id: castle.id };
  };
  /**
   * Get on a horse, or off one, without going to a stable and having a conversation about it.
   *
   * Mounting is only reachable through a stable's dialogue, which a person does in ten seconds and
   * a script cannot do at all — and a mounted hero is the case that made stepping over things
   * visible in the first place, so the played test has never once ridden. Buys a horse where the
   * hero is standing if he has none, which is the only part a stable was really for.
   *
   * Returns what he is on and how fast it goes, because "am I actually mounted" is the question a
   * test asks next and reading it off the screen is guesswork.
   */
  (debug as { __ride?: (on?: boolean) => unknown }).__ride = (on = true) => {
    if (!on) {
      mount.dismount(player, chunks);
      return { riding: mount.riding };
    }
    if (!mount.owned) mount.buy(player.x, player.z, chunks, overworldRenderer);
    else mount.restore(chunks, overworldRenderer);
    mount.mount(player);
    return { riding: mount.riding, breed: mount.breed.id, name: mount.name };
  };
  (debug as { __mines?: () => unknown }).__mines = () =>
    minesWorked().map((w) => ({
      inAMine: fightingInAMine(),
      village: w.village, mine: w.name, id: w.mine,
      crew: register.living(w.village).filter((p) => p.trade === 'miner').length,
      purse: Math.round(register.living(w.village).reduce((sum, p) => sum + p.purse, 0)),
      dread: Number((mines.at(w.mine)?.dread ?? 0).toFixed(3)),
      worked: Math.round(mines.at(w.mine)?.worked ?? 0),
      peril: Number(mines.perilOf(w.mine).toFixed(3)),
      said: mines.saidOf(w.mine),
    }));
  (debug as { __stables?: () => unknown }).__stables = () =>
    structures.villages.map((v) => {
      const stable = stableAt(v);
      return { village: v.name, houses: v.houses.length, stock: stable?.stock.map((b) => b.id) ?? null };
    });
  debug.__player = player;
  debug.__teleport = (x, z) => commandWorld.teleport(x, z);
  // the console's way in: `cmd('teleport 322 53')`, and `cmd('help')` for the rest
  (debug as { cmd?: (line: string) => unknown }).cmd = (line) => commands.run(line, 'console');
  // and the way in from outside the browser altogether: a line posted to the dev server arrives
  // here over Vite's own channel, so a terminal can drive a tab nobody is touching
  if (import.meta.hot) {
    import.meta.hot.on('ai-world:command', ({ line }: { line: string }) => {
      const result = commands.run(line, 'dev');
      // which world answered. A command goes to every tab the dev server is serving, and two
      // tabs are the ordinary case — one road world, one polygon world, both obediently
      // teleporting to the same coordinates, one of which is the middle of the sea.
      import.meta.hot?.send('ai-world:command-result', { line, result, seed, world });
      if (!result.ok) console.warn(`command: ${line} — ${result.error}`);
    });
  }
  /*
   * Frame a shot. No argument is as close as the camera goes, which is what it always did.
   *
   * A number as well, because the thing this is used for is looking at a room, and a room is not
   * fourteen units across. A castle's great hall is thirty tiles long and its plan is seventy-six,
   * so photographing either of them at the closest the wheel goes gives you a picture of a table.
   * The ceiling is lifted with it: indoors and underground the camera is deliberately shut in, and
   * a zoom set past that ceiling would be pulled straight back the next time anything touched it.
   */
  (debug as { __zoom?: (n?: number) => void }).__zoom = (n = 14) => {
    iso.limitZoom(Math.max(n, CAMERA.MAX_ZOOM));
    iso.zoom = n;
    iso.resize();
  };
  /**
   * What is standing on the floor of the castle the hero is in, and where its landmarks are.
   *
   * `__enterCastle` got a headless browser through the gate; this is the other half of the same
   * problem, which is knowing what you are looking at once you are inside. A castle floor is
   * seventy-six tiles square with twenty rooms on it, and finding the chapel by teleporting about
   * until a pew comes into shot is not a way to work.
   *
   * Landmarks are read off the furniture rather than off the plan on purpose. The generator knows
   * perfectly well which room it called a chapel, and that answer is worth nothing here: what a
   * picture has to show is a room a player would call a chapel, which means the room with the
   * altar in it. Where the two disagree it is the dressing that is wrong, and this is how you find
   * out.
   */
  (debug as { __floor?: () => unknown }).__floor = () => {
    const visit = places.underground;
    if (!visit) return null;
    const { map } = visit.world;
    const tally = new Map<string, number>();
    for (const f of map.furniture) {
      const name = nameOfProp(f.kind);
      tally.set(name, (tally.get(name) ?? 0) + 1);
    }
    const firstOf = (kind: PropKind): [number, number] | null => {
      const f = map.furniture.find((g) => g.kind === kind);
      return f ? [f.x, f.z] : null;
    };
    /** The middle of everything of one kind, which is where a wing of them reads from. */
    const heartOf = (of: (x: number, z: number, i: number) => boolean): [number, number] | null => {
      let n = 0, sx = 0, sz = 0;
      for (let i = 0; i < map.tiles.length; i++) {
        const x = i % map.size, z = (i - x) / map.size;
        if (!of(x, z, i)) continue;
        n++; sx += x; sz += z;
      }
      return n === 0 ? null : [Math.round(sx / n), Math.round(sz / n)];
    };
    const clustered = (kind: PropKind): [number, number] | null => {
      const of = map.furniture.filter((f) => f.kind === kind);
      if (of.length === 0) return null;
      // the one with the most of its own kind about it, so a crypt beats a stray coffin
      const near = (f: { x: number; z: number }) =>
        of.filter((g) => Math.abs(g.x - f.x) <= 6 && Math.abs(g.z - f.z) <= 6).length;
      const best = of.reduce((a, b) => (near(b) > near(a) ? b : a));
      return [best.x, best.z];
    };
    return {
      floor: map.floor,
      said: [...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' '),
      entrance: map.entrance,
      descent: map.descent,
      boss: map.boss,
      rooms: map.rooms.length,
      chests: map.chests,
      doors: map.doors,
      ghosts: map.monsterSpots.filter((s) => s[2]).length,
      landmarks: {
        arrival: map.entrance,
        throne: firstOf(PropKind.Throne),
        hall: clustered(PropKind.LongTable),
        chapel: clustered(PropKind.Altar),
        crypt: clustered(PropKind.Sarcophagus),
        cells: clustered(PropKind.Bars),
        cobwebs: clustered(PropKind.Cobweb),
        tower: firstOf(PropKind.TowerStair),
        barred: map.doors[0] ? [map.doors[0].x, map.doors[0].z] : null,
        undercroft: heartOf((_x, _z, i) => map.tiles[i] === DTile.Water),
        // a corridor is floor that belongs to no room, and the middle of all of it is the
        // crossing at the heart of the plan — which is the one picture that says whether a
        // gallery has been dressed as a gallery or as a room with the walls taken out
        walk: heartOf((x, z, i) => map.tiles[i] === DTile.Floor
          && !map.rooms.some((r) => x >= r.x && z >= r.z && x < r.x + r.w && z < r.z + r.h)),
        gallery: heartOf((x, z, i) => map.tiles[i] === DTile.Floor && levelAt(map, x, z) > BASE_LEVEL + 1),
      },
    };
  };
  (debug as { __quests?: () => unknown }).__quests = () => questList;
  (debug as { __markers?: () => unknown }).__markers = () => markers();
  (debug as { __finishQuest?: (id: string) => void }).__finishQuest = (id) => {
    const errand = questList.find((q) => q.id === id);
    if (!errand) return;
    state.quests.set(id, 'done');
    state.inventory.gold += errand.reward;
    state.version++;
    talkCtx.onQuestChange(errand, 'done');
  };
  (debug as { __enterInn?: () => string | null }).__enterInn = () => commandWorld.enterInn() as string | null;
  // the same door-finding as __enterInn, for any shop: the till is only reachable from inside,
  // so without this there is no way to drive a sale from a test
  (debug as { __enterShop?: (type?: string) => string | null }).__enterShop = (type = 'store') => {
    for (const village of structures.villages) {
      const shop = village.shops.find((s) => s.type === type);
      if (!shop) continue;
      const door = structures.doors.find((d) => d.bx === shop.house.tx && d.bz === shop.house.tz);
      if (!door) continue;
      places.enterBuilding(door);
      return `${village.name}: ${shop.type}`;
    }
    return null;
  };
  debug.__standAtCounter = () => { commandWorld.standAtCounter(); };
}
