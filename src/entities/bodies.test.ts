import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { Entity, Herd, anybodyAt, bodyOf, tryMove, type TileWorld } from './entity';
import { MIN_BODY } from './properties';
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
  it('measures a body off the parts the creature is drawn from', () => {
    // the point of measuring rather than guessing: redraw a cow longer and it blocks longer,
    // without anybody remembering to come back here and change a number
    expect(bodyOf(KINDS.cow).hw).toBeGreaterThan(bodyOf(KINDS.rabbit).hw);
    for (const kind of ['rabbit', 'villager', 'cow', 'horse', 'wolf', 'goat']) {
      const body = bodyOf(KINDS[kind]);
      expect(body.hw, `${kind} takes up room`).toBeGreaterThanOrEqual(MIN_BODY);
      expect(body.hd, `${kind} takes up room across`).toBeGreaterThanOrEqual(MIN_BODY);
    }
  });

  it('keeps a long animal long rather than square', () => {
    // a horse is 1.31 nose to tail and about a third of that across. Taking the larger number for
    // both would make it a block two and a half tiles on a side — worse than walking through it
    const horse = bodyOf(KINDS.horse);
    expect(horse.hw, 'longer than it is wide').toBeGreaterThan(horse.hd * 1.5);
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

  it('stops a stride short of somebody, and never traps anybody', () => {
    const cow = someone('cow', 11, 10);
    // clear of it to begin with: a cow is nearly two tiles nose to tail, so ten paces away
    const hero = someone('villager', 8, 10);
    const crowd = { occupied: (x: number, z: number, ignore: Entity) => anybodyAt([cow], x, z, ignore) };

    // straight at the cow, over open ground: the ground allows it and the cow does not
    let blockedOnce = false;
    // far enough to reach it: a cow's box begins nearly two tiles from its middle
    for (let i = 0; i < 80; i++) if (!tryMove(meadow, hero, 0.05, 0, crowd)) { blockedOnce = true; break; }
    expect(blockedOnce, 'something was in the way').toBe(true);
    expect(hero.x, 'and he stopped short of it').toBeLessThan(11 - bodyOf(KINDS.cow).hd);

    // and he can walk away again
    const wasX = hero.x;
    expect(tryMove(meadow, hero, -0.05, 0, crowd), 'back the way he came').toBe(true);
    expect(hero.x).toBeLessThan(wasX);
  });

  it('lets somebody who is already inside a body walk out of it', () => {
    /*
     * Things do end up inside each other — a creature spawns beside one, a blow knocks somebody
     * back, the world corrects a hero onto a cow. Asked unconditionally, the crowd would refuse
     * every direction out of that as well, and being stuck for ever is worse than the
     * walking-through all of this replaced.
     */
    const cow = someone('cow', 10, 10);
    const hero = someone('villager', 10, 10);
    const crowd = { occupied: (x: number, z: number, ignore: Entity) => anybodyAt([cow], x, z, ignore) };
    expect(anybodyAt([cow], hero.x, hero.z, hero), 'standing in the cow').toBe(true);
    let got = 0;
    for (let i = 0; i < 60; i++) if (tryMove(meadow, hero, 0.05, 0, crowd)) got++;
    expect(got, 'walked out rather than being held there').toBeGreaterThan(20);
    expect(anybodyAt([cow], hero.x, hero.z, hero), 'and is clear of it now').toBe(false);
  });
});
