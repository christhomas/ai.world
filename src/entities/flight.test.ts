import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { Entity, Herd, updateEntity, updateHerd, type Ctx, type TileWorld } from './entity';
import { mulberry32 } from '../core/rng';
import { treeFor } from './behaviours';

/**
 * A bird flies at the height it was told to fly at.
 *
 * It did not. `patrol` lifts a flier towards its altitude at `dt * 2` a tick, and the ground-follow
 * at the end of every update pulled everything down at `dt * 12` — so a bird's height was the fixed
 * point of two filters fighting, and neither the altitude in `properties/` nor anything else chose
 * it. Worked out before the fix: an eagle asking for nine tiles above ground of height one settles
 * at 1.82 at thirty frames a second and at exactly 1.0, flat on the grass, at ten.
 *
 * The frame-rate part is what makes it a bug rather than a badly chosen constant, and it is why
 * this test runs the same bird at two different tick lengths: a height that changes when the
 * machine gets busy is not a height.
 */

/** Flat ground at height one, which is all a bird needs to be over. */
const flatland: TileWorld = {
  heightAt: () => 1,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

function flyFor(seconds: number, dt: number): number {
  const kind = KINDS.eagle;
  const herd = new Herd(kind, 0, 0, 0, 0, 40);
  const bird = new Entity(kind, 0, 0, herd, '0,0', mulberry32(7));
  herd.members.push(bird);
  bird.y = 1;
  // the anchor first and then the minds, exactly as the chunk manager ticks them: `patrol` reads
  // the herd's own base height, and a herd that has never been updated has not got one
  const ctx: Ctx = {
    world: flatland, rng: mulberry32(11), playerX: 1e6, playerZ: 1e6,
    playerArmed: false, playerAfloat: false, treeFor, time: 0.5, onAttack: () => {},
  };
  for (let t = 0; t < seconds; t += dt) { updateHerd(herd, dt, ctx); updateEntity(bird, dt, ctx); }
  return bird.y;
}

describe('how high a bird flies', () => {
  const wanted = 1 + (KINDS.eagle.altitude ?? 0);

  it('gets somewhere near the altitude it was given', () => {
    // measured after the fix: 10.20 against a wanted 10, the difference being the slow sine that
    // makes a circling bird rise and fall. Before it: 1.82, and 1.00 at ten frames a second
    const y = flyFor(20, 1 / 30);
    expect(y, `an eagle told to fly at ${KINDS.eagle.altitude} is at ${y.toFixed(2)} over ground of 1`)
      .toBeGreaterThan(wanted - 1.5);
  });

  it('flies at the same height however fast the machine is running', () => {
    // the old behaviour: 1.82 at thirty frames a second, 1.0 at ten. A bird that lands when the
    // machine gets busy is a bird whose height was never a decision.
    const fast = flyFor(20, 1 / 60), slow = flyFor(20, 1 / 10);
    expect(Math.abs(fast - slow), `a bird flies at ${fast.toFixed(2)} on a fast machine and ${slow.toFixed(2)} on a slow one`)
      .toBeLessThan(1);
  });

  it('still puts everything else on the ground', () => {
    const kind = KINDS.wolf;
    const herd = new Herd(kind, 0, 0, 0, 0, 20);
    const wolf = new Entity(kind, 0, 0, herd, '0,0', mulberry32(3));
    herd.members.push(wolf);
    wolf.y = 6;
    const ctx: Ctx = {
      world: flatland, rng: mulberry32(5), playerX: 1e6, playerZ: 1e6,
      playerArmed: false, playerAfloat: false, treeFor, time: 0.5, onAttack: () => {},
    };
    for (let t = 0; t < 5; t += 1 / 30) { updateHerd(herd, 1 / 30, ctx); updateEntity(wolf, 1 / 30, ctx); }
    expect(wolf.y, `a wolf dropped from the sky settled at ${wolf.y.toFixed(2)} rather than on the ground`)
      .toBeCloseTo(1, 1);
  });
});
