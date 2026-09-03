import { GRAPH } from './core/config';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { randomSeed } from './core/rng';
import { createSceneRig } from './render/scene';
import { IsoCamera } from './render/camera';
import { PropLibrary } from './render/props';
import { ChunkManager } from './world/chunkManager';
import { generateRoadGraph } from './world/graph';
import { TerrainSampler } from './world/terrain';
import { BIOMES, HUB_NAME, SEA_NAME } from './world/biomes';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { IndexedDbStore, SESSION_KEY, type SessionSave } from './save/store';
import { villageAt } from './world/structures';
import { DialogueBox } from './ui/dialogue';
import { Inventory } from './game/shops';
import { dialogueFor } from './game/talk';
import { yawFor, type Entity } from './entities/entity';
import { EntityRenderer } from './entities/pool';
import { EntityManager } from './entities/manager';
import { Player } from './entities/player';
import { mulberry32 } from './core/rng';
import * as THREE from 'three';

async function boot(): Promise<void> {
  const store = new IndexedDbStore();
  const saved = await store.load<SessionSave>(SESSION_KEY);

  const url = new URL(window.location.href);
  const urlSeed = url.searchParams.get('seed');
  const seed = urlSeed !== null && /^\d+$/.test(urlSeed) ? Number(urlSeed) >>> 0 : saved?.seed ?? randomSeed();
  if (urlSeed !== String(seed)) {
    url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
  }

  const container = document.getElementById('gameContainer')!;
  const rig = createSceneRig(container);
  const iso = new IsoCamera();
  const input = new Input(rig.renderer.domElement);
  const props = new PropLibrary();
  const chunks = new ChunkManager(rig.scene, seed, props, rig.water.material);
  const graph = generateRoadGraph(seed);
  const sampler = new TerrainSampler(graph);
  const hud = new Hud(rig, seed);
  const minimap = new Minimap(document.getElementById('minimapCanvas') as HTMLCanvasElement, graph);
  const entityRenderer = new EntityRenderer(rig.scene);
  const structures = sampler.structures;
  const entities = new EntityManager(entityRenderer, chunks, chunks, seed, structures.villages);
  const discovered = new Set<string>(saved?.seed === seed ? saved.discovered ?? [] : []);
  const inventory = Inventory.from(saved?.seed === seed ? saved.inventory : undefined);
  hud.setInventory(inventory);
  const dialogue = new DialogueBox();
  const markers = () => [
    ...structures.villages.map((v) => ({ x: v.x, z: v.z, color: '#ffffff' })),
    ...structures.pois.filter((p) => discovered.has(p.name)).map((p) => ({ x: p.x, z: p.z, color: '#f1c40f' })),
  ];
  const lineRng = mulberry32(seed ^ 0x1eaf);

  let startX = 0, startZ = 0;
  if (saved && saved.seed === seed) {
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

  input.onKey('o', () => hud.toggleOptions());
  input.onKey('f', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  input.onKey('m', () => minimap.toggle());
  input.onKey('escape', () => { hud.closeOptions(); dialogue.close(); });

  const talkCtx = { inventory, rng: lineRng, onInventoryChange: () => { hud.setInventory(inventory); persist(); } };
  const startTalk = (e: Entity) => {
    e.yaw = yawFor(player.x - e.x, player.z - e.z);
    e.state = 'idle';
    e.timer = 1e9;
    dialogue.start(dialogueFor(e, talkCtx), () => { e.timer = 1; });
  };
  const talkNearest = () => {
    const e = entities.nearest(player.x, player.z, 2.8);
    if (e) startTalk(e); else hud.flash('No one close enough to talk to');
  };
  for (const key of ['enter', ' ']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.advance(); else talkNearest(); });
  for (const key of ['arrowup', 'w']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(-1); });
  for (const key of ['arrowdown', 's']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(1); });
  input.onKey('n', () => {
    const next = randomSeed();
    url.searchParams.set('seed', String(next));
    void store.save<SessionSave>(SESSION_KEY, { seed: next, cam: { x: 0, z: 0, rot: Math.PI / 4, zoom: iso.zoom } })
      .then(() => { window.location.href = url.toString(); });
  });

  window.addEventListener('resize', () => { rig.resize(); iso.resize(); });

  let saveTimer = 0;
  const persist = () => {
    void store.save<SessionSave>(SESSION_KEY, {
      seed,
      cam: { x: iso.target.x, z: iso.target.z, rot: iso.rotation, zoom: iso.zoom },
      player: { x: player.x, z: player.z },
      discovered: [...discovered],
      inventory: inventory.toJSON(),
    });
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  let frames = 0, fpsAccum = 0, fps = 0;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const loop = new GameLoop((dt, time) => {
    iso.update(input, dt, player.mode === 'free' && !dialogue.isOpen);
    player.update(input, iso, dt, dialogue.isOpen);
    dialogue.update(dt);
    rig.water.update(time);
    const { x, z } = iso.target;
    chunks.update(x, z);
    rig.follow(x, z, iso.zoom);
    entities.update(dt, player.x, player.z);
    entityRenderer.update();

    if (input.clicked && !dialogue.isOpen) {
      mouse.set((input.clickX / window.innerWidth) * 2 - 1, -(input.clickY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(mouse, iso.camera);
      const e = entities.pick(raycaster);
      if (e) {
        if (Math.hypot(e.x - player.x, e.z - player.z) < 4.5) startTalk(e);
        else hud.flash(`${e.name} the ${e.kind.label} is too far away`);
      }
    }

    // area banner: POI > village > biome; discovering a POI flashes a toast
    let area: string | null = null;
    for (const poi of structures.pois) {
      if (Math.hypot(poi.x - player.x, poi.z - player.z) < 7) {
        area = poi.name;
        if (!discovered.has(poi.name)) { discovered.add(poi.name); hud.flash(`Discovered: ${poi.name}`); persist(); }
        break;
      }
    }
    if (!area) {
      const v = villageAt(structures.villages, player.x, player.z);
      if (v) area = v.name;
    }
    if (!area) {
      const p = sampler.probe(x, z);
      area = p.hub ? HUB_NAME : p.land ? BIOMES[p.biome].name : SEA_NAME;
    }
    hud.setArea(area);
    hud.tick(dt);

    frames++; fpsAccum += dt;
    if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
    hud.setDebug(dt, () =>
      `${fps.toFixed(0)} fps  chunks ${chunks.stats.drawn}/${chunks.stats.loaded}  queue ${chunks.stats.pending}\n` +
      `draws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k  creatures ${entities.count}\n` +
      `roads ${graph.edges.length}  radius ${GRAPH.RADIUS}  pos ${x.toFixed(0)},${z.toFixed(0)}`);

    minimap.draw(x, z, iso.zoom, window.innerWidth / window.innerHeight, iso.rotation, markers(), player.x, player.z);
    rig.renderer.render(rig.scene, iso.camera);
    input.endFrame();

    saveTimer += dt;
    if (saveTimer > 3) { saveTimer = 0; persist(); }
  });
  loop.start();
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
