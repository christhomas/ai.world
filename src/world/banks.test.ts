import { describe, expect, it } from 'vitest';
import { generateWebGraph } from './roadweb';
import { TerrainSampler, TileType } from './terrain';

/**
 * The walls a river leaves in the country beside it.
 *
 * The ground comes down to meet water — that is `cutForWater`, and it is why a road crossing high
 * country with a river in it is not left standing on a causeway. It was asked of the *nearest*
 * water body, and the worst wall in the world came out of that: at 158,-158 on seed 1, two
 * neighbouring tiles both of which are road, thirteen terraces apart, because the nearest water
 * changed hands between them from one whose surface is at terrace 38 to one at 22. Both bodies were
 * near both tiles the whole time; only which one was *nearest* changed.
 *
 * Every water near a point constrains the ground independently, so the binding one is the lowest
 * and not the closest. The measurement that found it is the one below: the worst step between two
 * neighbouring tiles of walkable land, and the worst between two tiles that are both road — because
 * a step in the middle of a highway is the one nobody can explain away.
 */

/** The shape `sampleTile` fills in. */
const fresh = () => ({
  type: 0, water: 0, shore: 0, bank: false, level: 0, height: 0, base: 0,
  roadDist: 0, roadWidth: 0, sloped: false, biome: 0, corners: [0, 0, 0, 0],
} as never);

/** Water is not a wall: a road at fifteen beside seabed at nought is a coast. */
const wet = (t: number): boolean =>
  t === TileType.Water || t === TileType.Seabed || t === TileType.Bridge;

function worstSteps(seed: number, reach = 260) {
  const s = new TerrainSampler(generateWebGraph(seed));
  const a = fresh(), b = fresh();
  let worst = 0, road = 0, pairs = 0;
  for (let z = -reach; z < reach; z += 2) {
    for (let x = -reach; x < reach; x += 2) {
      s.sampleTile(x, z, a);
      s.sampleTile(x + 1, z, b);
      const A = a as unknown as { type: number; height: number };
      const B = b as unknown as { type: number; height: number };
      if (A.type === TileType.Skip || B.type === TileType.Skip) continue;
      if (wet(A.type) || wet(B.type)) continue;
      pairs++;
      const step = Math.abs(A.height - B.height);
      if (step > worst) worst = step;
      if (A.type === TileType.Road && B.type === TileType.Road && step > road) road = step;
    }
  }
  return { worst, road, pairs };
}

describe('what a bank does to the ground beside it', () => {
  it('leaves no stair in the middle of a road', () => {
    /*
     * Five units, which is about ten terraces, and it is a bound rather than a target. It was 6.55
     * on seed 1 and 6.01 on seed 7 when the cut was taken from the nearest water alone; against
     * every water it is 4.91 and 3.16. The bound is set above both so that this fails when
     * something puts a stair back, and not when a road happens to climb a little harder.
     */
    for (const seed of [1, 7]) {
      const { road, pairs } = worstSteps(seed);
      expect(pairs, 'nothing was measured at all').toBeGreaterThan(10_000);
      expect(road, `seed ${seed} has a ${road.toFixed(2)} stair between two road tiles`)
        .toBeLessThan(5);
    }
  });

  it('leaves the country walkable, mountains excepted', () => {
    // mountains are built as polygons and are meant to be steep; this is the rest of the world
    for (const seed of [1, 7]) {
      const { worst } = worstSteps(seed);
      expect(worst, `seed ${seed} has a ${worst.toFixed(2)} wall in open country`).toBeLessThan(9);
    }
  });
});
