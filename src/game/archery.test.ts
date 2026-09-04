import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Entity, TileWorld } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { BOW, canShoot, markFor, quiver, shoot } from './archery';
import { COMBAT, swing } from './combat';
import { GameState } from './state';

/** Meadow at one terrace everywhere, so every height in these tests is a height above that. */
const flat: TileWorld = {
  heightAt: () => 1,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

/** The ground the hero stands on in every test below, which is where a shot is measured from. */
const GROUND = 1;

function setup() {
  const scene = new THREE.Scene();
  const renderer = new EntityRenderer(scene);
  return new EntityManager(renderer, flat, { getTiles: () => null }, 1);
}

/** A hero with a bow in hand and a quiver on their back. */
function archer(arrows = 10): GameState {
  const state = new GameState();
  state.give('bow');
  state.equip('bow');
  if (arrows > 0) state.give('arrow', arrows);
  return state;
}

let packs = 0;

/**
 * One flier, put exactly where the test wants it and given the hit points to survive being aimed
 * at. Its herdmates are sent to the far side of the world so that only the one bird is in the sky.
 */
function bird(manager: EntityManager, x: number, z: number, y: number, hp = 99): Entity {
  const flock = manager.spawnPack('bat', 0, 0, 0, ++packs);
  expect(flock.length).toBeGreaterThan(0);
  flock.slice(1).forEach((e, i) => { e.x = 900 + i * 4; e.z = 900; });
  const one = flock[0];
  one.x = x; one.z = z; one.y = y; one.hp = hp;
  return one;
}

describe('shooting a bow', () => {
  it('reaches a bird nine tiles up that no swing could ever be raised to', () => {
    const manager = setup();
    const state = archer();
    const eagle = bird(manager, 6, 0, GROUND + 9);

    // a sword measures the world flat and reaches two tiles: a bird that high is never inside them
    expect(swing(state, manager, flat, 0, 0, 0, 1).hit).toEqual([]);
    expect(6).toBeGreaterThan(COMBAT.RANGE);

    const shot = shoot(state, manager, flat, 0, 0, 0, 1);
    expect(shot.hit).toEqual([eagle]);
    expect(eagle.hurt).toBeGreaterThan(0);
  });

  it('counts the height against the range, so the same bird higher up is out of reach', () => {
    const manager = setup();
    const state = archer();
    const low = bird(manager, 13, 0, GROUND);
    expect(markFor(manager, flat, 0, 0, 0)).toBe(low);

    // thirteen tiles off and nine up is more than fourteen tiles of flying, and the arrow knows it
    low.y = GROUND + 9;
    expect(markFor(manager, flat, 0, 0, 0)).toBeNull();
    expect(Math.hypot(13, GROUND + 9 - (GROUND + BOW.SHOULDER))).toBeGreaterThan(BOW.RANGE);
  });

  it('does nothing at all with an empty quiver, or with the bow still in the pack', () => {
    const manager = setup();
    const empty = archer(0);
    const target = bird(manager, 4, 0, GROUND + 4);

    expect(canShoot(empty)).toBe(false);
    const nothing = shoot(empty, manager, flat, 0, 0, 0, 1);
    expect(nothing.hit).toEqual([]);
    expect(nothing.spent).toBe(0);
    expect(target.hp).toBe(99);

    // arrows and a bow are not enough: a bow does nothing from inside a rucksack
    const packed = new GameState();
    packed.give('bow');
    packed.give('arrow', 5);
    expect(canShoot(packed)).toBe(false);
    expect(shoot(packed, manager, flat, 0, 0, 0, 1).hit).toEqual([]);
    expect(quiver(packed)).toBe(5);
    expect(target.hp).toBe(99);
  });

  it('spends an arrow on every shot, gets back the ones that stopped in something, and loses the rest', () => {
    const manager = setup();
    const state = archer(10);
    bird(manager, 5, 0, GROUND + 6);

    const landed = shoot(state, manager, flat, 0, 0, 0, 1);
    expect(landed.spent).toBe(BOW.SPEND);
    expect(landed.recovered).toBe(BOW.SPEND * BOW.KEEP_HIT);
    expect(quiver(state)).toBe(10);          // pulled straight back out of the bat

    // the same shot the other way round is a shot into the grass, and that one is gone
    const missed = shoot(state, manager, flat, 0, 0, Math.PI, 1);
    expect(missed.hit).toEqual([]);
    expect(missed.spent).toBe(BOW.SPEND);
    expect(missed.recovered).toBe(BOW.SPEND * BOW.KEEP_MISS);
    expect(quiver(state)).toBe(9);

    // and a quiver does run dry, however well you shoot, because a miss is still one arrow
    for (let shots = 0; shots < 9; shots++) shoot(state, manager, flat, 0, 0, Math.PI, 1);
    expect(quiver(state)).toBe(0);
    expect(canShoot(state)).toBe(false);
  });

  it('stops in the first bird in the line and leaves the one behind it flying', () => {
    const manager = setup();
    const state = archer();
    const near = bird(manager, 3, 0, GROUND + 5);
    const far = bird(manager, 9, 0, GROUND + 5);

    const shot = shoot(state, manager, flat, 0, 0, 0, 1);
    expect(shot.hit).toEqual([near]);        // one arrow, one bird
    expect(far.hurt).toBe(0);

    // nothing to either side of the line is in it either: a bow is aimed, not swept
    near.x = 3; near.z = 3;
    expect(markFor(manager, flat, 0, 0, 0)).toBe(far);
  });

  it('pays out for what falls to it and carries the body off the field', () => {
    const manager = setup();
    const state = archer();
    const quarry = bird(manager, 7, 0, GROUND + 8, 1);
    const purse = state.inventory.gold;

    const shot = shoot(state, manager, flat, 0, 0, 0, 3);
    expect(shot.killed).toEqual([quarry]);
    expect(shot.gold).toBeGreaterThan(0);
    expect(state.inventory.gold).toBe(purse + shot.gold);
    expect(manager.within(7, 0, 3)).not.toContain(quarry);
  });

  it('reports the hit instead of settling it when somebody else is running the floor', () => {
    const manager = setup();
    const state = archer();
    const theirs = bird(manager, 5, 0, GROUND + 5);
    theirs.rosterIndex = 4;

    const shot = shoot(state, manager, flat, 0, 0, 0, 1, false);
    expect(shot.hit).toEqual([theirs]);
    expect(shot.killed).toEqual([]);
    expect(shot.reported).toEqual([{ index: 4, damage: state.attack }]);
    expect(theirs.hp).toBe(99);              // whoever owns the bat decides what the arrow did to it
    expect(shot.spent).toBe(BOW.SPEND);      // the arrow left the string either way
  });
});
