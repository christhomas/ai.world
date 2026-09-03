import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd, damageEntity, type TileWorld } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { GameState } from './state';
import { COMBAT, swing } from './combat';
import * as THREE from 'three';

const flat: TileWorld = {
  heightAt: () => 1,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

function setup() {
  const scene = new THREE.Scene();
  const renderer = new EntityRenderer(scene);
  const manager = new EntityManager(renderer, flat, { getTiles: () => null }, 1);
  return { manager, renderer };
}

describe('combat', () => {
  it('a swing only hits creatures in the arc it faces', () => {
    const { manager } = setup();
    manager.spawnMonsters([[10, 10]], 1);
    const state = new GameState();
    const monsters = manager.within(10, 10, 5);
    expect(monsters.length).toBeGreaterThan(0);
    const target = monsters[0];
    target.x = 11; target.z = 10; target.hp = 99;
    // facing +x hits it; facing -x does not
    const away = swing(state, manager, flat, 10, 10, Math.PI, 1);
    expect(away.hit).toEqual([]);
    const toward = swing(state, manager, flat, 10, 10, 0, 1);
    expect(toward.hit).toContain(target);
    // out of reach
    target.x = 10 + COMBAT.RANGE + 1;
    expect(swing(state, manager, flat, 10, 10, 0, 1).hit).toEqual([]);
  });

  it('kills award gold, remove the creature, and the sword hits harder', () => {
    const { manager } = setup();
    manager.spawnMonsters([[20, 20]], 7);
    const state = new GameState();
    const rat = manager.within(20, 20, 6).find((e) => e.kind.hp === 2);
    if (rat) {
      rat.x = 21; rat.z = 20; rat.hp = 2;
      const gold = state.inventory.gold;
      // bare handed: 1 damage, survives
      const first = swing(state, manager, flat, 20, 20, 0, 3);
      expect(first.killed).toEqual([]);
      expect(rat.hp).toBe(1);
      expect(rat.hurt).toBeGreaterThan(0);
      // armed: 2 damage, dies and pays out
      state.inventory.items.set('sword', 1);
      rat.x = 21; rat.z = 20;
      const second = swing(state, manager, flat, 20, 20, 0, 3);
      expect(second.killed).toEqual([rat]);
      expect(second.gold).toBeGreaterThan(0);
      expect(state.inventory.gold).toBe(gold + second.gold);
      expect(manager.within(20, 20, 6)).not.toContain(rat);
    }
  });

  it('damage knocks a creature back and prey flee afterwards', () => {
    const herd = new Herd(KINDS.sheep, 5, 5, 5, 5, 5);
    const sheep = new Entity(KINDS.sheep, 5, 5, herd, 'k', mulberry32(1));
    sheep.hp = 5;
    sheep.y = 1;
    const dead = damageEntity(sheep, 1, 4, 5, flat);
    expect(dead).toBe(false);
    expect(sheep.x).toBeGreaterThan(5);      // pushed away from the blow
    expect(sheep.state).toBe('flee');
    expect(damageEntity(sheep, 99, 4, 5, flat)).toBe(true);
    expect(sheep.dead).toBe(true);
  });
});
