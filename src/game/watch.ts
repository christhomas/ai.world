import type * as THREE from 'three';
import { WORLD } from '../core/config';
import { hashString } from '../core/rng';
import type { Entity } from '../entities/entity';
import type { EntityManager } from '../entities/manager';
import type { Player } from '../entities/player';
import { CampField } from '../render/wildcamps';
import { WhaleSchool } from '../render/whales';
import { compassDir, type Structures } from '../world/structures';
import type { ChunkManager } from '../world/chunkManager';
import type { TerrainSampler } from '../world/terrain';
import type { Sound } from './audio';
import type { Director } from './director';
import { gone, hauntsOf, toRaise, warningFor, type Haunt } from './haunts';
import { SENDS, sentBy, type Nemesis } from './nemesis';
import { ROAM, bandAt, bandsNear, outOfSight, warningFor as warningOfBand, type Band, type Roaming } from './roaming';
import type { Sailing } from './sailing';
import type { GameState } from './state';
import { SeaHunt } from './seahunt';
import { WHALE, displayAt, planPods, podsWithin, type Pod } from './whales';
import type { WildCamp } from './wildcamps';

/**
 * What the world stands up around the hero, and takes away again when he walks off.
 *
 * Nothing in here is kept in the save, and none of it has to be: where a band is on a given day,
 * which crag a keeper rises from at midnight and where the whales are this hour are all pure
 * functions of the seed and the clock. What is held is only the handful of them that happen to
 * have bodies in the world at this moment, so that walking away and walking back does not put two
 * of anything on the ground.
 */
export interface Watched {
  seed: number;
  scene: THREE.Scene;
  player: Player;
  state: GameState;
  structures: Structures;
  sampler: TerrainSampler;
  chunks: ChunkManager;
  entities: EntityManager;
  roaming: Roaming;
  nemesis: Nemesis;
  director: Director;
  sailing: Sailing;
  sound: Sound;
  flash: (message: string) => void;
  /** The screen's own flinch, for thirty tonnes of whale landing on the boat. */
  hurt: () => void;
  /** A whale coming down on the boat can empty the hearts, and that has to end somewhere. */
  knockOut: (cause: string) => void;
  persist: () => void;
  /** The camps other people pitched, which the interactions own and this only draws. */
  campsAround: (x0: number, z0: number, x1: number, z1: number) => WildCamp[];
  campEmptied: (camp: WildCamp) => boolean;
}

/** How near the hero has to be for Old Nettle to be worth putting in the world at all. */
const NETTLE_WITHIN = 70;
/** And how far out from the village his lot stand, in tiles. */
const NETTLE_RING = 8;

export function createWatch(ctx: Watched) {
  const {
    seed, scene, player, state, structures, sampler, chunks, entities, roaming, nemesis, director,
    sailing, sound, flash, hurt, knockOut, persist, campsAround, campEmptied,
  } = ctx;

  const pods = planPods(sampler, seed);
  const seaHunt = new SeaHunt(seed);
  const school = new WhaleSchool(scene);
  /** The hour we last announced each family in, so one word is one display. */
  const announced = new Map<Pod, number>();

  const campField = new CampField(scene);
  /** Camps in the country round the hero, worked out when they cross into a new chunk. */
  let campChunk = '';
  let campsNear: WildCamp[] = [];

  const haunts = hauntsOf(seed, structures);
  /** The one keeper standing in the world, and the place it came out of. You are only ever in one. */
  let keeper: { haunt: Haunt; entity: Entity } | null = null;
  /** Places already spoken of, so one visit is one warning rather than a warning a second. */
  const warned = new Set<string>();

  /** The one of him standing in the world, and nothing while he is in a cell or between schemes. */
  let nettleAbout: Entity | null = null;
  /** And his lot, who are most of what anybody ever actually fights. */
  let sentOut: Entity[] = [];

  /** Which bands have people standing in the world for them right now. */
  const bandsOut = new Map<string, Band>();

  const watchCamps = (): void => {
    const key = `${Math.floor(player.x / WORLD.CHUNK_SIZE)},${Math.floor(player.z / WORLD.CHUNK_SIZE)}`;
    if (key !== campChunk) {
      campChunk = key;
      const span = WORLD.CHUNK_SIZE * 2;   // a chunk either side of the one they are standing in
      campsNear = campsAround(player.x - span, player.z - span, player.x + span, player.z + span);
    }
    campField.update(campsNear, campEmptied, (x, z) => chunks.heightAt(x, z));
  };

  /** Stand a band up when the hero comes near it, and take it away again when they leave. */
  const watchBands = (): void => {
    for (const [id, band] of [...bandsOut]) {
      if (entities.packSizeOf(id) > 0 && !outOfSight(band, player.x, player.z, state.day)) continue;
      entities.despawnPack(id);
      bandsOut.delete(id);
    }
    for (const band of bandsNear(roaming.abroad(), player.x, player.z, state.day, ROAM.SIGHT * director.reach)) {
      if (bandsOut.has(band.id)) continue;
      const at = bandAt(band, state.day);
      const alive = roaming.alive(band);
      const pack = entities.spawnPack(band.kind, at.x, at.z, 0, band.seed ^ state.day, band.id, alive.length);
      if (pack.length === 0) continue;        // no standable ground this frame; it will try again
      // the number a kill will name, so two clients agree which of them went down
      pack.forEach((e, i) => { e.rosterIndex = alive[i] ?? i; });
      director.saw('band');
      bandsOut.set(band.id, band);
      flash(warningOfBand(band));
    }
  };

  const watchNettle = (): void => {
    const abroad = nemesis.whereabouts === 'abroad' || nemesis.whereabouts === 'choosing';
    const where = nemesis.scheme;
    if (!abroad || !where) {
      if (nettleAbout) { entities.despawnEntity(nettleAbout); nettleAbout = null; }
      for (const one of sentOut) if (!one.dead) entities.despawnEntity(one);
      sentOut = [];
      return;
    }
    const village = structures.villages.find((v) => v.name === where.village);
    if (!village) return;
    // only once the hero is near enough to see it happen: he is rare, and being rare is the point
    if (Math.hypot(village.x - player.x, village.z - player.z) > NETTLE_WITHIN * director.reach) return;

    if (!nettleAbout || nettleAbout.dead) {
      nettleAbout = entities.spawnOne('nettle', village.x + 3, village.z + 3, seed ^ hashString(where.village));
      director.saw('nemesis');
    }
    // his lot build up while the scheme runs, so arriving early is a different fight from
    // arriving late. He is rare; these are what makes a scheme dangerous to walk into.
    sentOut = sentOut.filter((one) => !one.dead);
    const wanted = sentBy(where, state.day);
    for (let n = sentOut.length; n < wanted; n++) {
      const angle = (n / wanted) * Math.PI * 2;
      const one = entities.spawnOne(
        SENDS[where.work].kind,
        village.x + Math.cos(angle) * NETTLE_RING,
        village.z + Math.sin(angle) * NETTLE_RING,
        seed ^ hashString(`${where.village}:${where.began}:${n}`),
      );
      if (one) sentOut.push(one);
    }
  };

  const watchHaunts = (): void => {
    if (keeper) {
      const { haunt, entity } = keeper;
      if (entity.dead || gone(haunt, player.x, player.z, state.time)) {
        if (!entity.dead) entities.despawnEntity(entity);
        keeper = null;
        warned.delete(haunt.id);
      }
      return;
    }
    const rising = toRaise(haunts, player.x, player.z, state.time);
    if (!rising) return;
    const entity = entities.spawnOne(rising.kind, rising.x, rising.z, seed ^ hashString(rising.id));
    if (!entity) return;
    keeper = { haunt: rising, entity };
    if (warned.has(rising.id)) return;
    warned.add(rising.id);
    sound.thud();
    flash(warningFor(rising));
  };

  /**
   * Whales, every frame we are above ground: the near pods drawn where the clock says they are,
   * a word when a display begins within sight, and a soaking for anybody whose boat is under one
   * when it comes down.
   */
  const watchWhales = (now: number, dt: number): void => {
    const near = podsWithin(pods, player.x, player.z, WHALE.WATCH);
    const splashes = school.update(near, now, dt);

    for (const pod of near) {
      const { showing, hour } = displayAt(pod, now);
      if (!showing || announced.get(pod) === hour) continue;
      announced.set(pod, hour);
      sound.whalesong();
      flash(`Whales are breaching — ${compassDir(pod.x - player.x, pod.z - player.z)}, ${Math.round(Math.hypot(pod.x - player.x, pod.z - player.z))} tiles`);
    }

    if (!sailing.sailing || sailing.overboard) return;
    for (const splash of splashes) {
      if (Math.hypot(splash.x - sailing.x, splash.z - sailing.z) > WHALE.SPLASH) continue;
      // thirty tonnes of whale onto a rowing boat: over the side you go
      sailing.throwOverboard();
      sound.splash();
      hurt();
      // a blow that empties the hearts has to end somewhere. Dropped on the floor, this one left
      // the hero treading water at nought hearts for ever, alive and with nothing to do about it
      if (state.damage(1)) { knockOut('A breaching whale'); break; }
      flash('A whale comes down across the bow. You are in the water.');
      persist();
      break;
    }
  };

  return {
    /** The families out there, whatever the clock says they are doing. */
    pods: pods as readonly Pod[],
    /** The one Old Nettle in the world, and his lot, for anybody who has to look at them. */
    nettleAbout: (): Entity | null => nettleAbout,
    sentOut: (): readonly Entity[] => sentOut,
    /**
     * Everything the world puts on the ground round the hero, once a frame and in this order:
     * the whales are drawn before anything can be knocked into the water by one, and the camps
     * last because they are the only ones nothing else reacts to.
     */
    watching: (now: number, dt: number): void => {
      watchWhales(now, dt);
      watchHaunts();
      watchNettle();
      watchBands();
      watchCamps();
    },
    /** Something takes an interest in a boat that has been in deep water a while. */
    hunted: (dt: number): void => {
      const arrived = seaHunt.update(dt, sailing.sailing, player.x, player.z, sampler, entities);
      if (!arrived) return;
      sound.thud();
      flash(`${arrived} in the water. They are circling.`);
    },
    /**
     * One of a band standing in the world has been killed.
     *
     * A band is broken by killing enough of it, and stays broken: the ledger is the only thing
     * about a band that is not derivable from the seed, so it is the only thing that travels.
     */
    oneFell: (who: Entity): void => {
      const band = bandsOut.get(who.herd.tag);
      if (!band) return;
      roaming.felled(band, who.rosterIndex, state.day);
      if (!roaming.isBroken(band)) return;
      entities.despawnPack(band.id);
      bandsOut.delete(band.id);
      flash('The rest of them scatter.');
    },
    dispose: (): void => { school.dispose(); campField.dispose(); },
  };
}
