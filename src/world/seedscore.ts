/**
 * What a seed is worth, measured rather than argued about.
 *
 * #323 asks for seeds to stop being handed out blind: `title.ts` calls `randomSeed()` and four
 * billion worlds are equally likely, including the archipelago of nine-tile islands and the plain
 * with one village on it.
 *
 * This is the measuring half. It **chooses nothing** — there is no score and no cut here, because
 * a threshold belongs where the thing that rejects on it is, and this is what both that and the
 * distribution tool read. `tools/seedscore.ts` prints the spread; `world/goodseed.ts` decides.
 *
 * ## Why it can run at the moment somebody presses New World
 *
 * A patch of the endless country is grown by `growPatch`, and a grown patch already knows where its
 * villages are and answers `probe(x, z)` for any point in it without building a single chunk of
 * mesh. So the questions that decide whether a world is worth walking into — how much of it is
 * land, how many villages it planted, whether the first one has anywhere to walk to — are a few
 * hundred cheap lookups over one patch rather than a bench run.
 *
 * ## Why it lives in `src` rather than in `tools`
 *
 * Because the game has to reach it. Nothing under `src` imports from `tools` except tests, and the
 * rejection this feeds runs when a player opens a world. The tool imports it from here instead,
 * which also means the distribution on the page and the distribution in the report are measured by
 * the same code rather than by two copies that agree until they do not.
 *
 * ## What it measures, and what it deliberately does not
 */
import { growPatch } from './growworld';
import { boundsOf, PATCH, patchOf } from './patchwork';
import type { TerrainSampler } from './terrain';

/** One seed, as four numbers. */
export interface Reading {
  seed: number;
  /** Share of sampled points that are dry land, 0 to 1. */
  land: number;
  /**
   * Share of the dry land that is in one piece, 0 to 1.
   *
   * One continent at forty-five per cent land is a fine world; forty islands at forty-five per
   * cent is not, and `land` reads the same for both. This is what separates them.
   */
  whole: number;
  villages: number;
  /** Tiles between the two furthest-apart villages, or 0 for fewer than two. */
  spread: number;
  /** Tiles from the origin to the nearest village, or Infinity for a patch with none. */
  home: number;
}

/**
 * How many points across the patch are probed, per side.
 *
 * Twenty-five squared is six hundred and twenty-five samples over five hundred and twelve tiles —
 * one every twenty tiles or so, which is finer than a village is wide and coarse enough that a
 * seed costs milliseconds. Land is a large-scale fact; nothing here is trying to find a pond.
 */
export const GRID = 25;

/**
 * The home patch: the square of country the hero is standing in when a world opens.
 *
 * Asked of the game rather than written out, so it cannot drift from it. A new hero starts at the
 * origin (`main.ts`), which is the *corner* of patch `0,0` — so this is the quarter of the country
 * around him that gets grown first, not a square centred on him. That is the right window all the
 * same: it is what the page builds before anything else, and what a new player walks into.
 */
export const HOME_PATCH = patchOf(0, 0);
const HOME = boundsOf(HOME_PATCH);

/**
 * A seed, read off a patch of it somebody has already grown.
 *
 * Split out of `readSeed` because the growing is the whole cost and the patch is worth keeping:
 * the country worker grows the home patch to answer a measurement and the world then opens with
 * that same patch rather than growing it again. See #358, and `country.worker.ts`, which is the
 * one caller that has the sampler in its hand at the moment the reading is made.
 */
export function readGrown(seed: number, sampler: TerrainSampler): Reading {
  const land: boolean[] = [];
  let dry = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = HOME.x0 + ((i + 0.5) / GRID) * (HOME.x1 - HOME.x0);
      const z = HOME.z0 + ((j + 0.5) / GRID) * (HOME.z1 - HOME.z0);
      const isLand = sampler.probe(x, z).land;
      land[i * GRID + j] = isLand;
      if (isLand) dry++;
    }
  }
  const samples = GRID * GRID;
  const villages = sampler.structures.villages;
  let spread = 0;
  for (let i = 0; i < villages.length; i++) {
    for (let j = i + 1; j < villages.length; j++) {
      spread = Math.max(spread, Math.hypot(villages[i].x - villages[j].x, villages[i].z - villages[j].z));
    }
  }
  const home = villages.reduce((near, v) => Math.min(near, Math.hypot(v.x, v.z)), Infinity);
  return { seed, land: dry / samples, whole: biggestPiece(land), villages: villages.length, spread, home };
}

/** The same reading, for a caller with nothing but the seed: it grows the home patch to make it. */
export function readSeed(seed: number): Reading {
  return readGrown(seed, growPatch(seed, HOME));
}

/**
 * How much of the dry land is in one piece: the largest connected run of it, as a share of all of it.
 *
 * A flood fill over the sample grid, four-connected. Four rather than eight on purpose — two
 * islands touching at a corner are two islands to anybody walking, and a measure that joined them
 * would call an archipelago a continent, which is the exact mistake this exists to catch.
 *
 * One for a world with no land at all, because a world with nothing to stand on is not an
 * archipelago problem and should not be reported as one. `land` already says that world is empty.
 */
export function biggestPiece(land: readonly boolean[], side = GRID): number {
  const all = land.reduce((many, one) => many + (one ? 1 : 0), 0);
  if (all === 0) return 1;
  const seen = new Uint8Array(land.length);
  let biggest = 0;
  for (let at = 0; at < land.length; at++) {
    if (!land[at] || seen[at]) continue;
    let size = 0;
    const edge = [at];
    seen[at] = 1;
    for (let i = 0; i < edge.length; i++) {
      const here = edge[i];
      size++;
      const x = Math.floor(here / side), y = here % side;
      const round = [
        x > 0 ? here - side : -1,
        x < side - 1 ? here + side : -1,
        y > 0 ? here - 1 : -1,
        y < side - 1 ? here + 1 : -1,
      ];
      for (const next of round) {
        if (next < 0 || seen[next] || !land[next]) continue;
        seen[next] = 1;
        edge.push(next);
      }
    }
    biggest = Math.max(biggest, size);
  }
  return biggest / all;
}
