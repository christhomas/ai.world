import { partsOf, samplerIn } from '../world/endless';
import { boundsOf } from '../world/patchwork';
import type { CountryRequest, CountryReply } from '../world/countrymessages';

/**
 * Growing a patch of the endless country, off the thread the game is drawn on.
 *
 * A patch takes about five seconds. That number is the whole reason this file exists: on the main
 * thread it is a five second freeze at every patch boundary — measured, not guessed, on the first
 * walk across an endless world, which stopped the game and did not come back. Rebuilding one from
 * its parts takes about a tenth of a second, and that difference is the entire trick.
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
  if (msg.type !== 'grow') return;
  const started = Date.now();
  const sampler = samplerIn(msg.seed, boundsOf(msg.patch));
  post({ type: 'grown', patch: msg.patch, parts: partsOf(sampler), took: Date.now() - started });
};
