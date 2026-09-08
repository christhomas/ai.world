import * as THREE from 'three';
import type { ChunkManager } from '../world/chunkManager';
import type { EntityManager } from '../entities/manager';
import type { Entity } from '../entities/entity';
import type { Player } from '../entities/player';
import { bodyMotion } from '../entities/motion';
import type { Register } from '../world/register';
import type { SkyIsland } from '../world/skyisland';
import type { Site, Structures } from '../world/structures';
import { StructureKind } from '../world/structures';
import type { TerrainSampler } from '../world/terrain';
import type { WorldKind } from '../save/store';
import type { Drift } from './wildlife';
import type { CommandBus } from '../core/commandbus';
import type { IsoCamera } from '../render/camera';
import type { SceneRig } from '../render/scene';
import { BUILD, stageAt, type Houses } from './building';
import type { CommandWorld } from './commands';
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
import { dialogueFor, type TalkCtx } from './talk';
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
  pods: readonly Pod[];
  mines: Mines;
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
  callOut: (to: string) => void;
  placeName: () => string;
  carcasses: () => unknown;
  markers: () => unknown;
  /** How the client's guess and the world's answer are getting on. */
  walking: { answers: number; corrections: number; worst: number };
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
    commandWorld, callOut, placeName, carcasses, markers, walking, drift, bites, heard, nettleAbout, sentOut,
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
  (debug as { __pods?: () => unknown }).__pods = () => pods;
  (debug as { __sailing?: unknown }).__sailing = sailing;
  (debug as { __whaleY?: () => number[] }).__whaleY = () => {
    const now = worldSeconds(state.day, state.time);
    return pods.flatMap((pod) => Array.from({ length: pod.size }, (_, i) => Math.round(whaleAt(pod, i, now).y * 100) / 100));
  };
  (debug as { __three?: unknown }).__three = THREE;
  (debug as { __online?: unknown }).__online = online;
  debug.__doors = structures.doors;
  (debug as { __villages?: unknown }).__villages = structures.villages;
  (debug as { __piers?: unknown }).__piers = structures.piers;
  (debug as { __descent?: () => unknown }).__descent = () => places.underground?.world.map.descent ?? null;
  (debug as { __boss?: () => unknown }).__boss = () => places.underground?.world.map.boss ?? null;
  (debug as { __descend?: () => void }).__descend = () => commandWorld.descend();
  (debug as { __climbOut?: () => void }).__climbOut = () => commandWorld.climbOut();
  (debug as { __plots?: () => unknown }).__plots = () => plots.count;
  (debug as { __houses?: () => unknown }).__houses = () => ({
    hired: houses.hired,
    jobs: houses.entries().map((job) => ({ ...job, stage: stageAt(job, state.day + state.time) })),
  });
  // put a finished house on the ground where you stand, for checking that a wall is a wall
  (debug as { __build?: (x: number, z: number) => unknown }).__build = (x, z) => {
    houses.takeOn('Crossroads Town', BUILD.PRICE, BUILD.PRICE);
    const job = houses.place(x, z, state.day - BUILD.DAYS - 1);
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
      furniture: room.world.map.furniture.map((f) => ({ kind: f.kind, x: f.x, z: f.z, rot: Math.round(f.rot * 100) / 100 })),
      solid: (x: number, z: number) => room.world.blocked(x, z),
    };
  };
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
  (debug as { __entitiesFull?: () => unknown }).__entitiesFull = () =>
    entities.within(player.x, player.z, 90).map((e) => ({ kind: e.kind.id, name: e.name, role: e.role, x: e.x, z: e.z }));
  (debug as { __entities?: () => unknown }).__entities = () => commandWorld.entities();
  (debug as { __thin?: (village: string, n: number) => unknown }).__thin = (village, n) => commandWorld.thin(village, n);
  (debug as { __callOut?: (id: string) => void }).__callOut = (id) => callOut(id);
  (debug as { __hire?: (n: number) => unknown }).__hire = (n) => commandWorld.hire(n);
  (debug as { __spawn?: (kind: string, away?: number) => unknown }).__spawn = (kind, away = 2) => commandWorld.spawn(kind, away);
  (debug as { __blow?: () => unknown }).__blow = () => ({
    hero: { blow: player.entity.blow, strike: Math.round(player.entity.strike * 100) / 100 },
    others: entities.within(player.x, player.z, 30)
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
  (debug as { __fortunes?: () => unknown }).__fortunes = () =>
    structures.villages.map((v) => ({ village: v.name, living: register.living(v.name).length, fortune: register.fortune(v.name) }));
  (debug as { __enterMine?: (village: string) => unknown }).__enterMine = (village) => {
    const cave = claimed.get(village);
    if (!cave) return null;
    places.enterDungeon(cave, 'cave', mineIdOf(cave));
    return { mine: cave.name, id: mineIdOf(cave) };
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
  (debug as { __pass?: (days: number) => unknown }).__pass = (days) => {
    state.day += Math.max(1, Math.floor(days));
    const changes = register.advance(state.day);
    return changes.map((c) => `day ${c.day}: ${c.name} ${c.kind}${c.cause ? ` (${c.cause})` : ''} in ${c.village}`);
  };
  (debug as { __talkTo?: (name: string) => unknown }).__talkTo = (name) => {
    const who = entities.within(player.x, player.z, 120).find((e) => e.name === name);
    if (!who) return null;
    talkCtx.day = state.day;
    const node = dialogueFor(who, talkCtx);
    return { speaker: node.speaker, pages: node.pages, choices: (node.choices ?? []).map((c) => c.label) };
  };
  (debug as { __register?: (village?: string) => unknown }).__register = (village) => {
    const here = village ?? structures.villages
      .map((v) => ({ v, d: Math.hypot(v.x - player.x, v.z - player.z) }))
      .sort((a, b) => a.d - b.d)[0]?.v.name ?? '';
    return {
      village: here, day: register.today,
      people: register.living(here).map((p) => ({
        name: p.name, trade: p.trade, born: p.born, lives: p.lives,
        mother: p.mother, father: p.father, knows: p.knows.length, memories: p.memories,
      })),
    };
  };
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
  (debug as { __zoom?: () => void }).__zoom = () => { iso.zoom = 14; iso.resize(); };
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
