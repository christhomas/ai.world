import type { PatchParts } from './endless';

/**
 * What the page and the country worker say to each other.
 *
 * Two messages, because there are two things to say: grow me this square, and here is that square.
 * Kept in a file of their own for the reason `messages.ts` is — a worker and its caller have to
 * agree about a shape neither of them owns, and a type that lives in one of them is a type the
 * other imports across a boundary it should not know the inside of.
 */

/** Page → worker. */
export type CountryRequest = { type: 'grow'; seed: number; patch: string };

/** Worker → page. */
export type CountryReply = {
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
