import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { Entity, Herd, bodyBox, type TileWorld } from './entity';
import { stride } from './stride';
import { JUMP, leapHeight } from './leap';
import { mulberry32 } from '../core/rng';
import { propFootprints } from './props';
import { PropKind } from '../world/biomes';
import { blocking } from '../world/footprints';
import { Solids, boxesFrom } from '../world/solids';

/**
 * A hop over the small stuff.
 *
 * The reason for it is not acrobatics, it is being stuck: a body is a box and so is everything it
 * meets, and a hero pushed into the pocket between a barrel and a wall can be left with no
 * direction a slide will take. From the chair that is a game that has stopped, with nothing on the
 * screen to say why.
 *
 * So what these measure is the line the jump draws — what it gets over, and what it must not — and
 * that a hero wedged against something can use it to get out.
 */

/** A field with one kind of prop standing in the middle of it, at the size it is really drawn. */
function fieldWith(kind: PropKind): { world: TileWorld; solids: Solids } {
  const stops = blocking(propFootprints(), new Set([kind]));
  const boxes = boxesFrom([{ kind, x: 0, z: 0, rot: 0 }], stops);
  expect(boxes.length, `nothing solid is drawn for prop ${kind}`).toBe(1);
  const solids = new Solids();
  solids.put('bench', boxes);
  return {
    solids,
    world: {
      heightAt: () => 1,
      waterAt: () => null,
      blocked: (x, z, body) => solids.at(x, z, body),
      isRoad: () => true,
      crosses: (x0, z0, x1, z1, body) => solids.crosses(x0, z0, x1, z1, body),
      depth: (x, z, body) => solids.depth(x, z, body),
    },
  };
}

function hero(x: number, z: number): Entity {
  const e = new Entity(KINDS.hero, x, z, new Herd(KINDS.hero, x, z, x, z, 0), 'bench', mulberry32(1));
  e.y = 1;
  return e;
}

/** Walk east for a while, jumping or not, and say how far he got. */
function walkEast(world: TileWorld, e: Entity, seconds: number, leaping: boolean): number {
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    if (leaping && e.leap <= 0) e.leap = JUMP.TIME;
    stride(world, e, { dx: 1, dz: 0, pace: 1, dt: 1 / 60 });
    if (e.leap > 0) e.leap = Math.max(0, e.leap - 1 / 60);
  }
  return e.x;
}

describe('the arc of a jump', () => {
  it('starts and ends on the ground, and is highest in the middle', () => {
    expect(leapHeight(JUMP.TIME), 'he starts the jump already off the ground').toBeCloseTo(0, 6);
    expect(leapHeight(0), 'he never comes down').toBeCloseTo(0, 6);
    expect(leapHeight(JUMP.TIME / 2)).toBeCloseTo(JUMP.RISE, 6);
    // and nothing outside the jump: a timer that has run past its end is not a hero underground
    expect(leapHeight(-1)).toBe(0);
  });

  it('goes higher than what it is allowed to clear', () => {
    // or a hero would pass through a rail he is visibly still standing behind, which reads as the
    // collision being broken — the exact impression this feature exists to remove
    expect(JUMP.RISE).toBeGreaterThan(JUMP.CLEARS);
  });
});

describe('what a jump gets you over', () => {
  it('a paddock rail, which you cannot walk through', () => {
    const fence = fieldWith(PropKind.Fence);
    const walker = hero(-3, 0);
    expect(walkEast(fence.world, walker, 3, false), 'he walked through the fence').toBeLessThan(0);

    const jumper = hero(-3, 0);
    expect(walkEast(fence.world, jumper, 3, true), 'the fence stopped a jump').toBeGreaterThan(1);
  });

  it('and not a boulder, which is head height', () => {
    const rock = fieldWith(PropKind.Boulder);
    const jumper = hero(-3, 0);
    const got = walkEast(rock.world, jumper, 3, true);
    expect(got, 'he jumped clean over a boulder').toBeLessThan(0);
  });

  it('and never a wall', () => {
    const house = fieldWith(PropKind.HousePlains);
    const jumper = hero(-4, 0);
    expect(walkEast(house.world, jumper, 4, true), 'he jumped into a house').toBeLessThan(-1);
  });
});

describe('a body that is over things', () => {
  it('is only over them while the jump lasts', () => {
    const fence = fieldWith(PropKind.Fence);
    const standing = bodyBox(KINDS.hero, 0, 0);
    const leaping = bodyBox(KINDS.hero, 0, JUMP.CLEARS);
    expect(fence.solids.at(0, 0, standing), 'the rail is not solid at all').toBe(true);
    expect(fence.solids.at(0, 0, leaping), 'the rail stopped somebody a foot above it').toBe(false);
  });

  it('is never over something nobody measured', () => {
    // a solid with no height is a thing whose maker did not say, and the safe reading of that is
    // "too high to clear" — a hole in the world is worse than a fence you have to walk round
    const solids = new Solids();
    solids.put('mystery', [{ x: 0, z: 0, rot: 0, hw: 0.4, hd: 0.4 }]);
    expect(solids.at(0, 0, bodyBox(KINDS.hero, 0, JUMP.CLEARS))).toBe(true);
  });
});

describe('a hero wedged against something', () => {
  it('can jump his way out of it', () => {
    // set down inside a barrel, which is the shape of the fault: being *put* somewhere is what
    // gets you into a solid, and every direction out of a tight one can fail a slide
    const barrel = fieldWith(PropKind.Barrel);
    const stuck = hero(0, 0);
    expect(barrel.world.blocked(stuck.x, stuck.z, bodyBox(KINDS.hero, 0, 0)), 'not stuck to begin with').toBe(true);

    stuck.leap = JUMP.TIME;
    for (let n = 0; n < 40; n++) {
      stride(barrel.world, stuck, { dx: 1, dz: 0, pace: 1, dt: 1 / 60 });
      stuck.leap = Math.max(0, stuck.leap - 1 / 60);
    }
    expect(barrel.world.blocked(stuck.x, stuck.z, bodyBox(KINDS.hero, 0, 0)), 'still in the barrel').toBe(false);
  });
});
