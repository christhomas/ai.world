import * as THREE from 'three';
import { GAMEPLAY, GRAPH, WORLD } from './core/config';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { mulberry32 } from './core/rng';
import { createSceneRig } from './render/scene';
import { IsoCamera } from './render/camera';
import { PropLibrary } from './render/props';
import { DayCycle } from './render/daycycle';
import { ChunkManager } from './world/chunkManager';
import { attachIslands, generateRoadGraph, planIslands } from './world/graph';
import { Manifest } from './world/manifest';
import { FERRY, ferryStateAt, formatCountdown, makeFerryLines, worldSeconds, type FerryLine } from './game/ferry';
import { buildBoat } from './render/boat';
import { StructureKind, compassDir } from './world/structures';
import { ITEMS } from './game/shops';
import { COMBAT, swing } from './game/combat';
import { createInteractions } from './game/interact';
import { createMultiplayer } from './game/multiplayer';
import { createReadouts } from './ui/readouts';
import { PING_LIFE } from '../server/protocol';
import { Places, REACH } from './game/places';
import { SEASON_NAMES, Season, isWet, seasonAffects, seasonOf, seasonTint } from './game/seasons';
import { Weather } from './render/weather';
import { SeasonTintMaterials } from './render/seasontint';
import { FISHING, Fishing } from './game/fishing';
import { Journal } from './ui/journal';
import { Clock } from './ui/clock';
import { Compass, type CompassTarget } from './ui/compass';
import { PhotoMode } from './ui/photo';
import { HORSE, Mount } from './game/mount';
import { Online, tradableItems, type TradeOffer, type WorldDelta } from './game/online';
import { Chat } from './ui/chat';
import { CROPS, Plots, SEED_TO_CROP, canPlant, daysUntilSeason, isRipe, ripeness } from './game/farming';
import { CropField } from './render/crops';
import { BOAT, Sailing } from './game/sailing';
import { HeroGear } from './render/herogear';
import { Rucksack } from './ui/rucksack';
import { $ } from './ui/dom';
import { TerrainSampler } from './world/terrain';
import { BIOMES, HUB_NAME, SEA_NAME } from './world/biomes';
import { villageAt } from './world/structures';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { Fog, renderMapBase, type MapMarker } from './ui/mapbase';
import { WorldMap } from './ui/worldmap';
import { DialogueBox, type DialogueNode } from './ui/dialogue';
import { LEGACY_KEY, showTitle } from './ui/title';
import { IndexedDbStore, type SaveStore, type SessionSave } from './save/store';
import { GameState } from './game/state';
import { dialogueFor, type TalkCtx } from './game/talk';
import { generateQuests } from './game/quests';
import { Sound } from './game/audio';
import { damageEntity, yawFor, type Entity } from './entities/entity';
import { EntityRenderer } from './entities/pool';
import { EntityManager } from './entities/manager';
import { Player } from './entities/player';
import { SALT, derive } from './core/salts';


/** The world server's port, which `chore world` also uses. */
const WORLD_PORT = 8787;

/**
 * Where to look for a world server, in the order somebody would expect: the address in the link,
 * then the one they used last, then the machine that served the page. Nobody should have to type
 * an address to play with the person sitting next to them.
 */
function defaultServer(url: URL): string {
  const given = url.searchParams.get('server');
  if (given) return given;
  const remembered = localStorage.getItem('ai.world/server');
  if (remembered) return remembered;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.hostname || 'localhost'}:${WORLD_PORT}`;
}

async function boot(): Promise<void> {
  const store = new IndexedDbStore();
  const url = new URL(window.location.href);
  const urlSeed = url.searchParams.get('seed');

  let slotKey: string, saved: SessionSave | undefined, seed: number;
  if (urlSeed !== null && /^\d+$/.test(urlSeed)) {
    // share / dev link: play the given seed in a scratch session, skip the title screen
    seed = Number(urlSeed) >>> 0;
    slotKey = LEGACY_KEY;
    saved = await store.load<SessionSave>(LEGACY_KEY);
    if (saved?.seed !== seed) saved = undefined;
  } else {
    $('loading').style.display = 'none';
    const choice = await showTitle(store);
    slotKey = choice.key; saved = choice.save; seed = choice.seed;
    $('loading').style.display = 'block';
  }
  startGame(store, slotKey, saved, seed, url);
}

function startGame(store: SaveStore, slotKey: string, saved: SessionSave | undefined, seed: number, url: URL): void {
  const rig = createSceneRig($('gameContainer'));
  const iso = new IsoCamera();
  const input = new Input(rig.renderer.domElement);
  const props = new PropLibrary();
  const graph = generateRoadGraph(seed);
  const manifest = new Manifest(seed, saved?.manifest);
  if (manifest.byKind('island').length === 0) for (const p of planIslands(graph, seed)) manifest.ensure(p.id, 'island', p.x, p.z);
  attachIslands(graph, manifest.byKind('island'));
  const sampler = new TerrainSampler(graph);
  const structures = sampler.structures;
  const daycycle = new DayCycle(rig);
  rig.sunDriven = true;
  const chunks = new ChunkManager(rig.scene, sampler, props, rig.water.material, daycycle.glowMaterial);
  const hud = new Hud(rig, seed);
  hud.onLightChange = (sun, hemi) => daycycle.setDayIntensities(sun, hemi);
  const mapBase = renderMapBase(graph);
  const fog = new Fog(mapBase);
  const minimap = new Minimap($('minimapCanvas') as HTMLCanvasElement, mapBase, fog);
  const worldMap = new WorldMap(mapBase, fog);
  const entityRenderer = new EntityRenderer(rig.scene);
  const entities = new EntityManager(entityRenderer, chunks, chunks, seed, structures.villages);
  const dialogue = new DialogueBox();
  const sound = new Sound();
  const weather = new Weather(rig.scene);
  const seasonTintMaterials = new SeasonTintMaterials();
  const fishing = new Fishing();
  const journal = new Journal();
  const clock = new Clock();
  const compass = new Compass();
  const photo = new PhotoMode();
  const heroGear = new HeroGear(rig.scene);
  const castbar = $('castbar');
  chunks.useSeasonTint(seasonTintMaterials);
  const lineRng = mulberry32(derive(seed, SALT.DIALOGUE));
  const mount = Mount.from(saved?.state?.horse ?? null, lineRng);

  // --- other people ---
  const chat = new Chat();



  /** The world the hero is standing in: the surface, a dungeon floor, or a building. */
  const placeName = (): string => places.underground
    ? `${places.underground.poi.name}:${places.underground.floor}`
    : places.indoors ? places.indoors.title : 'surface';

  chat.onSend = (text) => {
    // a line beginning with a slash is a gesture, if it names one anybody knows
    const gesture = text.startsWith('/') ? text.slice(1).trim().toLowerCase() : '';
    if (gesture && online.emote(gesture)) return;
    online.say(text);
  };


  const plots = new Plots(saved?.state?.plots);
  const sailing = Sailing.from(saved?.state?.boat ?? null);
  const ownBoat = buildBoat();
  ownBoat.visible = false;
  rig.scene.add(ownBoat);
  const cropField = new CropField(rig.scene, props, daycycle.glowMaterial);

  // --- state ---
  const state = GameState.from(saved?.state ?? (saved ? { discovered: saved.discovered, inventory: saved.inventory } : undefined));
  const discovered = state.discovered;
  const urlTime = url.searchParams.get('t');
  if (urlTime !== null) state.time = Math.max(0, Math.min(0.999, Number(urlTime) || 0));
  fog.reveal(state.explored);
  const questList = generateQuests(structures, seed);
  /** One line describing what an errand asks for. */
  const questLine = (q: { kind: string; target: string; count: number }): string =>
    q.kind === 'visit' ? `find the ${q.target}` : `bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`;
  const quests = new Map(questList.map((q) => [q.village, q]));

  // --- ferries ---
  const ferries = makeFerryLines(structures, structures.villages, graph.islands).map((line) => {
    const mesh = buildBoat();
    rig.scene.add(mesh);
    return { line, mesh };
  });
  let riding: { line: FerryLine; dest: 'from' | 'to' } | null = null;
  // --- dungeons ---
  /** Name a place the first time the hero reaches it: toast, jingle, minimap mark. */
  const discover = (name: string): void => {
    if (discovered.has(name)) return;
    discovered.add(name);
    online.report({ kind: 'found', name });
    state.version++;
    hud.flash(`Discovered: ${name}`);
    sound.jingle();
    persist();
  };







  // --- hero + camera ---
  let startX = 0, startZ = 0;
  if (saved) {
    iso.rotation = saved.cam.rot;
    iso.zoom = saved.cam.zoom;
    iso.resize();
    if (saved.player) { startX = saved.player.x; startZ = saved.player.z; }
  }
  const px = url.searchParams.get('x'), pz = url.searchParams.get('z');
  if (px !== null && pz !== null) { startX = Number(px) || 0; startZ = Number(pz) || 0; }
  const player = new Player(chunks, entityRenderer, startX, startZ);
  iso.target.set(startX, 0, startZ);
  if (url.searchParams.get('cam') === 'free') player.mode = 'free';
  const places = new Places({
    seed, manifest, state, props, rig, iso, player,
    overworld: chunks, overworldRenderer: entityRenderer, heroGear,
    minimapCanvas: $('minimapCanvas') as HTMLCanvasElement,
    rng: lineRng,
    flash: (message) => hud.flash(message),
    chime: () => sound.chime(),
    setCaveAmbience: (on) => { sound.cave = on; },
    persist: () => persist(),
    report: (delta) => online.report(delta),
  });

  chunks.onFirstChunk = () => {
    hud.hideLoading();
    mount.restore(chunks, entityRenderer);
  };

  const persist = () => {
    void store.save<SessionSave>(slotKey, {
      seed,
      cam: { x: iso.target.x, z: iso.target.z, rot: iso.rotation, zoom: iso.zoom },
      player: { x: player.x, z: player.z },
      state: { ...state.toJSON(), horse: mount.toJSON(), plots: plots.toJSON(), boat: sailing.toJSON() },
      manifest: manifest.toJSON(),
    });
  };

  // the multiplayer half of the game, and the dialogue that answers an offer of goods, which the
  // interaction layer below owns and hands back once it exists
  let putOfferToPlayer: (offer: TradeOffer, fromName: string) => void = () => {};
  const multiplayer = createMultiplayer({
    player, state, places, plots, mount, sailing, entityRenderer, camera: iso.camera,
    dialogue, hud, chat, sound, questList, discovered, seed,
    placeName, persist, discover, showOffer: (offer, fromName) => putOfferToPlayer(offer, fromName),
  });
  const { online, market, party, duel, coop, others, handover, rally, playerList } = multiplayer;
  /**
   * Put the world away. The simulation is expensive — chunk workers, a webgl context, an audio
   * graph, a socket — and none of it should outlive the moment you leave for the title screen.
   */
  const shutDown = (): void => {
    loop.stop();
    input.dispose();
    online.disconnect();
    others.clear();
    sound.dispose();
    places.dispose();
    chunks.dispose();
    entityRenderer.dispose();
    heroGear.dispose();
    weather.dispose();
    cropField.dispose();
    props.dispose();
    rig.water.dispose();
    rig.renderer.dispose();
    rig.renderer.domElement.remove();
  };

  const toTitle = () => {
    persist();
    shutDown();
    // the page comes back to a clean title screen: nothing of this world is left running
    window.setTimeout(() => { window.location.href = window.location.pathname; }, 150);
  };

  /**
   * A hidden tab should cost nothing. The frame loop already stops when the browser stops asking
   * for frames, but the chunk workers and the audio graph do not, so they are stood down too.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { loop.stop(); chunks.pause(); sound.quiet(true); }
    else { chunks.resume(); sound.quiet(false); loop.start(); }
  });

  // --- HUD / sound hooks ---
  hud.setVolume(sound.volume);
  hud.onVolumeChange = (v) => sound.setVolume(v);
  hud.onReturnToTitle = toTitle;
  const rucksack = new Rucksack(state);
  rucksack.onChange = (message) => { hud.flash(message); sound.select(); persist(); };
  hud.onOpenRucksack = () => rucksack.toggle();
  dialogue.onType = () => sound.blip();
  dialogue.onMove = () => sound.select();

  // --- talking ---
  const talkCtx: TalkCtx = {
    state, rng: lineRng, quests, time: state.time,
    onInventoryChange: () => { sound.chime(); persist(); },
    onQuestChange: (q: { village: string; id?: string }, status: 'active' | 'done') => {
      if (status === 'done') {
        sound.fanfare();
        hud.flash(`Quest complete for ${q.village}!`);
        if (q.id) online.shareDeed(q.id);
      } else sound.select();
      persist();
    },
  };
  const startTalk = (e: Entity) => {
    talkCtx.time = state.time;
    // the post shelf only exists in a shared world, and only knows the names that world has seen
    talkCtx.post = online.connected ? {
      folk: online.folk,
      collect: () => online.fetchMail(),
      send: (to: string, itemId: string, gold: number) => {
        handover.offer(state, itemId, gold);
        online.postMail(to, gold, [[itemId, 1]]);
        persist();
      },
    } : undefined;
    e.yaw = yawFor(player.x - e.x, player.z - e.z);
    e.state = 'idle';
    e.timer = 1e9;
    dialogue.start(dialogueFor(e, talkCtx), () => { e.timer = 1; });
  };





  // --- keys ---
  const interactions = createInteractions({
    player, state, discovered,
    structures, sampler, chunks, manifest, entities, entityRenderer, places, seed,
    market, party, duel, mount, sailing, plots, fishing, online, handover, ferries, quests,
    dialogue, hud, chat, sound,
    raining: () => raining, discover, persist, startTalk, questLine,
  });
  const { atHand: talkNearest, offerTrade, partyMenu, noticeStall } = interactions;
  putOfferToPlayer = interactions.showOffer;

  input.onKey('k', () => { if (!dialogue.isOpen && !chat.isTyping) partyMenu(); });
  input.onKey('l', () => {
    if (dialogue.isOpen || chat.isTyping) return;
    if (!online.connected) { hud.flash('Join a world online to see who else is about.'); return; }
    playerList.toggle(multiplayer.playerListInput);
  });
  input.onKey('r', () => {
    if (dialogue.isOpen || chat.isTyping) return;
    if (!online.connected) { hud.flash('Join a world online to rally anybody.'); return; }
    online.ping(player.x, player.z);
    rally.push({ x: player.x, z: player.z, name: 'your', left: PING_LIFE });
    hud.flash(party.size ? 'Rally point marked for your party' : 'Rally point marked for everyone here');
  });
  input.onKey('o', () => hud.toggleOptions());
  input.onKey('f', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  const serverInput = $('serverInput') as HTMLInputElement;
  const nameInput = $('nameInput') as HTMLInputElement;
  const onlineStatus = $('onlineStatus');
  nameInput.value = localStorage.getItem('ai.world/name') ?? '';
  serverInput.value = defaultServer(url);
  $('connectButton').addEventListener('click', () => {
    if (online.connected) { online.disconnect(); others.clear(); chat.hide(); return; }
    const address = serverInput.value.trim();
    localStorage.setItem('ai.world/name', nameInput.value);
    localStorage.setItem('ai.world/server', address);
    online.connect(address, seed, nameInput.value || 'Traveller', { day: state.day, time: state.time });
    chat.show();
  });

  input.onKey('t', () => { if (online.connected && !dialogue.isOpen && !chat.isTyping) chat.open(); });
  input.onKey('g', () => { if (!dialogue.isOpen && !chat.isTyping) offerTrade(); });

  input.onKey('p', () => {
    const on = photo.toggle();
    player.mode = on ? 'free' : 'follow';
    if (!on) hud.flash('Photo mode off');
  });
  input.onKey('m', () => {
    worldMap.dungeon = places.underground?.map ?? null;
    worldMap.toggle(mapInput());
  });
  input.onKey('c', () => { if (worldMap.isOpen) worldMap.centre(player.x, player.z); });
  input.onKey('+', () => { if (worldMap.isOpen) worldMap.zoomBy(1.25); });
  input.onKey('=', () => { if (worldMap.isOpen) worldMap.zoomBy(1.25); });
  input.onKey('-', () => { if (worldMap.isOpen) worldMap.zoomBy(0.8); });
  let swingCooldown = 0;
  const attack = () => {
    if (dialogue.isOpen || swingCooldown > 0) return;
    swingCooldown = COMBAT.COOLDOWN;
    player.entity.attackCooldown = 0.45;
    const world = places.underground?.world ?? chunks;
    const manager = places.underground?.monsters ?? entities;
    if (duel.active) {
      const them = online.players.get(duel.opponent);
      if (them && duel.inReach(them, player.x, player.z, player.entity.yaw, COMBAT.ARC)) {
        duel.landed(state.attack);
        online.duelHit(state.attack);
        sound.thud();
        return;
      }
    }
    const res = swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, !coop.mirroring);
    for (const { index, damage } of res.reported) coop.reportHit(index, damage);
    if (res.hit.length === 0) { sound.select(); return; }
    sound.thud();
    if (res.killed.length > 0) {
      sound.chime();
      const names = res.killed.map((e: Entity) => e.kind.label).join(', ');
      const won = [res.gold > 0 ? `${res.gold} gold` : '', ...res.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
      hud.flash(won.length ? `Defeated ${names} (+${won.join(', ')})` : `Defeated ${names}`);
      persist();
    }
  };
  input.onKey('x', attack);
  input.onKey('n', toTitle);
  input.onKey('escape', () => { hud.closeOptions(); dialogue.close(); journal.close(); rucksack.close(); worldMap.close(); playerList.close(); });
  input.onKey('j', () => { if (!dialogue.isOpen) journal.toggle(journalInput); });
  input.onKey('i', () => { if (!dialogue.isOpen) rucksack.toggle(); });
  for (const key of ['enter', ' ']) input.onKey(key, () => {
    if (chat.isTyping) return;
    if (photo.active) {
      // draw one more frame so the buffer holds exactly what is on screen, then read it back
      rig.renderer.render(rig.scene, iso.camera);
      const name = photo.save(rig.renderer.domElement, seed);
      sound.chime();
      window.setTimeout(() => hud.flash(`Saved ${name}`), 50);
      return;
    }
    if (dialogue.isOpen) dialogue.advance(); else talkNearest();
  });
  for (const key of ['arrowup', 'w']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(-1); });
  for (const key of ['arrowdown', 's']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(1); });
  window.addEventListener('resize', () => { rig.resize(); iso.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  const onAttack = (attacker: Entity, dmg: number) => {
    if (dialogue.isOpen) return;
    hud.hurt();
    sound.thud();
    if (!state.damage(dmg)) return;
    if (places.underground) {
      // knocked out underground: dragged back to the surface, minus some gold
      const lostBelow = Math.min(GAMEPLAY.KO_GOLD_LOSS, state.inventory.gold);
      state.inventory.gold -= lostBelow;
      state.hp = state.maxHpTotal;
      state.version++;
      const name = places.underground.poi.name;
      places.exitDungeon();
      hud.flash(`${attacker.kind.label} got you. You crawl out of the ${name}${lostBelow ? `, ${lostBelow} gold lighter` : ''}.`);
      persist();
      return;
    }
    // knocked out: wake in the nearest town, lighter in the purse
    let home = structures.villages[0];
    for (const v of structures.villages) {
      if (Math.hypot(v.x - player.x, v.z - player.z) < Math.hypot(home.x - player.x, home.z - player.z)) home = v;
    }
    const lost = Math.min(GAMEPLAY.KO_GOLD_LOSS, state.inventory.gold);
    state.inventory.gold -= lost;
    state.hp = state.maxHpTotal;
    state.version++;
    player.teleport(home.x + 2, home.z + 2);
    hud.flash(`${attacker.kind.label} got you. You wake in ${home.name}${lost ? `, ${lost} gold lighter` : ''}.`);
    persist();
  };



  let areaLabel = 'The Crossroads';




  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let frames = 0, fpsAccum = 0, fps = 0, saveTimer = 0, weatherStrength = 0, raining = false;

  // debug handle so headless screenshots can jump the calendar
  // headless screenshot hooks; stripped from production builds
  if (import.meta.env.DEV) {
    const debug = window as unknown as {
      __state?: unknown; __doors?: unknown; __player?: unknown;
      __teleport?: (x: number, z: number) => void; __standAtCounter?: () => void;
    };
    debug.__state = state;
    (debug as { __scene?: unknown }).__scene = rig.scene;
    (debug as { __rig?: unknown }).__rig = rig;
    (debug as { __online?: unknown }).__online = online;
    debug.__doors = structures.doors;
    (debug as { __villages?: unknown }).__villages = structures.villages;
    (debug as { __piers?: unknown }).__piers = structures.piers;
    (debug as { __descent?: () => unknown }).__descent = () => places.underground?.world.map.descent ?? null;
    (debug as { __boss?: () => unknown }).__boss = () => places.underground?.world.map.boss ?? null;
    (debug as { __descend?: () => void }).__descend = () => places.descend();
    (debug as { __plots?: () => unknown }).__plots = () => plots.count;
    (debug as { __place?: () => string }).__place = () => placeName();
    (debug as { __coop?: () => unknown }).__coop = () => ({
      hosting: coop.hosting, mirroring: coop.mirroring, id: online.id,
      others: [...online.players.values()].map((p) => `${p.id}@${p.place}`),
    });
    (debug as { __stalls?: () => unknown }).__stalls = () => {
      const village = structures.villages
        .map((v) => ({ v, d: Math.hypot(v.x - player.x, v.z - player.z) }))
        .sort((a, b) => a.d - b.d)[0]?.v;
      return village ? { village: village.name, pitches: market.pitchesOf(village) } : null;
    };
    (debug as { __enterShrine?: () => void }).__enterShrine = () => {
      const shrine = structures.pois.find((p) => p.kind === StructureKind.Shrine);
      if (shrine) places.enterDungeon(shrine);
    };
    (debug as { __monsters?: () => unknown }).__monsters = () =>
      (places.underground?.monsters.roster ?? []).map((m) => ({
        i: m.rosterIndex, kind: m.kind.id,
        x: Math.round(m.x * 100) / 100, z: Math.round(m.z * 100) / 100, hp: m.hp,
      }));
    (debug as { __sow?: (x: number, z: number) => void }).__sow = (x, z) => {
      plots.plant(x, z, 'wheat', state.day);
      online.report({ kind: 'sow', tile: `${x},${z}`, crop: 'wheat', day: state.day });
      state.version++;
    };
    (debug as { __discover?: (n: string) => void }).__discover = (n) => discover(n);
    (debug as { __reportChest?: (id: string) => void }).__reportChest = (id) => { state.opened.add(id); online.report({ kind: 'chest', id }); state.version++; };
    (debug as { __shrines?: unknown }).__shrines = structures.pois.filter((p) => p.kind === StructureKind.Shrine).map((p) => ({ name: p.name, x: p.x, z: p.z }));
    (debug as { __entitiesFull?: () => unknown }).__entitiesFull = () =>
      entities.within(player.x, player.z, 90).map((e) => ({ kind: e.kind.id, name: e.name, role: e.role, x: e.x, z: e.z }));
    (debug as { __entities?: () => unknown }).__entities = () =>
      entities.within(player.x, player.z, 60).map((e) => ({ kind: e.kind.id, name: e.name, x: e.x, z: e.z }));
    debug.__player = player;
    debug.__teleport = (x, z) => { player.teleport(x, z); iso.target.set(x, 0.5, z); };
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
    (debug as { __enterInn?: () => string | null }).__enterInn = () => {
      for (const village of structures.villages) {
        const inn = village.shops.find((shop) => shop.type === 'inn');
        if (!inn) continue;
        const door = structures.doors.find((d) => d.bx === inn.house.tx && d.bz === inn.house.tz);
        if (!door) continue;
        places.enterBuilding(door);
        return village.name;
      }
      return null;
    };
    debug.__standAtCounter = () => {
      const spot = places.indoors?.world.map.keeper;
      if (spot) player.teleport(spot[0] + 0.5, spot[1] + 1.6);
    };
  }

  const { markers, mapInput, areaName, compassTargets, updateHud, journalInput } = createReadouts({
    player, state, structures, sampler, discovered, questList, ferries, sailing, places, rucksack,
    hud, clock, compass,
    companyMarkers: multiplayer.markers,
    fogged: () => !state.can('map'),
    cameraTarget: () => iso.target,
    discover,
  });

  const loop = new GameLoop((dt, time) => {
    // the full-screen map pauses the world the way a conversation does
    if (worldMap.isOpen) {
      const panX = (input.isDown('d', 'arrowright') ? 1 : 0) - (input.isDown('a', 'arrowleft') ? 1 : 0);
      const panZ = (input.isDown('s', 'arrowdown') ? 1 : 0) - (input.isDown('w', 'arrowup') ? 1 : 0);
      worldMap.pan(panX, panZ, dt);
      worldMap.draw(mapInput());
    }
    const talking = dialogue.isOpen || worldMap.isOpen;
    iso.update(input, dt, player.mode === 'free' && !talking && !places.indoors);
    player.climb = state.climb;
    player.speedScale = mount.riding ? HORSE.SPEED : 1;
    if (sailing.sailing && !talking) {
      sailing.update(dt, {
        forward: (input.isDown('w', 'arrowup') ? 1 : 0) - (input.isDown('s', 'arrowdown') ? 1 : 0),
        turn: (input.isDown('a', 'arrowleft') ? 1 : 0) - (input.isDown('d', 'arrowright') ? 1 : 0),
      }, chunks, player);
      iso.target.x += (sailing.x - iso.target.x) * Math.min(1, dt * 6);
      iso.target.z += (sailing.z - iso.target.z) * Math.min(1, dt * 6);
    }
    player.update(input, iso, dt, talking || sailing.sailing, places.indoors !== null);
    dialogue.update(dt);
    rig.water.update(time);
    if (!talking) state.tick(dt);

    // hold the place for this frame: a bite can end it half way through
    const indoors = places.indoors;
    if (indoors) {
      frames++; fpsAccum += dt;
      if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
      // indoors: a fixed view of the room, the hero and whoever keeps the place
      indoors.renderer.update();
      heroGear.update(state, player.entity);
      multiplayer.sync(dt, () => 0.5);
      updateHud(dt, indoors.title);
      sound.update(dt, player.entity.walk > 0.3 && !talking, true);
      hud.setDebug(dt, () => `${fps.toFixed(0)} fps  ${indoors.title}\ndraws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k\nEnter at the door to step outside`);
      rig.renderer.render(indoors.scene.scene, iso.camera);
      input.endFrame();
      saveTimer += dt;
      if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
      return;
    }

    const below = places.underground;
    if (below) {
      frames++; fpsAccum += dt;
      if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
      // underground: the hero, the monsters, the lights and the HUD tick
      below.scene.heroLight.position.set(player.x, player.y + 1.5, player.z);
      below.scene.heroLight.intensity = state.can('light') ? 9 : 3;
      // one player runs the monsters on a shared floor; everyone else mirrors what they are told
      coop.survey(online.id, placeName(), online.players.values());
      coop.age(dt);
      if (!coop.mirroring) below.monsters.update(dt, player.x, player.z, false, onAttack);
      coop.publish(dt, below.monsters);
      if (places.underground !== below) { input.endFrame(); return; }
      below.renderer.update();
      heroGear.update(state, player.entity);
      multiplayer.sync(dt, (x, z) => below.world.heightAt(x, z));
      below.map.reveal(player.x, player.z);
      below.map.draw(player.x, player.z, state.opened, (i) => below.world.chestId(i), below.world.unlocked);
      updateHud(dt, below.floor > 1 ? `${below.poi.name} Depths · floor ${below.floor}` : `${below.poi.name} Depths`);
      sound.update(dt, player.entity.walk > 0.3 && !talking, true);
      hud.setDebug(dt, () =>
        `${fps.toFixed(0)} fps  ${below.poi.name} depths, floor ${below.floor}\n` +
        `draws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k  monsters ${Math.max(0, below.monsters.count - 1)}\n` +
        `rooms ${below.world.map.rooms.length}  doors ${below.world.map.doors.length}  ${below.world.unlocked ? 'unlocked' : 'locked'}  pos ${player.x.toFixed(0)},${player.z.toFixed(0)}`);
      rig.renderer.render(below.scene.scene, iso.camera);
      input.endFrame();
      saveTimer += dt;
      if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
      return;
    }

    // ferries follow the clock; the hero rides along and steps off when the boat ties up
    interactions.sailFerries(worldSeconds(state.day, state.time), time);
    const { x, z } = iso.target;
    chunks.update(x, z);
    rig.follow(x, z, iso.zoom);
    // season and weather: both derived from the day counter and the biome underfoot
    const here = sampler.probe(player.x, player.z);
    const season = seasonOf(state.day);
    const tint = seasonTint(season);
    const wetHere = isWet(seed, state.day, here.biome) ? 1 : 0;
    weatherStrength += (wetHere - weatherStrength) * Math.min(1, dt * 0.4);
    raining = weatherStrength > 0.5;
    if (seasonAffects(here.biome)) seasonTintMaterials.set(tint.ground, tint.frost);
    else seasonTintMaterials.set([1, 1, 1], 0);
    weather.set(weatherStrength, season);
    weather.update(dt, x, z, iso.camera.position.y * 0.35);
    daycycle.apply({ time: state.time, focusX: x, focusZ: z, heroX: player.x, heroY: player.y, heroZ: player.z, lanternOn: state.can('light'), season: tint, wet: weatherStrength });
    entities.update(dt, player.x, player.z, state.armed, onAttack, state.time);
    mount.update(player, chunks);

    multiplayer.sync(dt, (x, z) => chunks.heightAt(x, z));
    noticeStall();
    ownBoat.visible = sailing.bought && places.outdoors;
    if (ownBoat.visible) {
      ownBoat.position.set(sailing.x, WORLD.WATER_Y - BOAT.DRAFT + Math.sin(time * 1.6 + sailing.x) * 0.03, sailing.z);
      ownBoat.rotation.y = sailing.yaw;
    }
    cropField.update(plots, state.day, player.x, player.z, (x, z) => chunks.heightAt(x, z));
    entityRenderer.update();
    heroGear.update(state, player.entity);

    if (state.markExplored(Math.floor(player.x / WORLD.CHUNK_SIZE), Math.floor(player.z / WORLD.CHUNK_SIZE))) fog.reveal(state.explored);
    areaLabel = areaName();
    updateHud(dt, areaLabel, weatherStrength > 0.4 ? (season === Season.Winter ? '❄' : '🌧') : '');
    if (fishing.active) {
      const ev = fishing.update(dt);
      if (ev === 'bite') sound.chime();
      if (ev === 'missed') hud.flash('It got away.');
      castbar.className = fishing.phase === 'bite' ? 'show bite' : fishing.phase === 'waiting' ? 'show' : '';
      castbar.textContent = fishing.phase === 'bite' ? 'A bite! Press Enter!' : raining ? 'Fishing in the rain… they are rising' : 'Fishing… wait for the bite';
    } else if (castbar.className !== '') {
      castbar.className = '';
    }
    journal.refresh(journalInput);
    hud.tick(dt);
    sound.setScene(here.biome, state.night);
    sound.update(dt, player.entity.walk > 0.3 && !talking, chunks.isRoad(player.x, player.z));

    swingCooldown = Math.max(0, swingCooldown - dt);
    if (input.clicked && !talking) {
      mouse.set((input.clickX / window.innerWidth) * 2 - 1, -(input.clickY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(mouse, iso.camera);
      const e = entities.pick(raycaster);
      if (e) {
        if (Math.hypot(e.x - player.x, e.z - player.z) < GAMEPLAY.CLICK_TALK_RANGE) startTalk(e);
        else hud.flash(`${e.name} the ${e.kind.label} is too far away`);
      }
    }

    frames++; fpsAccum += dt;
    if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
    hud.setDebug(dt, () =>
      `${fps.toFixed(0)} fps  chunks ${chunks.stats.drawn}/${chunks.stats.loaded}  queue ${chunks.stats.pending}\n` +
      `draws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k  creatures ${entities.count}\n` +
      `roads ${graph.edges.length}  radius ${GRAPH.RADIUS}  pos ${x.toFixed(0)},${z.toFixed(0)}`);

    minimap.draw(x, z, iso.zoom, window.innerWidth / window.innerHeight, iso.rotation, markers(), player.x, player.z, !state.can('map'));
    rig.renderer.render(rig.scene, iso.camera);
    input.endFrame();

    saveTimer += dt;
    if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
  });
  loop.start();
}

boot().catch((err) => {
  console.error(err);
  const el = $('loading');
  el.style.display = 'block';
  el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
