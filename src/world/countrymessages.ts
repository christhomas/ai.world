import type { PatchParts } from './endless';
import type { Reading } from './seedscore';

/**
 * What the page and the country worker say to each other.
 *
 * Four messages, because there are two things to say and two to answer. Grow me this square, and
 * here is that square. Measure me this seed, and here is what it is worth — which is the same work
 * the growing does and is asked for its own reason: #358, where a world being chosen froze the page
 * for as long as it took to grow a patch on the thread that draws it.
 * Kept in a file of their own for the reason `messages.ts` is — a worker and its caller have to
 * agree about a shape neither of them owns, and a type that lives in one of them is a type the
 * other imports across a boundary it should not know the inside of.
 */

/** Page → worker. */
export type CountryRequest = CountryGrow | CountryMeasure;

/** Grow me this square. The only thing `Grower` ever asks for. */
export type CountryGrow = { type: 'grow'; seed: number; patch: string };

/** And what a seed is worth, which nothing growing the country ever asks. */
export type CountryMeasure =
  /**
   * What a seed is worth, measured where it costs nobody a frame.
   *
   * The patch it grows to find out is thrown away, which is the honest cost of this and is written
   * down in #358: the game grows the same one again when the world opens. What is bought is that
   * the page stays alive while it happens.
   */
  { type: 'measure'; seed: number };

/** Worker → page. */
export type CountryReply =
  | CountryGrown
  | { type: 'measured'; seed: number; reading: Reading; took: number };

export type CountryGrown = {
  type: 'grown';
  patch: string;
  parts: PatchParts;
  /**
   * How long it took, in milliseconds.
   *
   * Sent because it is the number this whole arrangement exists because of, and a number nobody can
   * see is a number that quietly stops being true. A debug readout shows it; if it ever comes back
   * at a tenth of what it is now, the worker is not worth its complexity and somebody should know.
   */
  took: number;
};
