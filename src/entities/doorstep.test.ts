import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Solids } from '../world/solids';
import { KINDS } from './animals';
import { Entity, Herd, updateEntity, type TileWorld } from './entity';
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
