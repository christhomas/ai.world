import * as THREE from 'three';
import { GAMEPLAY, WORLD } from '../core/config';
import type { Input } from '../core/input';
import type { EntityManager } from '../entities/manager';
import type { Player } from '../entities/player';
import type { EntityRenderer } from '../entities/pool';
import { QUALITY, type SceneRig } from '../render/scene';
import { rememberAutoChoice, type AutoQuality } from '../render/autoquality';
import type { Beam } from '../render/beam';
import type { IsoCamera } from '../render/camera';
import type { CropField } from '../render/crops';
import type { DayCycle } from '../render/daycycle';
import type { HeroGear } from '../render/herogear';
import type { MountainMaterial } from '../render/mountains';
import type { PackField } from '../render/remains';
import type { SeasonTintMaterials } from '../render/seasontint';
import type { BuildingSite } from '../render/site';
import type { SkyIslands } from '../render/skyisland';
import type { Weather } from '../render/weather';
import type { ChunkManager } from '../world/chunkManager';
import type { RoadGraph } from '../world/graph';
import { chunkKey } from '../world/spatial';
import type { TerrainSampler } from '../world/terrain';
import type { Hud } from '../ui/hud';
import type { Minimap } from '../ui/minimap';
import type { WorldMap } from '../ui/worldmap';
import type { Sound } from './audio';
import { BREATH, type Breath } from './breath';
import { BUILD, stageAt, type Houses } from './building';
import type { Director } from './director';
import { listenForWater } from './earshot';
import type { Plots } from './farming';
import { worldSeconds } from './ferry';
import type { Fishing } from './fishing';
import { HIRE } from './hire';
import type { Magic } from './magic';
import type { Mount } from './mount';
import type { Online } from './online';
import type { Places } from './places';
import type { Remains } from './remains';
import { BOAT, type Sailing } from './sailing';
import { Season, isWet, seasonAffects, seasonOf, seasonTint } from './seasons';
import type { Skies } from './skies';
import type { Skyline } from './skyline';
import type { GameState } from './state';
import { goingOf, paceOf, type Going } from './stables';
import type { Walked } from './walked';
import type { Wildlife } from './wildlife';
import { haulPace } from './woodcraft';
import type { Entity } from '../entities/entity';

/** How far above his feet the hero's middle is, for the window the mountains keep open. */
const HERO_EYE = 1.2;

/**
 * How dark it has to get before the hero lights a torch.
 *
 * The same point at which the night light starts coming up at all, so the torch appears with the
 * light it is meant to be casting rather than a minute before or after it.
 */
const TORCH_OUT = 0.2;

/**
 * One frame of the game, in three shapes.
 *
 * A room, a mine and a hillside are three different games sharing a hero: indoors there is no
 * weather, no chunk streaming and no world walking anybody; underground there is a second set of
 * monsters and a map that fills in as you go; out of doors there is everything. What they share
 * is the head of this function — the camera, the breath, the hero's own step and the day turning
 * over — and each of the three ends by drawing its own scene and getting out.
 */
export interface Framing {
  seed: number;
  state: GameState;
  player: Player;
  iso: IsoCamera;
  rig: SceneRig;
  input: Input;
  graph: RoadGraph;
  chunks: ChunkManager;
  sampler: TerrainSampler;
  entities: EntityManager;
  entityRenderer: EntityRenderer;
  places: Places;
  skyline: Skyline;
  rock: MountainMaterial;
  daycycle: DayCycle;
  weather: Weather;
  /**
   * What a teleport looks like. Ticked below whatever else the frame is doing, because it is what
   * puts the hero's rig back together and a hero left half way through one would stay in pieces.
   */
  beam: Beam;
  seasonTintMaterials: SeasonTintMaterials;
  skyRenderer: SkyIslands;
  skies: Skies;
  wildlife: Wildlife;
  /** The world's creatures on whatever floor the hero is on, and nothing above ground. */
  floorLife: () => Wildlife | null;
  mount: Mount;
  sailing: Sailing;
  breath: Breath;
  magic: Magic;
  plots: Plots;
  houses: Houses;
  fishing: Fishing;
  heroGear: HeroGear;
  packField: PackField;
  /** Packs left where people fell, which age on the ground until nobody remembers them. */
  remains: Remains;
  cropField: CropField;
  buildingSite: BuildingSite;
  /** The hero's own boat, bobbing wherever he moored it. */
  ownBoat: THREE.Object3D;
  minimap: Minimap;
  worldMap: WorldMap;
  hud: Hud;
  sound: Sound;
  online: Online;
  autoQuality: AutoQuality;
  director: Director;
  walked: Walked;
  /** The fishing line's own strip of screen, which nothing else writes to. */
  castbar: HTMLElement;

  // the pieces of the game this drives, each of which owns its own state
  blows: { cooled: (dt: number) => void };
  tidings: { theDaysNews: () => void };
  watch: { watching: (now: number, dt: number) => void; hunted: (dt: number) => void };
  announceWindUps: (crowd: EntityManager) => void;
  onAttack: (attacker: Entity, damage: number) => void;
  sync: (dt: number, heightAt: (x: number, z: number) => number | null) => void;
  sailFerries: (clockNow: number, time: number) => void;
  ageCamps: (dt: number) => void;
  runClock: (dt: number) => void;
  carcasses: () => readonly { x: number; z: number }[];
  noticeStall: () => void;
  musterHires: () => void;
  startTalk: (e: Entity) => void;
  updateHud: (dt: number, area: string, weather?: string) => void;
  mapInput: () => Parameters<WorldMap['draw']>[0];
  markers: () => Parameters<Minimap['draw']>[3];
  /** Walking into a door goes in. Asked once a frame, out of doors, after the hero has moved. */
  doorsteps: { step: (hero: { x: number; z: number }, dt: number) => void };
  /** Fetch the ground this page has not got: from what it kept, or by asking the world for it. */
  streamCountry: () => void;
  /** Is a conversation up? It pauses the world the way the full-screen map does. */
  talking: () => boolean;
  /** A conversation types itself out a letter at a time, so it has a clock of its own. */
  tickDialogue: (dt: number) => void;
  /** Walking over ground nobody has seen rubs the fog off the map. */
  reveal: () => void;
  /** And the journal is redrawn from whatever the errands now say. */
  refreshJournal: () => void;
  areaName: () => string;
  arriving: () => void;
  /** Is the hero somewhere the world can see him and walk him itself? */
  outdoors: () => boolean;
  persist: () => void;
}

export function createFrame(ctx: Framing) {
  const {
    seed, state, player, iso, rig, input, graph, chunks, sampler, entities, entityRenderer, places,
    skyline, rock, daycycle, weather, beam, seasonTintMaterials, skyRenderer, skies, wildlife, floorLife,
    mount, sailing, breath, magic, plots, houses, fishing, heroGear, packField, cropField,
    buildingSite, ownBoat, minimap, worldMap, hud, sound, online, remains,
    autoQuality, director, walked, castbar, blows, tidings, watch, announceWindUps, onAttack, sync,
    sailFerries, ageCamps, runClock, carcasses, noticeStall, musterHires, startTalk, updateHud,
    mapInput, markers, doorsteps, streamCountry, areaName, arriving, outdoors, persist, talking: inTalk, tickDialogue,
    reveal, refreshJournal,
  } = ctx;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  /** Where the mountains are told the hero is: his feet plus enough to be his middle. */
  const heroSpot = new THREE.Vector3();
  let frames = 0, fpsAccum = 0, fps = 0, saveTimer = 0, weatherStrength = 0, raining = false;
  /** Which houses were standing when the world was last told what to walk into. */
  let wallsBuilt = '';
  /** A hired man is re-marked now and then, because the world streams him out and back. */
  let musterIn = 0;
  /** Counts pulls of the tiller, so the world's answers can name the one they have caught up to. */
  let helmSeq = 0;
  let areaLabel = 'The Crossroads';
  /** What the water listener last worked out, for the debug hook and for nothing else. */
  let heard = { nearness: 0, drop: 0 };

  /**
   * What is underfoot, for deciding how fast a mount travels over it.
   *
   * Sampled when the hero crosses into a new tile rather than every frame: the going cannot change
   * without the tile changing, and terrain sampling is not free.
   */
  let goingTile = '';
  let going: Going = 'open';
  const goingUnderfoot = (): Going => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const key = `${tx},${tz}`;
    if (key === goingTile) return going;
    goingTile = key;
    const tile = sampler.newSample();
    sampler.sampleTile(tx, tz, tile);
    going = goingOf(tile);
    return going;
  };

  /** Frames per second, kept as a running average so the number on screen is readable. */
  const countFrame = (dt: number): void => {
    frames++; fpsAccum += dt;
    if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
  };

  /** The save happens on a timer rather than on every change, wherever the hero is standing. */
  const endFrame = (dt: number): void => {
    input.endFrame();
    saveTimer += dt;
    if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
  };

  const frame = (dt: number, time: number): void => {
    const stepDown = autoQuality.saw(dt * 1000, rig.quality);
    if (stepDown) {
      rig.setQuality(stepDown);
      rememberAutoChoice();
      hud.flash(`Graphics turned down to keep up: ${QUALITY[stepDown].label}`);
    }
    // the full-screen map pauses the world the way a conversation does
    if (worldMap.isOpen) {
      const panX = (input.isDown('d', 'arrowright') ? 1 : 0) - (input.isDown('a', 'arrowleft') ? 1 : 0);
      const panZ = (input.isDown('s', 'arrowdown') ? 1 : 0) - (input.isDown('w', 'arrowup') ? 1 : 0);
      worldMap.pan(panX, panZ, dt);
      worldMap.draw(mapInput());
    }
    const talking = inTalk() || worldMap.isOpen;
    iso.update(input, dt, player.mode === 'free' && !talking && !places.indoors);
    // the mountains, twice: how far back the camera stands from them, and the hole they keep open
    // in front of the hero so that being on the far side of one is not being unable to play
    skyline.update(iso, player.entity.x, player.entity.z, dt, !places.indoors && !places.underground);
    heroSpot.set(player.entity.x, player.entity.y + HERO_EYE, player.entity.z);
    rock.look(heroSpot, iso.camera, iso.target);

    /**
     * The guard is held, not tapped, and it is polled here rather than bound as a one-shot key so
     * that how long it has been up is a real number the parry window can be measured against.
     * Not while riding: a guard on horseback is a different animation and a different fight.
     */
    if (!talking && !mount.riding && !sailing.sailing && input.isDown('c')) breath.raise(); else breath.drop();
    breath.age(dt);
    player.climb = state.climb;
    player.speedScale = haulPace(
      mount.riding ? paceOf(mount.breed, goingUnderfoot()) : 1,
      mount.riding,
      state.count('cart') > 0,
    ) * (breath.guarding ? BREATH.GUARDED_PACE : 1);
    if (sailing.sailing && !talking) {
      const tiller = {
        forward: (input.isDown('w', 'arrowup') ? 1 : 0) - (input.isDown('s', 'arrowdown') ? 1 : 0),
        turn: (input.isDown('a', 'arrowleft') ? 1 : 0) - (input.isDown('d', 'arrowright') ? 1 : 0),
      };
      sailing.update(dt, tiller, chunks, player);
      // and the world moves its own boat the same way, so that a boat two people are looking at is
      // in one place. Sent every frame it is under way, which is the only time it matters.
      if (tiller.forward !== 0 || tiller.turn !== 0) online.helm(++helmSeq, tiller.forward, tiller.turn, dt);
      iso.target.x += (sailing.x - iso.target.x) * Math.min(1, dt * 6);
      iso.target.z += (sailing.z - iso.target.z) * Math.min(1, dt * 6);
    }
    player.update(input, iso, dt, talking || sailing.sailing, places.indoors !== null);
    // What the hero was trying to do goes to the world, which walks him itself and says where he
    // got to; the step above has already walked him here so the game answers the key at once. Only
    // out of doors and on his own feet: everywhere else the world has no ground to walk him on and
    // the client is still the authority. `docs/server-authority.md`, phase four.
    if (outdoors()) {
      walked.walked(player.steered);
      walked.settle(player.entity, dt);
    } else {
      walked.reset();
    }
    // and then look up at the mountain, if there is one. Set rather than added: the hero pulls the
    // camera back to his own feet every frame, so anything added here accumulates — which it did,
    // fifty units into the air.
    iso.lift = skyline.headroom;
    tickDialogue(dt);
    rig.water.update(time);
    if (!talking) { state.tick(dt); magic.tick(dt); }
    // what a blow costs in time, counted before the frame decides where the hero is standing
    blows.cooled(dt);
    // and a teleport's beam, which is ticked here — above the three branches below and outside the
    // pause a conversation puts on the world — because the hero is drawn in pieces while it runs
    // and it is this that assembles him again. Anywhere a frame can return early past is a place
    // he could be left invisible.
    beam.update(dt);
    /*
     * A door, from whichever side he walked at it.
     *
     * Above the branch, with the cooldowns, and for the same reason they are: below it this runs
     * on the out-of-doors path only, so walking into a house would work and walking back out of
     * one would not — which is exactly how it shipped, and exactly what was reported. A door does
     * not know which way you are going, and neither should the frame.
     */
    if (!talking) doorsteps.step(player, dt);
    tidings.theDaysNews();

    // hold the place for this frame: a bite can end it half way through
    const indoors = places.indoors;
    if (indoors) {
      countFrame(dt);
      // indoors: a fixed view of the room, the hero and whoever keeps the place
      indoors.renderer.update(iso.camera);
      heroGear.update(state, player.entity);
      sync(dt, () => 0.5);
      updateHud(dt, indoors.title);
      hud.setBreath(magic.wind, magic.warded, breath.share, breath.guarding);
      sound.update(dt, player.entity.walk > 0.3 && !talking, true);
      hud.setDebug(dt, () => `${fps.toFixed(0)} fps  ${indoors.title}\ndraws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k\nEnter at the door to step outside`);
      rig.renderer.render(indoors.scene.scene, iso.camera);
      endFrame(dt);
      return;
    }

    const below = places.underground;
    if (below) {
      countFrame(dt);
      // underground: the hero, the monsters, the lights and the HUD tick
      below.scene.heroLight.position.set(player.x, player.y + 1.5, player.z);
      below.scene.heroLight.intensity = state.can('light') || magic.lit ? 9 : 3;
      // The world runs the monsters on a floor, the way it runs the animals in a field, and this
      // side eases them between what it is told. Where there is no world listening, the same
      // manager thinks for them itself: it holds its own monsters rather than guests, and `update`
      // is what makes them move.
      below.monsters.update(dt, player.x, player.z, state.armed, onAttack);
      floorLife()?.update(dt);
      announceWindUps(below.monsters);
      if (places.underground !== below) { input.endFrame(); return; }
      below.renderer.update(iso.camera);
      heroGear.update(state, player.entity);
      sync(dt, (x, z) => below.world.heightAt(x, z));
      below.map.reveal(player.x, player.z);
      below.map.draw(player.x, player.z, state.opened, (i) => below.world.chestId(i), below.world.unlocked);
      updateHud(dt, below.floor > 1 ? `${below.poi.name} Depths · floor ${below.floor}` : `${below.poi.name} Depths`);
      hud.setBreath(magic.wind, magic.warded, breath.share, breath.guarding);
      sound.update(dt, player.entity.walk > 0.3 && !talking, true);
      hud.setDebug(dt, () =>
        `${fps.toFixed(0)} fps  ${below.poi.name} depths, floor ${below.floor}\n` +
        `draws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k  monsters ${Math.max(0, below.monsters.count - 1)}\n` +
        `rooms ${below.world.map.rooms.length}  doors ${below.world.map.doors.length}  ${below.world.unlocked ? 'unlocked' : 'locked'}  pos ${player.x.toFixed(0)},${player.z.toFixed(0)}`);
      rig.renderer.render(below.scene.scene, iso.camera);
      endFrame(dt);
      return;
    }

    // ferries follow the clock; the hero rides along and steps off when the boat ties up
    const clockNow = worldSeconds(state.day, state.time);
    sailFerries(clockNow, time);
    watch.watching(clockNow, dt);
    remains.age(dt);
    ageCamps(dt);
    runClock(dt);
    packField.update([...remains.all, ...carcasses()], (x, z) => chunks.heightAt(x, z));
    watch.hunted(dt);
    // the clouds turn, and anybody standing on a sky island is checked to be still standing on it
    skyRenderer.update(dt);
    skies.update();
    const { x, z } = iso.target;
    // the rig writes where the camera is looking onto the scene, and the chunks read it back to
    // decide which props are worth handing to the GPU, so it has to be said before it is asked
    rig.follow(x, z, iso.zoom);
    chunks.update(x, z);
    // and the country itself: what this page is missing, from what it kept or from the world
    streamCountry();
    // and the sea reads the ground back, so its waves come in parallel to whatever coast is here
    rig.seaAround(x, z, chunks);
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
    // the gear goes on before the light does, because after dark the light comes from the torch in
    // the hero's hand and the hand has to have been put somewhere first
    heroGear.update(state, player.entity, state.night > TORCH_OUT && !state.can('light'));
    daycycle.apply({
      time: state.time, focusX: x, focusZ: z, heroX: player.x, heroY: player.y, heroZ: player.z,
      lanternOn: state.can('light') || magic.lit, flame: heroGear.lightSource(), season: tint, wet: weatherStrength,
    });
    // Up on a sky island the hero counts as armed whatever is in their hands. A predator that
    // cannot reach you has no business stalking you, and a pack gathering on the ground beneath
    // the village to hunt somebody it can never touch is exactly the sort of thing you notice
    // when you are stood at a rim looking down at them.
    entities.update(dt, player.x, player.z, state.armed || skies.aloft !== null, onAttack, state.time, sailing.sailing);
    // what the world says is about, eased towards where it last said it was
    wildlife.update(dt);
    // and nothing announces a blow it is in no position to land, so the cloud is quiet
    if (skies.aloft === null) announceWindUps(entities);
    mount.update(player, chunks);

    sync(dt, (x2, z2) => chunks.heightAt(x2, z2));
    noticeStall();
    ownBoat.visible = sailing.bought && places.outdoors;
    if (ownBoat.visible) {
      ownBoat.position.set(sailing.x, WORLD.WATER_Y - BOAT.DRAFT + Math.sin(time * 1.6 + sailing.x) * 0.03, sailing.z);
      ownBoat.rotation.y = sailing.yaw;
    }
    cropField.update(plots, state.day + state.time, player.x, player.z, (x2, z2) => chunks.heightAt(x2, z2));
    const standing = houses.entries().map((job) => ({ id: job.id, x: job.x, z: job.z, rot: job.rot, stage: stageAt(job, state.day + state.time) }));
    buildingSite.update(standing, player.x, player.z, (x2, z2) => chunks.heightAt(x2, z2));
    /**
     * And a finished house is a wall to everybody, not only a picture.
     *
     * Only the finished ones. Pegs in the ground and a frame are things you walk through on a
     * building site, and a site that turned solid the day it was marked out could shut a door
     * behind somebody standing on their own plot.
     *
     * Rebuilt only when the set of houses or their stages actually changes, because this runs
     * every frame and almost every frame the answer is the same one as last time.
     */
    const walls = standing.filter((job) => job.stage === 'house').map((job) => `${job.id}`).join('|');
    if (walls !== wallsBuilt) {
      wallsBuilt = walls;
      const tiles: Array<{ x: number; z: number }> = [];
      for (const job of standing) {
        if (job.stage !== 'house') continue;
        const tx = Math.floor(job.x), tz = Math.floor(job.z);
        for (let dz = -BUILD.PLOT; dz <= BUILD.PLOT; dz++) {
          for (let dx = -BUILD.PLOT; dx <= BUILD.PLOT; dx++) tiles.push({ x: tx + dx, z: tz + dz });
        }
      }
      chunks.standsOn(tiles);
    }
    entityRenderer.update(iso.camera);

    if (state.markExplored(Math.floor(player.x / WORLD.CHUNK_SIZE), Math.floor(player.z / WORLD.CHUNK_SIZE))) reveal();
    areaLabel = skies.aloft?.name ?? areaName();
    arriving();
    updateHud(dt, areaLabel, weatherStrength > 0.4 ? (season === Season.Winter ? '❄' : '🌧') : '');
    hud.setBreath(magic.wind, magic.warded, breath.share, breath.guarding);
    if (fishing.active) {
      const ev = fishing.update(dt);
      if (ev === 'bite') sound.chime();
      if (ev === 'missed') hud.flash('It got away.');
      castbar.className = fishing.phase === 'bite' ? 'show bite' : fishing.phase === 'waiting' ? 'show' : '';
      castbar.textContent = fishing.phase === 'bite' ? 'A bite! Press Enter!' : raining ? 'Fishing in the rain… they are rising' : 'Fishing… wait for the bite';
    } else if (castbar.className !== '') {
      castbar.className = '';
    }
    refreshJournal();
    hud.tick(dt);
    sound.setScene(here.biome, state.night);
    sound.update(dt, player.entity.walk > 0.3 && !talking, chunks.isRoad(player.x, player.z));
    heard = listenForWater(chunks, player.x, player.z);
    sound.setWater(heard.nearness, heard.drop);
    director.advance(dt);

    musterIn -= dt;
    if (musterIn <= 0) { musterIn = HIRE.MUSTER_EVERY; musterHires(); }
    if (input.clicked && !talking) {
      mouse.set((input.clickX / window.innerWidth) * 2 - 1, -(input.clickY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(mouse, iso.camera);
      const e = entities.pick(raycaster);
      if (e) {
        if (Math.hypot(e.x - player.x, e.z - player.z) < GAMEPLAY.CLICK_TALK_RANGE) startTalk(e);
        else hud.flash(`${e.name} the ${e.kind.label} is too far away`);
      }
    }

    countFrame(dt);
    hud.setDebug(dt, () =>
      `${fps.toFixed(0)} fps  chunks ${chunks.stats.drawn}/${chunks.stats.loaded}  queue ${chunks.stats.pending}\n` +
      `draws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k  creatures ${entities.count}\n` +
      // the chunk stands where the world's radius used to. A radius was only ever the size of a
      // world that has an edge; the chunk is the square the ground is actually loaded in, which
      // is a true thing to say about a world grown a patch at a time as well as about a bounded one
      `roads ${graph.edges.length}  chunk ${chunkKey(Math.floor(x / WORLD.CHUNK_SIZE), Math.floor(z / WORLD.CHUNK_SIZE))}  pos ${x.toFixed(0)},${z.toFixed(0)}\n` +
      // what the screen is getting wrong about the world's own creatures, which is the difference
      // between swinging at a wolf and hitting one
      (() => {
        const told = wildlife.drift(false);
        return `world creatures ${told.drawn}  screen wrong by ${told.recent.toFixed(2)} tiles`;
      })());

    minimap.draw(player.x, player.z, iso.groundCorners(iso.target.y), markers(), !state.can('map'), player.entity.yaw);
    rig.renderer.render(rig.scene, iso.camera);
    endFrame(dt);
  };

  return {
    frame,
    /** Is it raining on the hero? The fish are rising, and the fishing line says so. */
    raining: (): boolean => raining,
    /** What the country round him is called, which the compass and the console both ask for. */
    areaLabel: (): string => areaLabel,
    /** And how much water is within earshot, for the debug hook and for nothing else. */
    heard: (): { nearness: number; drop: number } => heard,
  };
}
