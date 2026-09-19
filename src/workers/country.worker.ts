import { partsOf } from '../world/endless';
import { growPatch } from '../world/growworld';
import { boundsOf } from '../world/patchwork';
import { HOME_PATCH, readGrown } from '../world/seedscore';
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
  /*
   * Measuring a seed is growing the square a new hero will stand in, and then reading it.
   *
   * Which is why it is answered here rather than anywhere else: it is this worker's own work with
   * a few hundred cheap probes on the end. The title screen used to do it on the thread it draws
   * on and froze for as long as it took — seconds, and four times that for a seed drawn badly. See
   * #358.
   *
   * And the patch goes back with the reading rather than being dropped on the floor. It was
   * dropped, and `growCountry` grew the very same square again the moment the world opened: two
   * grows for one world, and the second is the one somebody waits through behind a loading screen.
   * Measured over five seeds on the four-core ARM box, opening a world was 1,486–2,794 ms of
   * growing and is 31–53 ms of rebuilding.
   *
   * So what travels is the parts — the same ones a `grow` sends and for the same reason: a sampler
   * does not cross this boundary, and the six milliseconds it costs to copy them is paid against
   * the two seconds it saves.
   */
  if (msg.type === 'measure') {
    const home = growPatch(msg.seed, boundsOf(HOME_PATCH));
    post({
      type: 'measured', seed: msg.seed, reading: readGrown(msg.seed, home),
      patch: HOME_PATCH, parts: partsOf(home), took: Date.now() - started,
    });
    return;
  }
  if (msg.type !== 'grow') return;
  const sampler = growPatch(msg.seed, boundsOf(msg.patch), msg.layers);
  post({ type: 'grown', patch: msg.patch, parts: partsOf(sampler), took: Date.now() - started });
};
