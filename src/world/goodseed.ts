import { readSeed, type Reading } from './seedscore';
import type { CountryReply, CountryRequest } from './countrymessages';

/**
 * Drawing a world somebody would want to play, rather than the first number that came up.
 *
 * #323. `randomSeed()` hands out one of four billion worlds with no opinion about any of them, so
 * the first thing a new player sees is whatever that roll produced — an archipelago of nine-tile
 * islands, a plain with one village on it, a coast with no wood behind it. Nothing in the game knew
 * the difference.
 *
 * ## Roll and reject, not a curated list
 *
 * The issue weighs both and the argument against a list is the one that decides it: every player
 * would get the same handful of worlds, and *"the endless country's whole claim — that it goes on
 * for ever and is different everywhere — quietly becomes a lie at the one moment a player meets
 * it."* So the variety is kept whole and only the tail is cut. Nothing is stored.
 *
 * ## Where the numbers come from, which is the whole of whether this is honest
 *
 * The failure mode of this idea is *"a score somebody tuned by taste until it agreed with them"*.
 * So there is no score here. There are four bars, each a separate question with its own answer, and
 * each sits where a measured distribution plainly falls away rather than where a number looks tidy.
 * `chore seeds` is what measured it; the run is quoted on each bar.
 *
 * A seed is rejected or it is not. Nothing is ranked, nothing is weighted, and no seed is ever
 * called better than another — because the moment one is, somebody has to defend the weights.
 */

/**
 * What a seed has to clear before the game will hand it to anybody.
 *
 * One bar, and the shortness of this list is the result rather than a first draft. Two hundred
 * seeds were measured with `chore seeds` and the spread is `docs/reports/seeds-report.txt`:
 *
 * ```
 *               lowest        5%       25%      half       75%       95%   highest
 * land           0.515     0.653     0.742     0.798     0.848     0.923     0.997
 * whole          0.717     0.901     0.994     1.000     1.000     1.000     1.000
 * villages           0         2         4         7         9        13        18
 * spread             0        98       329       428       489       583       669
 * home              31       105       174       241       320       444       570
 * ```
 *
 * **`land` and `whole` get no bar, because there is no tail to cut.** The thinnest world in two
 * hundred is still fifty-one per cent dry, and the most broken-up still has seventy-two per cent of
 * its land in one piece. The archipelago of nine-tile islands the issue worries about did not turn
 * up once. A bar at, say, forty per cent land would look like protection and would never once fire,
 * which is worse than no bar at all — it is a guard nobody would think to check.
 *
 * **`home` gets no bar either**, and this is the one worth being careful about. It runs 31 → 105 →
 * 241 → 444 → 570 with no cliff anywhere in it. There is no tail there, only a long slope, so any
 * cut would be somebody deciding how far a player should have to walk — which is exactly the *"score
 * somebody tuned by taste until it agreed with them"* the issue names as this idea's failure mode.
 * If a walk of five hundred tiles is too far, that is a judgement about the game and it should be
 * argued as one, with its own issue, rather than smuggled in here as a measurement.
 *
 * **`villages` gets the only bar, and the data puts it there rather than taste.** The floor is
 * nought: a patch with nobody in it at all turned up in the sample, and `home` reported it as a
 * world with no village to walk to. That is the plain in the issue's own first sentence. One
 * village is the same fault one step up, and `spread` says so in its own terms — the distance
 * between the two furthest-apart villages is **0** at the bottom of the range, which is what a
 * world with fewer than two villages measures. A place to go is the issue's own criterion:
 * *"whether the first village has anywhere to walk to"*.
 */
export const WORTH = {
  /**
   * The fewest villages the home patch may plant.
   *
   * Two, not one. One is somewhere to be and nowhere to go, and a world whose only village is the
   * one you are standing in has nothing in it that a walk leads to.
   */
  VILLAGES: 2,
} as const;

/** How many worlds to draw before settling for the first one. See `aWorldWorthOpening`. */
export const TRIES = 4;

/**
 * What is wrong with a seed, or nothing where nothing is.
 *
 * A sentence rather than a boolean, because the one thing anybody will want to know when this
 * rejects a world is *why* — and because a bar that cannot say what it caught is a bar nobody can
 * argue with later.
 */
export function whatIsWrongWith(reading: Reading): string | null {
  if (reading.villages < WORTH.VILLAGES) {
    return reading.villages === 0 ? 'nobody lives here' : 'nowhere to walk to';
  }
  return null;
}

/** Whether a seed is one the game would hand out unasked. */
export function worthPlaying(reading: Reading): boolean {
  return whatIsWrongWith(reading) === null;
}

/** A seed, and why it was the one handed back. */
export interface Drawn {
  seed: number;
  /** How many were drawn to get it, which is one on almost every world. */
  drawn: number;
  /** True where the bar was cleared, false where the tries ran out and the first was taken. */
  worth: boolean;
}

/**
 * Draw until one is worth opening, and never hand back nothing.
 *
 * The settling rule is the part worth stating. When the tries run out this returns the **first**
 * seed drawn rather than the best of them — because "the best of them" needs a ranking, a ranking
 * needs weights, and weights are the score this file exists not to have. A player who somehow drew
 * eight bad worlds in a row gets the world they would have got before any of this existed, which is
 * the honest floor: this can make the game better and it must never make it worse.
 *
 * With the bars set where they are, exhausting the tries is not something anybody will meet — but
 * the branch is what makes it safe to tighten them later.
 *
 * `draw` and `read` are handed in so that this is a pure decision: the caller owns `Math.random`
 * and owns how a patch is grown, and this owns only "how many times, and when to stop".
 */
export function aWorldWorthOpening(
  draw: () => number,
  read: (seed: number) => Reading = readSeed,
  tries = TRIES,
): Drawn {
  let first = 0;
  for (let drawn = 1; drawn <= Math.max(1, tries); drawn++) {
    const seed = draw();
    if (drawn === 1) first = seed;
    if (worthPlaying(read(seed))) return { seed, drawn, worth: true };
  }
  return { seed: first, drawn: Math.max(1, tries), worth: false };
}

/**
 * The same decision, for a reader that answers later.
 *
 * Measuring a seed grows a whole patch, which is seconds rather than milliseconds — so the title
 * screen asks a worker and waits rather than doing it on the thread it draws on. See #358, and
 * `country.worker.ts`, which answers because a measurement *is* a patch grown and thrown away.
 *
 * A twin rather than one function, and the duplication is deliberate: the sync one is what the
 * tests and the tools use and it has no reason to become a promise. What must not drift is the
 * *rule* — how many times, and what to do when the tries run out — so `goodseed.test.ts` runs the
 * two over the same readings and holds them to the same answer. If they ever disagree, that test is
 * the one that says so.
 */
export async function aWorldWorthOpeningAsync(
  draw: () => number,
  read: (seed: number) => Promise<Reading>,
  tries = TRIES,
): Promise<Drawn> {
  let first = 0;
  for (let drawn = 1; drawn <= Math.max(1, tries); drawn++) {
    const seed = draw();
    if (drawn === 1) first = seed;
    if (worthPlaying(await read(seed))) return { seed, drawn, worth: true };
  }
  return { seed: first, drawn: Math.max(1, tries), worth: false };
}

/**
 * A reader backed by the country worker, and the worker it is backed by.
 *
 * Its own function so the title screen holds a reader rather than a worker: what it wants is "read
 * me this seed", and the port, the listener and the tidying up are this file's business. `close`
 * because a title screen that opened a worker per drawn seed would leave one behind for every world
 * anybody looked at.
 *
 * One at a time, which is what the decision needs: `aWorldWorthOpeningAsync` asks for the next seed
 * only after the last has come back, so there is never more than one measurement in flight and no
 * queue to keep.
 */
export function seedsReadOffThread(): { read: (seed: number) => Promise<Reading>; close: () => void } {
  const worker = new Worker(new URL('../workers/country.worker.ts', import.meta.url), { type: 'module' });
  return {
    read: (seed) => new Promise<Reading>((answer) => {
      const hear = (e: MessageEvent<CountryReply>): void => {
        // the worker answers two questions; this one asked for a measurement of this seed
        if (e.data.type !== 'measured' || e.data.seed !== seed) return;
        worker.removeEventListener('message', hear);
        answer(e.data.reading);
      };
      worker.addEventListener('message', hear);
      worker.postMessage({ type: 'measure', seed } satisfies CountryRequest);
    }),
    close: () => worker.terminate(),
  };
}
