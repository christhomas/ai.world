import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Entity, TileWorld } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { BOW, markFor } from './archery';
import { CRAFT } from './craft';
import { GUN, fire, markUnder } from './gun';
import { GameState } from './state';

/**
 * The gun on the thing in the crater.
 *
 * Half of why flying `Zarch` was worth doing, and the reason this one had to be written rather than
 * borrowed whole from the bow: a craft has no quiver, its damage is the machine's rather than
 * whatever is in the pilot's pack, and it shoots from four units up. What it *does* borrow is the
 * only hard part, which is picking a mark by a slant rather than by a distance across the ground.
 */

/** Meadow at one terrace everywhere, so every height here is a height above that. */
const flat: TileWorld = {
  heightAt: () => 1,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const GROUND = 1;

let packs = 0;

function setup(): EntityManager {
  const scene = new THREE.Scene();
  const renderer = new EntityRenderer(scene);
  return new EntityManager(renderer, flat, { getTiles: () => null }, 1);
}

/** One creature where the test wants it, with its herdmates sent out of the county. */
function quarry(manager: EntityManager, x: number, z: number, y: number, hp = 99): Entity {
  const herd = manager.spawnPack('deer', 0, 0, 0, ++packs);
  expect(herd.length).toBeGreaterThan(0);
  herd.slice(1).forEach((e, i) => { e.x = 900 + i * 4; e.z = 900; });
  const one = herd[0];
  one.x = x; one.z = z; one.y = y; one.hp = hp;
  return one;
}

describe('the craft’s gun', () => {
  it('reaches further than a bow, because the whole craft is the sight', () => {
    const manager = setup();
    const far = quarry(manager, BOW.RANGE + 2, 0, GROUND);
    expect(markFor(manager, flat, 0, 0, 0), 'a bow could already reach that far').toBeNull();
    expect(markUnder(manager, flat, 0, 0, 0, CRAFT.HOVER)).toBe(far);
  });

  it('shoots from the craft’s height, so what is below it is properly below it', () => {
    const manager = setup();
    // directly ahead and on the ground: from a cockpit four units up that is a shot downwards
    const beast = quarry(manager, 8, 0, GROUND);
    expect(markUnder(manager, flat, 0, 0, 0, CRAFT.HOVER)).toBe(beast);
    // and the same creature far enough out that the slant, not the ground distance, puts it away
    beast.x = GUN.RANGE - 1;
    beast.y = GROUND + 12;
    expect(markUnder(manager, flat, 0, 0, 0, CRAFT.HOVER)).toBeNull();
  });

  it('is aimed more tightly than a bow', () => {
    const manager = setup();
    // off to one side by more than the gun's cone allows but well inside the bow's
    const off = Math.tan((GUN.ARC + BOW.ARC) / 2) * 8;
    const beast = quarry(manager, 8, off, GROUND);
    expect(markFor(manager, flat, 0, 0, 0), "the bow could not see it either").toBe(beast);
    expect(markUnder(manager, flat, 0, 0, 0, CRAFT.HOVER)).toBeNull();
  });

  it('costs no ammunition, because whatever it is did not come with a quiver', () => {
    const manager = setup();
    const state = new GameState();
    quarry(manager, 8, 0, GROUND);
    const shot = fire(state, manager, flat, 0, 0, 0, CRAFT.HOVER, 1);
    expect(shot.hit).toHaveLength(1);
    expect(shot.spent, 'the gun spent something').toBe(0);
    expect(shot.recovered).toBe(0);
  });

  it('does the machine’s damage rather than the pilot’s', () => {
    const manager = setup();
    const state = new GameState();
    // a hero with nothing in his hands at all, in a seat that does not care
    const beast = quarry(manager, 8, 0, GROUND, 99);
    const before = beast.hp;
    fire(state, manager, flat, 0, 0, 0, CRAFT.HOVER, 1);
    expect(before - beast.hp).toBe(GUN.DAMAGE);
  });

  it('kills what it kills, and hands over what was on it', () => {
    const manager = setup();
    const state = new GameState();
    const beast = quarry(manager, 6, 0, GROUND, GUN.DAMAGE);
    const shot = fire(state, manager, flat, 0, 0, 0, CRAFT.HOVER, 1);
    expect(shot.killed).toEqual([beast]);
  });

  it('hits nothing when there is nothing in front of it', () => {
    const manager = setup();
    const state = new GameState();
    quarry(manager, -8, 0, GROUND);          // behind the craft
    expect(fire(state, manager, flat, 0, 0, 0, CRAFT.HOVER, 1).hit).toEqual([]);
  });
});
