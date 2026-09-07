import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import { mulberry32 } from '../core/rng';
import { GameState } from '../game/state';
import { HeroGear } from './herogear';

/**
 * The torch the hero carries after dark.
 *
 * The night light used to hang a metre and a half above the hero's feet — which is his head — so
 * he walked about lit from inside his own skull with his shadow thrown out in every direction from
 * a point nobody could see. He now carries a torch, and the light comes from the fire on the end
 * of it. Which means the fire has to actually be somewhere: out to the side of the hand that holds
 * it, well clear of the hat, and swinging with the arm like everything else he carries.
 */

function hero(): Entity {
  const rng = mulberry32(3);
  const herd = new Herd(KINDS.villager, 0, 0, 0, 0, 1);
  const e = new Entity(KINDS.villager, 0, 0, herd, 'hero', rng);
  e.x = 0; e.y = 0; e.z = 0; e.yaw = 0; e.walk = 0; e.phase = 0;
  return e;
}

/** The hero's own height, so "above his head" is a claim about him rather than a number. */
const HAT = 1.5;

describe('the torch after dark', () => {
  it('is not out in daylight, and there is no light to put anywhere', () => {
    const gear = new HeroGear(new THREE.Group());
    gear.update(new GameState(), hero(), false);
    expect(gear.lightSource()).toBeNull();
  });

  it('puts the fire beside the hero rather than over his hat', () => {
    const gear = new HeroGear(new THREE.Group());
    const who = hero();
    gear.update(new GameState(), who, true);
    const fire = gear.lightSource();
    expect(fire, 'a torch is out').not.toBeNull();
    // out to the side far enough to be seen as a separate thing from this camera
    expect(Math.hypot(fire!.x - who.x, fire!.z - who.z)).toBeGreaterThan(0.6);
    // and about shoulder height, not above the hat, which is the picture it replaces
    expect(fire!.y).toBeGreaterThan(1);
    expect(fire!.y).toBeLessThan(HAT);
  });

  it('carries the fire round with the hero rather than off to one corner of the world', () => {
    const gear = new HeroGear(new THREE.Group());
    const who = hero();
    const seen: Array<{ x: number; z: number }> = [];
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      who.yaw = yaw;
      gear.update(new GameState(), who, true);
      const fire = gear.lightSource()!;
      seen.push({ x: fire.x, z: fire.z });
      expect(Math.hypot(fire.x, fire.z), 'the same arm’s length at every heading').toBeCloseTo(Math.hypot(seen[0].x, seen[0].z), 6);
    }
    // four different headings put it in four different places
    const spots = new Set(seen.map((s) => `${s.x.toFixed(3)},${s.z.toFixed(3)}`));
    expect(spots.size).toBe(4);
  });

  it('gives the light to a lantern instead when the hero is holding one', () => {
    const gear = new HeroGear(new THREE.Group());
    const state = new GameState();
    state.give('lantern', 1);
    state.equip('lantern');
    const who = hero();
    gear.update(state, who, false);
    const fire = gear.lightSource();
    expect(fire, 'a lantern is a light too').not.toBeNull();
    expect(Math.hypot(fire!.x - who.x, fire!.z - who.z)).toBeGreaterThan(0.1);
  });
});
