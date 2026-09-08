import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { Entity, Herd, anybodyAt, bodyOf, tryMove, type TileWorld } from './entity';
import { mulberry32 } from '../core/rng';

/**
 * Nothing in this world took up any room.
 *
 * Walkability asked the ground about the ground, so a hero walked through cows, through villagers
 * and through the shopkeeper standing at his own counter — reported as "I can walk through walls,
 * buildings, marketstalls, people". The walls and the stalls were a separate fault; the people were
 * this one, and it is the simpler of the two: nobody had a body at all.
 */

/** Open ground everywhere, so the only thing that can stop anybody is somebody else. */
const meadow: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

function someone(kind: string, x: number, z: number): Entity {
  const rng = mulberry32(4);
  const herd = new Herd(KINDS[kind], x, z, x, z, 1);
  const e = new Entity(KINDS[kind], x, z, herd, 'k', rng);
  e.x = x; e.z = z; e.y = 0;
  return e;
}

describe('taking up room', () => {
  it('gives a bigger creature a bigger body, and nothing a body of nothing', () => {
    expect(bodyOf(KINDS.cow)).toBeGreaterThan(bodyOf(KINDS.rabbit));
    for (const kind of ['rabbit', 'villager', 'cow', 'horse', 'wolf']) {
      expect(bodyOf(KINDS[kind]), `${kind} takes up room`).toBeGreaterThan(0.15);
    }
  });

  it('will not let anybody walk into where somebody is standing', () => {
    const villager = someone('villager', 10, 10);
    const cow = someone('cow', 10.4, 10);
    expect(anybodyAt([cow], 10.4, 10, villager), 'right on top of it').toBe(true);
    expect(anybodyAt([cow], 12, 10, villager), 'two tiles off').toBe(false);
  });

  it('lets somebody step over a body on the floor', () => {
    // a carcass that blocked the way would make a fight in a doorway unwinnable
    const villager = someone('villager', 10, 10);
    const fallen = someone('cow', 10.2, 10);
    fallen.dead = true;
    expect(anybodyAt([fallen], 10.2, 10, villager)).toBe(false);
  });

  it('never counts the mover against itself', () => {
    const villager = someone('villager', 10, 10);
    expect(anybodyAt([villager], 10, 10, villager)).toBe(false);
  });

  it('stops a stride short of somebody, and lets it slide past', () => {
    const cow = someone('cow', 11, 10);
    const hero = someone('villager', 10, 10);
    const crowd = { occupied: (x: number, z: number, ignore: Entity) => anybodyAt([cow], x, z, ignore) };

    // straight at the cow, over open ground: the ground allows it and the cow does not
    let blockedOnce = false;
    for (let i = 0; i < 30; i++) if (!tryMove(meadow, hero, 0.05, 0, crowd)) { blockedOnce = true; break; }
    expect(blockedOnce, 'something was in the way').toBe(true);
    expect(hero.x, 'and he stopped short of it').toBeLessThan(11 - bodyOf(KINDS.cow));

    // and a step that is partly along the cow still gets its sideways half, so nobody sticks
    const before = hero.z;
    expect(tryMove(meadow, hero, 0.05, 0.05, crowd)).toBe(true);
    expect(hero.z, 'slid along it rather than stopping dead').toBeGreaterThan(before);
  });
});
