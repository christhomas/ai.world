import type { PatchParts } from './endless';
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
  | { type: 'grow'; seed: number; patch: string }
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
