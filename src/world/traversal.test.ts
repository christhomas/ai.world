import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from './graph';
import { TerrainSampler, TileType } from './terrain';
import { KINDS } from '../entities/animals';
import { STEP_LIMIT } from '../entities/entity';

/**
 * Everywhere the game sends you has to be somewhere you can walk to.
 *
 * The terrain climbs away from the road, so the height of a piece of ground is decided by how far
 * off the road it is. That makes the roads passes by construction and villages safe, because
 * villages sit on roads — but points of interest do not. A shrine or a ruin is placed at a lateral
 * distance from its road node, out where the ground is high, so anything that makes the ground
 * rise faster can put one on the wrong side of a step the hero cannot climb. Nothing in the game
 * would say so: the quest naming it would simply become impossible.
 *
 * So this walks the world the way the hero does and insists every named place can be reached from
 * the village they start in. It is terrain connectivity only — it takes no account of buildings,
 * boats or ferries — which is exactly the thing that terrain changes threaten.
 */

/** How far up the hero can step, taken from the hero rather than repeated here. */
const CLIMB = KINDS.hero.climb ?? STEP_LIMIT;

/** Tiles either side of the origin to walk. Wide enough to hold a dozen villages of most seeds. */
const REACH = 280;

/**
 * The eight ways the hero can step. `tryMove` tries the diagonal first and only then slides along
 * each axis, so somebody walking really does cross corners; a four-way fill is stricter than the
 * game and reports landmarks stranded that anybody could walk to.
 */
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

interface Walked {
  reached: (x: number, z: number) => boolean;
  tiles: number;
}

/** Flood-fill outward from a point, stepping only where the hero could actually step. */
function walkFrom(sampler: TerrainSampler, fromX: number, fromZ: number): Walked {
  const size = REACH * 2;
  const height = new Float32Array(size * size);
  const land = new Uint8Array(size * size);
  const sample = sampler.newSample();
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      sampler.sampleTile(x - REACH, z - REACH, sample);
      height[z * size + x] = sample.height;
      land[z * size + x] = sample.type === TileType.Water ? 0 : 1;
    }
  }

  const seen = new Uint8Array(size * size);
  const start = (Math.round(fromZ) + REACH) * size + (Math.round(fromX) + REACH);
  const stack = [start];
  seen[start] = 1;
  let tiles = 1;
  while (stack.length > 0) {
    const here = stack.pop()!;
    const x = here % size, z = (here / size) | 0;
    for (const [dx, dz] of STEPS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const there = nz * size + nx;
      if (seen[there] === 1 || land[there] === 0) continue;
      if (Math.abs(height[there] - height[here]) > CLIMB) continue;
      seen[there] = 1;
      tiles++;
      stack.push(there);
    }
  }

  return {
    tiles,
    reached: (x, z) => {
      const ix = Math.round(x) + REACH, iz = Math.round(z) + REACH;
      if (ix < 0 || iz < 0 || ix >= size || iz >= size) return false;
      return seen[iz * size + ix] === 1;
    },
  };
}

/** Only judge places well inside the window, so the edge of the search is never the reason. */
const inside = (p: { x: number; z: number }): boolean =>
  Math.abs(p.x) < REACH - 4 && Math.abs(p.z) < REACH - 4;

describe('everywhere the game names can be walked to', () => {
  for (const seed of [1, 2]) {
    it(`seed ${seed}: no village or landmark is cut off`, () => {
      const sampler = new TerrainSampler(generateRoadGraph(seed));
      const home = sampler.structures.villages[0];
      const walked = walkFrom(sampler, home.x, home.z);

      const villages = sampler.structures.villages.filter(inside);
      const pois = sampler.structures.pois.filter(inside);
      expect(villages.length, 'nothing to judge').toBeGreaterThan(2);
      expect(pois.length, 'nothing to judge').toBeGreaterThan(2);

      const stranded = [...villages, ...pois]
        .filter((p) => !walked.reached(p.x, p.z))
        .map((p) => `${p.name} (${Math.round(p.x)}, ${Math.round(p.z)})`);
      expect(stranded, `walled off from ${home.name}`).toEqual([]);
    });
  }

  it('the hero can climb one terrace and no more', () => {
    // the whole shape of the world rests on this: one terrace is a step, two is a wall
    expect(CLIMB).toBeGreaterThanOrEqual(0.5);
    expect(CLIMB).toBeLessThan(1);
  });
});
