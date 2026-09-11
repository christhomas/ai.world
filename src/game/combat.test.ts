import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd, damageEntity, type TileWorld } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { GameState } from './state';
import { COMBAT, spoils, swing } from './combat';
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

/**
 * What a kill leaves behind, which turned out to be two different answers depending on who
 * resolved it.
 *
 * Reported by somebody playing on a server: "when you kill animals, they don't drop anything like
 * skin or meat". Two faults, both only visible in a shared world — which is every world with
 * anybody else in it, and the one this game is actually played in.
 *
 * The first is that `spoils` both worked out what a body was worth *and* put it in the rucksack,
 * while returning it as well. The caller that runs when the world owns the animal gave the loot a
 * second time, so a cow was worth two pieces of meat online and one alone; the caller that credits
 * a monster somebody else resolved never gave it at all, and only worked because of the side
 * effect. A function that both answers and acts has two callers who cannot both be right.
 *
 * The second is worse and is in `authority.ts`: a hide is not in the loot any more — it stays on
 * the body until somebody kneels with a knife — and the world's own kills never told the carcass
 * list. No pelt in the pack, because that is the design, and no body to take one off. You could
 * hunt all day and come home with nothing.
 */
describe('what a body is worth', () => {
  /** A creature of a named kind, standing somewhere, with whatever its properties say on it. */
  const beast = (kind: string, x = 10, z = 10): Entity => {
    const k = KINDS[kind];
    return new Entity(k, x, z, new Herd(k, x, z, x, z, 0), `test:${kind}`, mulberry32(1));
  };

  it('says what is owed without paying it', () => {
    // the whole of the first fault in one assertion: asking what a body is worth must not be the
    // same act as taking it, or every caller has to know whether asking already paid
    const state = new GameState();
    const before = state.count('meat');
    const cow = beast('cow');
    const won = spoils(cow, 1);
    expect(state.count('meat'), 'asking what a cow was worth put meat in the rucksack').toBe(before);
    expect(won.gold).toBeGreaterThanOrEqual(0);
  });

  it('is the same answer however many times it is asked', () => {
    // seeded by where it died, so two machines working out the same kill agree — and so that
    // asking twice, which the online path does, cannot pay twice over
    const cow = beast('cow', 12, 34);
    const first = spoils(cow, 7);
    const second = spoils(cow, 7);
    expect(second).toEqual(first);
  });

  it('never puts a hide in the loot, whatever was killed', () => {
    /*
     * A pelt is earned by walking back to the body with a knife rather than by luck, which is what
     * makes a skinning knife worth its space. So it must never arrive in the rucksack at the moment
     * of the kill, however the kill was resolved.
     */
    for (const kind of ['wolf', 'deer', 'bear', 'fox']) {
      if (!KINDS[kind]) continue;
      const loot = spoils(beast(kind), 3).loot;
      for (const id of loot) {
        expect(['pelt', 'bearpelt', 'foxfur', 'hide'], `killing a ${kind} handed over a ${id}`)
          .not.toContain(id);
      }
    }
  });

  it('pays a swing exactly once', () => {
    /*
     * The regression, stated as a number. A cow's meat is a certainty — `chance: 1` — so one cow
     * killed is one piece of meat, and the day the rucksack shows two is the day somebody has made
     * working out what a body is worth pay for it as well.
     */
    const { manager, renderer } = setup();
    const state = new GameState();
    // a cow rather than whatever the monster table rolls, because what is being counted is its
    // meat: `chance: 1` in `properties/beasts.json` makes one cow exactly one piece
    const target = beast('cow', 11, 10);
    target.hp = 1;
    renderer.add(target);
    manager.guests = { [Symbol.iterator]: () => [target][Symbol.iterator]() };
    const before = state.count('meat');
    const result = swing(state, manager, flat, 10, 10, 0, 1);
    expect(result.killed.length, 'nothing died').toBe(1);
    expect(result.loot).toContain('meat');
    expect(state.count('meat') - before, 'one cow, two pieces of meat').toBe(1);
  });
});
