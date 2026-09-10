import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { PropLibrary } from '../render/props';
import { Register } from '../world/register';
import type { Doorway } from '../world/structures';
import type { TileWorld } from '../world/tiles';
import { Places, personWins, type PlaceContext } from './places';

/**
 * The first errand of a new save is taken and paid in the village square, and a market pitch
 * stands in the middle of that square. Enter reached the pitch from anywhere in it, and offline a
 * pitch only says to come back online, so the errand could be taken and never handed in. These
 * pin the rule that fixed it.
 */
describe('who answers a keypress', () => {
  it('gives it to somebody standing nearer than the scenery', () => {
    // the elder at arm's length, the trestle across the square
    expect(personWins(0, 0, { x: 0.8, z: 0 }, 4, 0)).toBe(true);
  });

  it('leaves it with the scenery you are standing in front of', () => {
    // somebody wandering past behind you is not who you meant
    expect(personWins(0, 0, { x: 3, z: 0 }, 0.5, 0)).toBe(false);
  });

  it('leaves it with the scenery when nobody is about', () => {
    expect(personWins(0, 0, null, 5, 5)).toBe(false);
  });

  it('measures from the player rather than between the two', () => {
    // person and pitch close together, both far from the hero: still whoever is nearer to them
    expect(personWins(0, 0, { x: 9.5, z: 0 }, 10, 0)).toBe(true);
    expect(personWins(0, 0, { x: 10, z: 0 }, 9.5, 0)).toBe(false);
  });
});

/**
 * Standing in a room, and being able to say who is in it.
 *
 * Every probe that answers "who is near the hero" — `__entities`, `__entitiesFull`, `__blow`, the
 * console's own `entities` — asks `places.crowd` and falls back on the country when it says
 * nobody. Indoors it always said nobody, because a room had no crowd to be: the keeper was built
 * and handed straight to the renderer, which draws him and holds nothing anybody can ask.
 *
 * So a probe standing at a watch house desk listed ducks and sheep, because the hero's position in
 * a room is a room coordinate and the country happily answers about whatever stands at those
 * numbers out in the fields. That is worse than a readout being empty: it is a readout that is
 * confidently about somewhere else, and it would hide every indoor fault there is.
 */
describe('who the probes see when the hero is indoors', () => {
  /** Ground with nothing on it, for standing a field of sheep up on. */
  const meadow: TileWorld = {
    heightAt: () => 0,
    waterAt: () => null,
    blocked: () => false,
    isRoad: () => true,
  };

  /**
   * A hero, a village door, and everything `enterBuilding` reaches for on the way through it.
   *
   * The room, the world it walks on and the crowd in it are all real — those are what is being
   * tested. The camera, the gear and the hero's own body are stubs, because a room does not care
   * where the camera was left.
   */
  function walkInto(kind: Doorway['kind']) {
    const rng = mulberry32(9);
    const outside = new THREE.Scene();
    const overworldRenderer = new EntityRenderer(outside);
    const heroHerd = new Herd(KINDS.hero, 0, 0, 0, 0, 0);
    const hero = new Entity(KINDS.hero, 0, 0, heroHerd, 'hero', rng);
    const player = {
      entity: hero, x: 0, z: 0,
      teleport(x: number, z: number) { this.x = x; this.z = z; hero.x = x; hero.z = z; },
      setWorld() {},
    };
    const door: Doorway = { x: 40, z: 41, kind, village: 'Elderton', bx: 40, bz: 39 };
    const places = new Places({
      seed: 4321,
      props: new PropLibrary(),
      rig: { scene: outside },
      iso: { zoom: 18, limitZoom() {}, resize() {}, target: { set() {} } },
      player,
      overworldRenderer,
      heroGear: { attachTo() {} },
      register: new Register(4321),
      rng,
      fallen: () => {},
      chime: () => {},
      persist: () => {},
    } as unknown as PlaceContext);
    places.enterBuilding(door);
    return { places, player, overworldRenderer };
  }

  /** The one line every probe asks with, written out so this test is the same question they are. */
  const crowdAround = (places: Places, country: EntityManager): EntityManager => places.crowd ?? country;

  it('answers about the man behind the counter and not about a field of sheep', () => {
    const { places, player, overworldRenderer } = walkInto('store');

    /*
     * A flock at the hero's own coordinates, out in the country.
     *
     * Which is the whole trap: indoors the hero stands at about (5, 8) *of the room*, and the
     * country is perfectly willing to say what is standing at (5, 8) of the world — two hundred
     * tiles from the shop, and as near as makes no difference to a probe that only subtracts.
     */
    const country = new EntityManager(overworldRenderer, meadow, { getTiles: () => null }, 1);
    country.spawnPack('sheep', player.x + 2, player.z + 2, 0, 7, 'field', 4);
    expect(country.within(player.x, player.z, 90).map((e) => e.kind.id), 'the trap is not set')
      .toContain('sheep');

    const seen = crowdAround(places, country).within(player.x, player.z, 90);
    expect(seen.map((e) => e.kind.id), 'the shopkeeper a pace in front of the hero').toContain('shopkeeper');
    expect(seen.map((e) => e.kind.id), 'sheep in a field, reported from inside a shop').not.toContain('sheep');
    expect(seen[0], 'the nearest person indoors is the keeper').toBe(places.indoors!.keeper);
  });

  it('hands back the room rather than the floor below, when the hero is in both', () => {
    // a frame decides indoors first and then underground, and this has to agree with it: you can
    // walk into a building that stands over a cellar, and the room is the place you are in
    const { places } = walkInto('store');
    expect(places.crowd).toBe(places.indoors!.crowd);
  });

  it('leaves the country to answer for the country', () => {
    const { places } = walkInto('store');
    places.leaveBuilding();
    expect(places.crowd, 'out of doors there is one crowd and everybody already has it').toBeNull();
  });

  /**
   * The keeper is the same man he was before he was taken into a crowd.
   *
   * `admit` places nobody and rolls nothing, which is the reason he goes in that way rather than
   * being spawned: a spawn scatters, and it asks `canStand` about the ground beside a counter,
   * which can answer no and leave a shop with nobody in it.
   */
  it('leaves the keeper exactly the man the room made him', () => {
    const shop = walkInto('store').places.indoors!;
    expect(shop.keeper!.kind.id, 'the body a shopkeeper is drawn with').toBe('shopkeeper');
    expect(shop.keeper!.role).toBe('shopkeeper');
    expect(shop.keeper!.shop).toBe('store');
    expect(shop.keeper!.trade, 'a grocer has no trade tree; the shop is what he is').toBe('');
    // stood where the room put him, to the tile, and facing the door
    const [kx, kz] = shop.world.map.keeper!;
    expect([shop.keeper!.x, shop.keeper!.z]).toEqual([kx + 0.5, kz + 0.5]);
    expect(shop.keeper!.yaw).toBe(Math.PI / 2);
    expect(shop.world.nearKeeper(shop.keeper!.x, shop.keeper!.z), 'still within talking distance').toBe(true);

    const watch = walkInto('watchhouse').places.indoors!;
    expect(watch.keeper!.trade, 'the desk of a watch house makes a sergeant').toBe('sergeant');
    expect(watch.keeper!.role).toBe('keeper');
    expect(watch.keeper!.kind.id, 'and a sergeant is drawn as a constable').toBe('constable');
  });

  it('is asked by the probes in exactly this way', () => {
    // The rule above is only worth pinning if it is the rule the probes actually use. They are
    // assembled with half the game around them and cannot be stood up here, so the call is read
    // instead — the same way `blows.test.ts` reads the frame for where the grace is counted down.
    const probes = readFileSync(new URL('./probes.ts', import.meta.url), 'utf8');
    expect(probes, 'the probes stopped asking which crowd the hero is in').toContain('places.crowd ?? entities');
    const console = readFileSync(new URL('./console.ts', import.meta.url), 'utf8');
    expect(console, 'the console`s own entities command stopped asking').toContain('places.crowd ?? entities');
  });
});
