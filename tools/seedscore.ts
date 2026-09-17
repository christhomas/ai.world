/**
 * What a seed is worth, measured rather than argued about.
 *
 * #323 asks for seeds to stop being handed out blind: `title.ts` calls `randomSeed()` and four
 * billion worlds are equally likely, including the archipelago of nine-tile islands and the plain
 * with one village on it. The issue is explicit about the order the work goes in, and this is the
 * first half of it:
 *
 * > *Worth writing the measuring tool first and looking at a few hundred seeds before choosing a
 * > single threshold.*
 *
 * So this measures and prints a distribution. **It chooses nothing.** There is no score, no cut and
 * no rejection here, because a threshold picked before anybody has seen the spread is a threshold
 * picked by taste, and that is the failure mode the issue names.
 *
 * ## Why it can run at the moment somebody presses New World
 *
 * A patch of the endless country is grown by `growPatch`, and a grown patch already knows where its
 * villages are and answers `probe(x, z)` for any point in it without building a single chunk of
 * mesh. So the questions that decide whether a world is worth walking into — how much of it is
 * land, how many villages it planted, whether the first one has anywhere to walk to — are a few
 * hundred cheap lookups over one patch rather than a bench run.
 *
 * ## What it measures, and what it deliberately does not
 *
 * Four numbers per seed, all read off the home patch — the one the hero starts in, which is the one
 * that decides what a new player sees in their first ten minutes:
 *
 * - **land** — the share of sampled points that are dry. A world of open sea is the clearest bad
 *   seed there is, and the cheapest to spot.
 * - **whole** — how much of that land is in one piece. Two thousand seeds turned up no archipelago
 *   at all by `land` alone: the thinnest world in the sample is forty-five per cent land with three
 *   villages on it. One continent at that share is a fine world and forty islands at that share is
 *   not, and `land` reads the same for both — so this is the measure that can tell them apart.
 * - **villages** — how many the patch plants. Nought is a plain with nobody on it.
 * - **spread** — how far apart the two furthest-apart villages are, in tiles. Villages huddled in
 *   one corner of the patch is a different world from villages spread across it, and the count
 *   alone cannot tell them apart.
 * - **home** — tiles from where the hero stands to the nearest village in that patch. This is the
 *   walk before anything happens, and it is the number a new player feels first. A village over the
 *   patch boundary does not count: it is not grown yet when he arrives.
 *
 * Not measured: woods, seams and coasts within reach, which the issue also lists. Those want the
 * biome pie and a wider window than one patch, and adding them before anybody has looked at these
 * four would be building a score rather than a measurement.
 *
 *   chore seeds          # 200 seeds
 *   chore seeds -- 1000  # or as many as you like
 */
import { writeFileSync } from 'node:fs';
import { growPatch } from '../src/world/growworld';
import { boundsOf, PATCH, patchOf } from '../src/world/patchwork';
import { reportAt } from './reports';

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
const HOME = boundsOf(patchOf(0, 0));

export function readSeed(seed: number): Reading {
  const sampler = growPatch(seed, HOME);
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

/** The value at a place in a sorted list, so a spread can be described without a mean hiding it. */
export function at(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
  return sorted[i];
}

/** One column of the distribution, from lowest to highest. */
function column(name: string, values: readonly number[], places = 2): string {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const say = (n: number): string => (Number.isFinite(n) ? n.toFixed(places) : '—');
  const missing = values.length - sorted.length;
  return `${name.padEnd(10)} ${say(at(sorted, 0)).padStart(9)} ${say(at(sorted, 0.05)).padStart(9)}`
    + ` ${say(at(sorted, 0.25)).padStart(9)} ${say(at(sorted, 0.5)).padStart(9)}`
    + ` ${say(at(sorted, 0.75)).padStart(9)} ${say(at(sorted, 0.95)).padStart(9)}`
    + ` ${say(at(sorted, 1)).padStart(9)}${missing ? `   (${missing} with no village)` : ''}`;
}

export function report(readings: readonly Reading[]): string {
  const lines = [
    `${readings.length} seeds, each measured on its home patch (${PATCH} tiles square, ${GRID * GRID} probes).`,
    '',
    'No threshold is chosen here. See #323: the cut goes where the tail plainly is, and nobody can',
    'see where that is until the spread is on a page.',
    '',
    `${''.padEnd(10)} ${'lowest'.padStart(9)} ${'5%'.padStart(9)} ${'25%'.padStart(9)} ${'half'.padStart(9)} ${'75%'.padStart(9)} ${'95%'.padStart(9)} ${'highest'.padStart(9)}`,
    column('land', readings.map((r) => r.land), 3),
    column('whole', readings.map((r) => r.whole), 3),
    column('villages', readings.map((r) => r.villages), 0),
    column('spread', readings.map((r) => r.spread), 0),
    column('home', readings.map((r) => r.home), 0),
    '',
    'The ten thinnest worlds by land, which is where a bad seed shows first:',
    ...[...readings].sort((a, b) => a.land - b.land).slice(0, 10).map(
      (r) => `  ${String(r.seed).padStart(11)}  land ${r.land.toFixed(3)}  villages ${String(r.villages).padStart(2)}`
        + `  spread ${r.spread.toFixed(0).padStart(4)}  home ${Number.isFinite(r.home) ? r.home.toFixed(0) : '—'}`,
    ),
    '',
    'And the ten fattest, for the other end of the same question:',
    ...[...readings].sort((a, b) => b.land - a.land).slice(0, 10).map(
      (r) => `  ${String(r.seed).padStart(11)}  land ${r.land.toFixed(3)}  villages ${String(r.villages).padStart(2)}`
        + `  spread ${r.spread.toFixed(0).padStart(4)}  home ${Number.isFinite(r.home) ? r.home.toFixed(0) : '—'}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/* c8 ignore start -- the command line, which the test does not run */
if (process.argv[1]?.endsWith('seedscore.ts')) {
  const many = Number(process.argv[2]) || 200;
  const readings: Reading[] = [];
  const began = Date.now();
  for (let i = 0; i < many; i++) readings.push(readSeed((i * 2654435761) >>> 0));
  const text = `${report(readings)}\nMeasured in ${((Date.now() - began) / 1000).toFixed(1)}s.\n`;
  const to = reportAt('seeds-report.txt');
  writeFileSync(to, text);
  process.stdout.write(`${text}\nWritten to ${to}\n`);
}
/* c8 ignore stop */
