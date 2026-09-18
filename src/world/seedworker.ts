import type { CountryReply, CountryRequest } from './countrymessages';
import type { Reading } from './seedscore';

/**
 * Measuring a seed on a thread that is not the one drawing the game.
 *
 * #323 made the game refuse a world nobody would want to play, and #358 is what that cost: the
 * measuring is a whole patch grown, which is six hundred milliseconds on a desk and **fourteen
 * seconds** on a small ARM box. Done where the frames are, that is a page that stops painting at
 * the exact moment somebody has just asked for a new world — so the one thing the player sees of
 * this feature is the game appearing to hang.
 *
 * The worker that grows the country already exists and already does this work for its own reasons;
 * it answers a `measure` now as well as a `grow`. Nothing about the arrangement is new, which is
 * the argument for it: *"a patch is five seconds on this thread and a tenth of a second to put back
 * together from its parts, so the worker grows and the page rebuilds."*
 *
 * ## What it does not do
 *
 * The patch it grew to answer with is **thrown away**, and the game grows the same one again a
 * moment later when the world opens. That is the honest remaining cost and it is left alone here:
 * handing it over means agreeing with `growerFor` about who owns a `PatchParts` and when, which is
 * a change to the country's own plumbing rather than to the title screen. See #358.
 */
export interface SeedMeasurer {
  /** What this seed is worth, answered off the page. */
  measure: (seed: number) => Promise<Reading>;
  /** Done with it. A worker nobody closes is a thread that outlives the screen that made it. */
  close: () => void;
}

/**
 * One worker, borrowed for as long as the title screen needs it.
 *
 * Made here rather than shared with `growerFor`, and the reason is when rather than what: this runs
 * before any world exists, and the country's grower is built from a `PatchCountry` that the seed
 * has not been chosen for yet. Two short-lived threads at the title screen is a cheaper thing to
 * explain than a grower that has to exist before it has a country.
 */
export function measuringSeeds(): SeedMeasurer {
  const worker = new Worker(new URL('../workers/country.worker.ts', import.meta.url), { type: 'module' });
  /*
   * Answered by seed rather than in order.
   *
   * The worker takes one at a time and answers in the order asked, so a queue would do — but a map
   * keyed by what was asked cannot get out of step with what comes back, and a measurement that
   * came back against the wrong seed would hand somebody a world the game had rejected.
   */
  const waiting = new Map<number, (reading: Reading) => void>();
  worker.onmessage = (e: MessageEvent<CountryReply>) => {
    if (e.data?.type !== 'measured') return;
    const answer = waiting.get(e.data.seed);
    if (!answer) return;
    waiting.delete(e.data.seed);
    answer(e.data.reading);
  };
  return {
    measure: (seed) => new Promise<Reading>((answer) => {
      waiting.set(seed, answer);
      worker.postMessage({ type: 'measure', seed } satisfies CountryRequest);
    }),
    close: () => { waiting.clear(); worker.terminate(); },
  };
}
