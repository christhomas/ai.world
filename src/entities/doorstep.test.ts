import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Solids } from '../world/solids';
import { KINDS } from './animals';
import { Entity, Herd, updateEntity, type TileWorld } from './entity';
import { stepToward } from './walking';
import { CREATURE_VERBS } from './verbs';

/**
 * 65a. They walk home and do not arrive.
 *
 * What the browser showed at one in the morning: villagers saying "at home", standing on the street,
 * identical to a tenth of a tile over eighty seconds. `nightfall.test.ts` found the world's villagers
 * do walk and some do get in, so whatever holds the rest is not the day and not the ground.
 *
 * The suspicion this file measures is the walk itself. A villager going home is aimed at his door
 * in a straight line, and nothing else: no path, no way round. `tryMove` slides along a wall at an
 * angle, but a man standing square behind his own house has no angle to slide along — every step
 * toward the door is a step into the back wall. The step is refused, `updateEntity` stands him idle,
 * and on the next tick `goTo` sees he is still too far off and sets him walking into the wall again.
 * He never moves, and he never stops trying, which is exactly what the browser measured.
 */

/** One cottage on a flat green, drawn the size a cottage's walls are: 2.4 tiles square. */
function greenWithACottage(): TileWorld {
  const solids = new Solids();
  solids.put('cottage', [{ x: 0.5, z: 0.5, hw: 1.2, hd: 1.2, rot: 0 }]);
  return {
    heightAt: () => 0.5,
    waterAt: () => null,
    blocked: (x, z, body) => solids.at(x, z, body),
    isRoad: () => false,
    crosses: (x0, z0, x1, z1, body) => solids.crosses(x0, z0, x1, z1, body),
    depth: (x, z, body) => solids.depth(x, z, body),
  };
}

/** The cottage's front door, where `street.ts` puts a villager's home post: the door tile's middle. */
const DOOR: [number, number] = [0.5, 2.5];

function villagerAt(x: number, z: number): Entity {
  const herd = new Herd(KINDS.villager, x, z, x, z, 10);
  const e = new Entity(KINDS.villager, x, z, herd, 'doorstep', mulberry32(3));
  e.y = 0.5;
  herd.members.push(e);
  e.posts = { home: DOOR };
  return e;
}

/**
 * Send him home and let the world run, the way the manager does: his tree, then his feet.
 *
 * Says whether he got in, and how close to his door he ever came — the second is the number the
 * worklist asked for, because a walk that plateaus short of the door is the fault and a walk that is
 * merely slow is not.
 */
function sendHome(world: TileWorld, e: Entity, seconds: number): { indoors: boolean; closest: number } {
  const home = CREATURE_VERBS.actions.goTo({ post: 'home', enter: true });
  const rng = mulberry32(9);
  const dt = 0.1;
  let closest = Infinity;
  for (let n = 0; n < Math.round(seconds / dt); n++) {
    updateEntity(e, dt, {
      world, rng, playerX: 999, playerZ: 999, playerArmed: false, time: 0.02,
      treeFor: () => home,
      onAttack: () => {},
    });
    closest = Math.min(closest, Math.hypot(e.x - DOOR[0], e.z - DOOR[1]));
    if (e.indoors) break;
  }
  return { indoors: e.indoors, closest };
}

describe('a villager walking home at night', () => {
  it('gets in when nothing stands between him and his door', () => {
    // the control: if this is red, the harness is wrong and the case below says nothing
    const e = villagerAt(6.5, 6.5);
    const walk = sendHome(greenWithACottage(), e, 30);
    expect(walk.indoors, `never got in; came within ${walk.closest.toFixed(2)} of the door`).toBe(true);
  });

  /*
   * The corner the walk has to back out of, which the comment on `stepToward` has claimed all along
   * and nothing here covered — found by review rather than by anything going wrong, because a
   * villager pinned in one would look exactly like a villager who has stopped.
   *
   * A flat wall wants him to keep to one side: the far end is further than the near end for most of
   * the way, so a walker who reconsiders whenever the going is briefly bad turns back every time.
   * An inside corner wants the opposite — entered on the wrong side, *every* turn that way is into
   * one of the two walls, and keeping to it pins him there for good. The rule that serves both is
   * that a side is kept until it is exhausted rather than until it is inconvenient.
   *
   * So this asks the step itself rather than sending him home: put him in the corner facing the
   * wall with the wrong side already chosen, and the two things that have to be true are that he
   * moved at all and that he is going the other way round now. The second is the whole of the fix —
   * a walker who only ever tried his chosen side would have stood still with `side` unchanged.
   */
  it('backs out of an inside corner, where every turn one way is into a wall', () => {
    const solids = new Solids();
    // the wall in front of him, running east and west, with his door somewhere beyond it
    solids.put('north wall', [{ x: 0.55, z: 2.2, hw: 1.55, hd: 0.2, rot: 0 }]);
    // and the walls either shoulder, which are what make it a corner rather than a wall: with the
    // way ahead and both turns on one side into stone, that side is nothing but wall from here
    solids.put('east wall', [{ x: 1.65, z: 1.6, hw: 0.4, hd: 6, rot: 0 }]);
    solids.put('south wall', [{ x: 0.55, z: 0.9, hw: 1.55, hd: 0.15, rot: 0 }]);
    const world: TileWorld = {
      heightAt: () => 0.5,
      waterAt: () => null,
      blocked: (x, z, body) => solids.at(x, z, body),
      isRoad: () => false,
      crosses: (x0, z0, x1, z1, body) => solids.crosses(x0, z0, x1, z1, body),
      depth: (x, z, body) => solids.depth(x, z, body),
    };
    const e = villagerAt(1, 1.6);
    e.side = -1;  // into the corner: the way round that cannot work from here
    const stepped = stepToward(world, e, 0, 1, 0.5, mulberry32(4));
    expect(stepped, `pinned at ${e.x.toFixed(2)},${e.z.toFixed(2)}`).toBe(true);
    expect(e.side, 'still trying the side that is nothing but wall').toBe(1);
  });

  it('gets in from behind his own house, rather than standing against the back wall all night', () => {
    // square behind the cottage, so the straight line to the door goes through the middle of it
    const e = villagerAt(0.5, -4.5);
    const walk = sendHome(greenWithACottage(), e, 60);
    expect(
      walk.indoors,
      `a minute of walking and he is at ${e.x.toFixed(2)},${e.z.toFixed(2)}, `
        + `no closer than ${walk.closest.toFixed(2)} tiles to his own door`,
    ).toBe(true);
  });
});
