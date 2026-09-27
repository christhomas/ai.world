import { HYDRO } from '../core/config';
import { segDist2 } from './graph';
import { cutForWater, waterCeiling } from './highland';
import type { Simplex2D } from './noise';
import type { Lake } from './rivers';
import type { RiverSeg } from './window';

/**
 * What the water of a world does to the ground beside it.
 *
 * Split out of `terrain.ts` when that file reached the six hundred and sixty lines `chunking.test.ts`
 * leaves it, and it is a seam rather than a convenience: everything in here answers about a point
 * and a set of water bodies and knows nothing about roads, biomes, props or tiles. `banks.test.ts`
 * is its own test by subject even though it goes through a sampler to get here.
 *
 * The rule the whole file turns on is `waterCeiling` next door in `highland.ts`, and the lesson
 * behind it has now been learned three times: **ask every water, not the nearest one.** A point is
 * within reach of several bodies at different heights, each of them constrains the ground on its
 * own, and the binding constraint is the lowest — which is not the closest. Every version of this
 * that answered from the nearest body alone left a wall somewhere, because "which one is nearest"
 * changes between one tile and the tile beside it while both bodies stay exactly where they were.
 */

/** The water a sampler holds, in the terms this file reads it. */
export interface Waters {
  segs: ReadonlyArray<RiverSeg>;
  lakes: ReadonlyArray<Lake>;
  /** The wobble on a lake's rim, so a pond is not a circle. */
  noise: Simplex2D;
}

/**
 * Every water body in the candidate set, as how far outside it this point is and what terrace its
 * surface belongs to.
 *
 * Walked rather than reduced, because the two questions asked of it want different answers. What
 * the *nearest* water is decides whether you are standing in it. What *every* water is decides how
 * far the country has to come down and what terrace the water itself sits at — `valleyAt` below.
 */
export function eachWater(
  w: Waters, px: number, pz: number, cands: number[], saw: (wd: number, level: number) => void,
): void {
  const nSeg = w.segs.length;
  for (const i of cands) {
    if (i < nSeg) {
      const s = w.segs[i];
      const [d2, t] = segDist2(px, pz, s.ax, s.az, s.bx, s.bz);
      const width = s.wa + (s.wb - s.wa) * t;
      /*
       * Interpolated along the run rather than switched at its middle, which is where it used to
       * change hands. A river's nodes are five tiles apart and its level is the lowest ground it
       * has passed, so one step can drop a long way: on seed 27 a river falls from terrace 22 to
       * terrace 1 between two neighbouring nodes. Switched at the midpoint, that whole drop lands
       * on a single line, and the ground either side of it is cut to two different valleys —
       * 10.50 units apart at (-76, -192), which is a cliff in open country rather than a fall.
       * Sloped down the run it is two terraces to the tile, and the fall is still a fall, because
       * `valleyAt` takes the surface to its terrace: a river descending steps down one at a time
       * instead of once by twenty-one.
       */
      saw(Math.sqrt(d2) - width, s.la + (s.lb - s.la) * t);
    } else {
      const l = w.lakes[i - nSeg];
      const dx = px - l.x, dz = pz - l.z;
      const rr = l.r * (1 + 0.3 * w.noise.noise(px * 0.16, pz * 0.16));
      saw(Math.sqrt(dx * dx + dz * dz) - rr, l.level);
    }
  }
}

/** The nearest water to a point, which is what decides whether you are standing in one. */
export function waterAt(
  w: Waters, px: number, pz: number, cands: number[],
): { wd: number; level: number } | null {
  let best: { wd: number; level: number } | null = null;
  eachWater(w, px, pz, cands, (wd, level) => {
    if (!best || wd < best.wd) best = { wd, level };
  });
  return best;
}

/**
 * The valley a point is in: how much of its high country survives the water near it, and what
 * terrace that water sits at here.
 *
 * Two answers from one walk because they are one rule seen twice — `waterCeiling` — and because
 * every time they have been worked out separately they have disagreed. `country` is the cut, in
 * terraces above the road. `surface` is the same ceiling taken to its terrace, and it is what the
 * bank ring, the water's own surface and a bridge deck are all drawn at: a river's level is fixed
 * when it is routed, off country the cut had not touched yet, so left to its own level a river
 * comes out perched above the ground its valley leaves beside it.
 */
export function valleyAt(
  w: Waters, px: number, pz: number, cands: number[], country: number, roadLevel: number,
): { country: number; surface: number } {
  let ceiling = Infinity;
  eachWater(w, px, pz, cands, (wd, level) => {
    country = cutForWater(country, { wd, level }, roadLevel, HYDRO.BANK);
    ceiling = Math.min(ceiling, waterCeiling({ wd, level }, HYDRO.BANK));
  });
  // a waterfall is a terrace edge — `localwater.ts` says the same of the endless country's rivers.
  // Infinite where the candidate set was empty, and never read there.
  return { country, surface: Math.max(1, Math.floor(ceiling)) };
}
