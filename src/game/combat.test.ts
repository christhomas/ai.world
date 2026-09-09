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

/*
 * A blow was a distance and an angle, which is all a blow is in the open and not all it is in a
 * village: a wolf on the far side of a cottage is two tiles away and dead ahead, so a sword reached
 * it through the wall and an arrow found it through two. The arc says nothing about the ground in
 * between, so the ground has to be asked.
 */
describe('a wall between you and it', () => {
  /** Flat ground with a solid slab across x = 11, about the thickness of a cottage wall. */
  const walled: TileWorld = {
    heightAt: () => 1,
    waterAt: () => null,
    blocked: (x) => x > 11 && x < 11.5,
    isRoad: () => false,
    // the slab as a segment test: does the way from one point to the other pass through it?
    crosses: (x0, _z0, x1) => Math.min(x0, x1) <= 11.5 && Math.max(x0, x1) >= 11,
  };

  /** One creature, standing exactly where the test wants it, with hearts to lose. */
  const put = (manager: EntityManager, x: number, z: number) => {
    manager.spawnMonsters([[x, z]], 1);
    const it = manager.within(x, z, 6)[0];
    it.x = x; it.z = z; it.hp = 99;
    return it;
  };

  it('stops a swing', () => {
    const { manager } = setup();
    const beyond = put(manager, 12, 10);            // the far side of the wall
    const state = new GameState();
    // a tile short of the wall, facing straight at it, well within reach of what stands behind
    expect(swing(state, manager, walled, 10.5, 10, 0, 1).hit, 'swung through a wall').toEqual([]);
    expect(beyond.hp, 'and took hearts off it anyway').toBe(99);
  });

  it('and does not stop one in the open', () => {
    const { manager } = setup();
    const near = put(manager, 11.4, 10);
    const state = new GameState();
    const open: TileWorld = { ...walled, crosses: () => false };
    expect(swing(state, manager, open, 10.5, 10, 0, 1).hit, 'the same swing with nothing in the way')
      .toContain(near);
  });

  it('and is waived for somebody standing inside something', () => {
    const { manager } = setup();
    const beyond = put(manager, 12, 10);
    const state = new GameState();
    // inside the slab: every line out of it crosses it, so the rule would leave him helpless
    expect(swing(state, manager, walled, 11.2, 10, 0, 1).hit, 'could not swing while inside a wall')
      .toContain(beyond);
  });
});
