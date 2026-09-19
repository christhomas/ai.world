import type { PatchParts } from './endless';
import type { Highland } from './highland';
import type { Reading } from './seedscore';

/**
 * What the page and the country worker say to each other.
 *
 * Two things to say about a square — grow me this one, here is that one — and two about a seed:
 * measure this one, here is what it reads. The second pair is the same work as the first with the
 * patch thrown away instead of sent, which is why it belongs on the same worker rather than a new
 * one: a seed is measured by growing its home patch, and growing a patch is what this worker is.
 * Kept in a file of their own for the reason `messages.ts` is — a worker and its caller have to
 * agree about a shape neither of them owns, and a type that lives in one of them is a type the
 * other imports across a boundary it should not know the inside of.
 */

/** Page → worker. */
export type CountryRequest =
  | {
    type: 'grow'; seed: number; patch: string;
    /**
     * The world's elevation layers, sent with every ask rather than once at start-up.
     *
     * A worker told the seed and not the list would grow a country of the right shape at the wrong
     * height and hand it back as finished ground. It goes with each request because the request is
     * the only thing there is: this worker is handed no world to remember.
     */
    layers: readonly Highland[];
  }
  /**
   * Measure this seed, and do it over there.
   *
   * The title screen drew a seed, measured it on the thread it draws on, and froze — fourteen
   * seconds on a slow machine, because a measurement grows a whole patch and a rejected seed grows
   * another. See #358. The `setTimeout` it used bought one paint of *"Finding a world worth walking
   * into…"* and nothing after it; the spinner could not spin.
   */
  | { type: 'measure'; seed: number };

/** Worker → page. */
export type CountryReply =
  | {
    type: 'measured';
    seed: number;
    reading: Reading;
    /**
     * Which square was grown to read it, and the parts of it — because the patch is not thrown
     * away any more.
     *
     * Measuring a seed grows the square a new hero stands in, and the game used to grow that very
     * same square again the moment the world opened: two goes at the same two seconds for one
     * world. So the patch comes back with the reading and the world opens with it. It is the parts
     * rather than the patch for the reason `grown` below is: a sampler does not cross a worker
     * boundary and does not need to. See #358.
     */
    patch: string;
    parts: PatchParts;
    /** How long the measurement took, for the same reason `took` is sent below. */
    took: number;
  }
  | {
    type: 'grown';
    patch: string;
    parts: PatchParts;
    /**
     * How long it took, in milliseconds.
     *
     * Sent because it is the number this whole arrangement exists because of, and a number nobody
     * can see is a number that quietly stops being true. A debug readout shows it; if it ever comes
     * back at a tenth of what it is now, the worker is not worth its complexity and somebody should
     * know.
     */
    took: number;
  };
