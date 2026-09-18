import { partsOf } from '../world/endless';
import { growPatch } from '../world/growworld';
import { readSeed } from '../world/seedscore';
import { boundsOf } from '../world/patchwork';
import type { CountryRequest, CountryReply } from '../world/countrymessages';

/**
 * Growing a patch of the endless country, off the thread the game is drawn on.
 *
 * A patch takes about six hundred milliseconds and rebuilding one from its parts takes about
 * fifteen. That difference is the whole reason this file exists, and it is the *difference* rather
 * than either number: forty to one means the thread that draws the game can have a finished patch
 * for the price of a single frame, however long the growing itself happens to take this year.
 *
 * Both figures were an order of magnitude worse when this was written — five seconds to grow and a
 * tenth of a second to rebuild — and the five second freeze at every patch boundary was measured,
 * not guessed, on the first walk across an endless world, which stopped the game and did not come
 * back. The ratio survived the speed-up, which is why this file did too.
 *
 * So: the worker grows, the page rebuilds. What crosses is `PatchParts` — roads, water, buildings
 * and the cut rock — and what does not cross is the land itself, which is a pair of functions over
 * noise. Functions do not survive a `postMessage` and do not need to: they are a pure function of
 * the seed and cost nothing to make again on the other side. `rebuildPatch` is the one way either
 * side puts a patch together, and `patchwork.test.ts` holds it to painting the same tiles.
 *
 * One at a time, in the order asked. A worker that grew three patches at once would finish none of
 * them sooner and would hold three patches of country in memory to do it; the page asks for the one
 * it is walking into first, which is the one that matters.
 */

const post = (msg: CountryReply) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<CountryRequest>) => {
  const msg = e.data;
  const started = Date.now();
  if (msg.type === 'grow') {
    const sampler = growPatch(msg.seed, boundsOf(msg.patch));
    post({ type: 'grown', patch: msg.patch, parts: partsOf(sampler), took: Date.now() - started });
    return;
  }
  /*
   * And what a seed is worth, which is the same work under a different question.
   *
   * `readSeed` grows the home patch and probes it, so it costs what growing costs — six hundred
   * milliseconds on a desk and fourteen seconds on a small ARM box. On the thread that draws the
   * game that is a frozen page at the exact moment somebody has just asked for a new world, which
   * is #358. Here it is a page that keeps painting while the answer is worked out.
   *
   * The patch is thrown away rather than sent back. Handing it over would save the game growing the
   * same one again a moment later — worth doing, and a different change, because what crosses is
   * `PatchParts` and this would have to agree with `growerFor` about who owns it.
   */
  if (msg.type === 'measure') {
    post({ type: 'measured', seed: msg.seed, reading: readSeed(msg.seed), took: Date.now() - started });
  }
};
