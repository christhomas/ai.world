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
import { generateDungeon } from './dungeon/generate';
import { DungeonWorld } from './dungeon/world';
import { DungeonScene } from './dungeon/scene';
import { StructureKind, type Poi } from './world/structures';
import { ITEMS } from './game/shops';
import { TerrainSampler } from './world/terrain';
import { BIOMES, HUB_NAME, SEA_NAME } from './world/biomes';
import { villageAt } from './world/structures';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { DialogueBox } from './ui/dialogue';
import { LEGACY_KEY, showTitle } from './ui/title';
import { IndexedDbStore, type SaveStore, type SessionSave } from './save/store';
import { GameState } from './game/state';
import { dialogueFor } from './game/talk';
import { generateQuests } from './game/quests';
import { Sound } from './game/audio';
import { yawFor, type Entity } from './entities/entity';
import { EntityRenderer } from './entities/pool';
import { EntityManager } from './entities/manager';
import { Player } from './entities/player';
import { $ } from './ui/dom';
import { SALT, derive } from './core/salts';


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
  const minimap = new Minimap($('minimapCanvas') as HTMLCanvasElement, graph);
  const entityRenderer = new EntityRenderer(rig.scene);
  const entities = new EntityManager(entityRenderer, chunks, chunks, seed, structures.villages);
  const dialogue = new DialogueBox();
  const sound = new Sound();
  const lineRng = mulberry32(derive(seed, SALT.DIALOGUE));

  // --- state ---
  const state = GameState.from(saved?.state ?? (saved ? { discovered: saved.discovered, inventory: saved.inventory } : undefined));
  const discovered = state.discovered;
  const urlTime = url.searchParams.get('t');
  if (urlTime !== null) state.time = Math.max(0, Math.min(0.999, Number(urlTime) || 0));
  minimap.reveal(state.explored);
  const questList = generateQuests(structures, seed);
  const quests = new Map(questList.map((q) => [q.village, q]));

  // --- ferries ---
  const ferries = makeFerryLines(structures, structures.villages).map((line) => {
    const mesh = buildBoat();
    rig.scene.add(mesh);
    return { line, mesh };
  });
  let riding: { line: FerryLine; dest: 'from' | 'to' } | null = null;
  // --- dungeons ---
  interface DungeonVisit { world: DungeonWorld; scene: DungeonScene; renderer: EntityRenderer; poi: Poi }
  let dungeon: DungeonVisit | null = null;
  const enterDungeon = (poi: Poi) => {
    const anchor = manifest.ensure(`dungeon:${poi.name}`, 'dungeon', poi.x, poi.z);
    const world = new DungeonWorld(generateDungeon(anchor.seed), anchor.id);
    const scene = new DungeonScene(world, props, rig.water.material, anchor.seed, state.opened);
    const renderer = new EntityRenderer(scene.scene);
    entityRenderer.remove(player.entity);
    renderer.add(player.entity);
    player.setWorld(world);
    const [ex, ez] = world.map.entrance;
    player.teleport(ex + 1.5, ez + 0.5);
    iso.target.set(ex + 1.5, 0.5, ez + 0.5);
    dungeon = { world, scene, renderer, poi };
    sound.cave = true;
    hud.flash(`You descend into the ${poi.name}`);
    persist();
  };
  const exitDungeon = () => {
    if (!dungeon) return;
    const { poi, scene, renderer } = dungeon;
    renderer.remove(player.entity);
    renderer.dispose();
    scene.dispose();
    entityRenderer.add(player.entity);
    player.setWorld(chunks);
    player.teleport(poi.x + 2.5, poi.z + 0.5);
    iso.target.set(poi.x + 2.5, 0.5, poi.z + 0.5);
    dungeon = null;
    sound.cave = false;
    persist();
  };
  /** Chest loot: gold always, a useful item from the big chest. */
  const openChest = (visit: DungeonVisit, index: number) => {
    const chest = visit.world.map.chests[index];
    const id = visit.world.chestId(index);
    const roll = mulberry32(derive(manifest.get(visit.world.anchorId)!.seed, index + 1));
    const gold = chest.big ? 80 + Math.floor(roll() * 70) : 12 + Math.floor(roll() * 30);
    state.inventory.gold += gold;
    let extra = '';
    if (chest.big) {
      const prizes = ['potion', 'sword', 'shield', 'helm', 'lantern', 'rope', 'map'].filter((p) => !state.has(p) || p === 'potion');
      const prize = prizes[Math.floor(roll() * prizes.length)];
      state.inventory.items.set(prize, state.count(prize) + 1);
      extra = ` and ${ITEMS[prize].emoji} ${ITEMS[prize].name}`;
    }
    state.opened.add(id);
    state.version++;
    visit.scene.rebuildProps(state.opened);
    sound.chime();
    hud.flash(`Found ${gold} gold${extra}!`);
    persist();
  };
  /** Enter/Space inside a dungeon: chests and the way out. */
  const dungeonInteract = (visit: DungeonVisit): boolean => {
    const chest = visit.world.chestNear(player.x, player.z, 1.8, state.opened);
    if (chest >= 0) { openChest(visit, chest); return true; }
    if (visit.world.nearStairs(player.x, player.z, 1.8)) {
      dialogue.start({ speaker: 'Stairs', emoji: '🪜', pages: ['Climb back up to the daylight?'], choices: [
        { label: 'Climb out', next: () => { exitDungeon(); return null; } },
        { label: 'Stay', next: () => null },
      ] });
      return true;
    }
    return false;
  };
  /** Enter/Space at a shrine in the overworld offers the way down. */
  const tryShrine = (): boolean => {
    for (const poi of structures.pois) {
      if (poi.kind !== StructureKind.Shrine || Math.hypot(poi.x - player.x, poi.z - player.z) > 3) continue;
      dialogue.start({ speaker: poi.name, emoji: '⛩️', pages: ['Worn steps lead down beneath the stones. Descend?'], choices: [
        { label: 'Descend', next: () => { enterDungeon(poi); return null; } },
        { label: 'Not now', next: () => null },
      ] });
      return true;
    }
    return false;
  };

  const dockTile = (line: FerryLine, end: 'from' | 'to'): [number, number] => {
    const pier = end === 'from' ? line.fromPier : line.toPier;
    const [x, z] = pier.tiles[pier.tiles.length - 1];
    return [x + 0.5, z + 0.5];
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
  chunks.onFirstChunk = () => hud.hideLoading();

  const persist = () => {
    void store.save<SessionSave>(slotKey, {
      seed,
      cam: { x: iso.target.x, z: iso.target.z, rot: iso.rotation, zoom: iso.zoom },
      player: { x: player.x, z: player.z },
      state: state.toJSON(),
      manifest: manifest.toJSON(),
    });
  };
  const toTitle = () => { persist(); window.setTimeout(() => { window.location.href = window.location.pathname; }, 150); };

  // --- HUD / sound hooks ---
  hud.setVolume(sound.volume);
  hud.onVolumeChange = (v) => sound.setVolume(v);
  hud.onReturnToTitle = toTitle;
  hud.onUseItem = (id) => {
    const msg = state.use(id);
    if (msg) { hud.flash(msg); sound.select(); persist(); }
  };
  dialogue.onType = () => sound.blip();
  dialogue.onMove = () => sound.select();

  // --- talking ---
  const talkCtx = {
    state, rng: lineRng, quests,
    onInventoryChange: () => { sound.chime(); persist(); },
    onQuestChange: (q: { village: string }, status: 'active' | 'done') => {
      if (status === 'done') { sound.fanfare(); hud.flash(`Quest complete for ${q.village}!`); } else sound.select();
      persist();
    },
  };
  const startTalk = (e: Entity) => {
    e.yaw = yawFor(player.x - e.x, player.z - e.z);
    e.state = 'idle';
    e.timer = 1e9;
    dialogue.start(dialogueFor(e, talkCtx), () => { e.timer = 1; });
  };
  /** Board a docked ferry, or read the timetable at a pier. Returns false if no ferry is nearby. */
  const tryFerry = (): boolean => {
    const now = worldSeconds(state.day, state.time);
    for (const { line } of ferries) {
      const st = ferryStateAt(line, now);
      const nearBoat = Math.hypot(st.x - player.x, st.z - player.z) < FERRY.BOARD_RANGE;
      const nearFrom = Math.hypot(line.fromPier.dockX + 0.5 - player.x, line.fromPier.dockZ + 0.5 - player.z) < FERRY.BOARD_RANGE + 1;
      const nearTo = Math.hypot(line.toPier.dockX + 0.5 - player.x, line.toPier.dockZ + 0.5 - player.z) < FERRY.BOARD_RANGE + 1;
      if (st.docked && nearBoat) {
        const dest = st.docked === 'from' ? 'to' : 'from';
        const destName = dest === 'to' ? line.toName : line.fromName;
        dialogue.start({
          speaker: 'Ferryman', emoji: '⛵',
          pages: [`Ferry to ${destName}. We cast off in ${formatCountdown(st.departsIn)}. Coming aboard?`],
          choices: [
            { label: 'Board', next: () => { riding = { line, dest }; player.riding = true; sound.chime(); return null; } },
            { label: 'Not now', next: () => null },
          ],
        });
        return true;
      }
      if (nearFrom || nearTo) {
        const here = nearFrom ? 'from' : 'to';
        const destName = here === 'from' ? line.toName : line.fromName;
        dialogue.start({ speaker: 'Timetable', emoji: '🪧', pages: [`Ferry to ${destName}: next boat in ${formatCountdown(st.arrivesIn[here])}.`] });
        return true;
      }
    }
    return false;
  };
  const talkNearest = () => {
    if (dungeon) { if (!dungeonInteract(dungeon)) hud.flash('Nothing here'); return; }
    if (tryShrine()) return;
    if (tryFerry()) return;
    const e = entities.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
    if (e) startTalk(e); else hud.flash('No one close enough to talk to');
  };

  // --- keys ---
  input.onKey('o', () => hud.toggleOptions());
  input.onKey('f', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  input.onKey('m', () => minimap.toggle());
  input.onKey('n', toTitle);
  input.onKey('escape', () => { hud.closeOptions(); dialogue.close(); });
  for (const key of ['enter', ' ']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.advance(); else talkNearest(); });
  for (const key of ['arrowup', 'w']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(-1); });
  for (const key of ['arrowdown', 's']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(1); });
  window.addEventListener('resize', () => { rig.resize(); iso.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  const onAttack = (attacker: Entity, dmg: number) => {
    if (dialogue.isOpen) return;
    hud.hurt();
    sound.thud();
    if (!state.damage(dmg)) return;
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

  const markers = () => [
    ...structures.villages.map((v) => ({ x: v.x, z: v.z, color: '#ffffff' })),
    ...structures.pois.filter((p) => discovered.has(p.name)).map((p) => ({ x: p.x, z: p.z, color: '#f1c40f' })),
  ];

  /** POI > village > biome; discovering a POI flashes a toast. */
  const areaName = (): string => {
    for (const poi of structures.pois) {
      if (Math.hypot(poi.x - player.x, poi.z - player.z) >= GAMEPLAY.POI_DISCOVER_RADIUS) continue;
      if (!discovered.has(poi.name)) {
        discovered.add(poi.name); state.version++;
        hud.flash(`Discovered: ${poi.name}`); sound.jingle(); persist();
      }
      return poi.name;
    }
    const v = villageAt(structures.villages, player.x, player.z);
    if (v) return v.name;
    const p = sampler.probe(iso.target.x, iso.target.z);
    return p.hub ? HUB_NAME : p.land ? BIOMES[p.biome].name : SEA_NAME;
  };

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let frames = 0, fpsAccum = 0, fps = 0, saveTimer = 0;

  const loop = new GameLoop((dt, time) => {
    const talking = dialogue.isOpen;
    iso.update(input, dt, player.mode === 'free' && !talking);
    player.climb = state.climb;
    player.update(input, iso, dt, talking);
    dialogue.update(dt);
    rig.water.update(time);
    if (!talking) state.tick(dt);

    if (dungeon) {
      // underground: only the hero, the lights and the HUD tick
      dungeon.scene.heroLight.position.set(player.x, player.y + 1.5, player.z);
      dungeon.scene.heroLight.intensity = state.has('lantern') ? 9 : 3;
      dungeon.renderer.update();
      hud.syncState(state);
      hud.setClock(state.clock());
      hud.setQuests(questList, state);
      hud.setArea(`${dungeon.poi.name} Depths`);
      hud.tick(dt);
      sound.update(dt, player.entity.walk > 0.3 && !talking, true);
      rig.renderer.render(dungeon.scene.scene, iso.camera);
      input.endFrame();
      saveTimer += dt;
      if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
      return;
    }

    // ferries follow the clock; the hero rides along and steps off when the boat ties up
    const now = worldSeconds(state.day, state.time);
    for (const { line, mesh } of ferries) {
      const st = ferryStateAt(line, now);
      mesh.position.x = st.x; mesh.position.z = st.z;
      mesh.position.y = WORLD.WATER_Y - 0.12 + Math.sin(time * 1.3 + st.x) * 0.03;
      mesh.rotation.y = st.yaw;
      if (riding && riding.line === line) {
        player.entity.x = st.x + 0.2; player.entity.z = st.z; player.entity.y = WORLD.WATER_Y + FERRY.DECK_HEIGHT;
        player.entity.yaw = st.yaw;
        if (st.docked === riding.dest) {
          const [dx, dz] = dockTile(line, riding.dest);
          riding = null;
          player.riding = false;
          player.teleport(dx, dz);
          hud.flash(`Arrived at ${st.docked === 'to' ? line.toName : line.fromName}`);
          sound.jingle();
          persist();
        }
      }
    }
    const { x, z } = iso.target;
    chunks.update(x, z);
    rig.follow(x, z, iso.zoom);
    daycycle.apply({ time: state.time, focusX: x, focusZ: z, heroX: player.x, heroY: player.y, heroZ: player.z, lanternOn: state.has('lantern') });
    entities.update(dt, player.x, player.z, state.armed, onAttack);
    entityRenderer.update();

    if (state.markExplored(Math.floor(player.x / WORLD.CHUNK_SIZE), Math.floor(player.z / WORLD.CHUNK_SIZE))) minimap.reveal(state.explored);
    hud.syncState(state);
    hud.setClock(state.clock());
    hud.setQuests(questList, state);
    hud.setArea(areaName());
    hud.tick(dt);
    sound.setScene(sampler.probe(player.x, player.z).biome, state.night);
    sound.update(dt, player.entity.walk > 0.3 && !talking, chunks.isRoad(player.x, player.z));

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

    minimap.draw(x, z, iso.zoom, window.innerWidth / window.innerHeight, iso.rotation, markers(), player.x, player.z, !state.has('map'));
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
