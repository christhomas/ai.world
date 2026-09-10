/**
 * The little arithmetic a menu needs, out of the file that was full of it.
 *
 * `talk.ts` reached the length a person can hold in their head, on the day the shop counter
 * started paying its shopkeeper for real. What came out first is what was least about talking:
 * two functions that know nothing about a keeper, a village or a conversation, and are used by
 * the widgets a conversation is made of.
 *
 * The counter itself — three hundred lines of buying, selling, beds and the inn's shelf — is the
 * extraction this file is a down payment on. It is a bigger job than a late edit should be, and
 * naming it here is better than pretending the seam is not there.
 */

/**
 * Move a quantity by one, wrapping round the ends of its range.
 *
 * Wrapping rather than stopping is the whole of what makes the sell dial usable. The key handler
 * deliberately ignores auto-repeat, so a stack of twenty would be nineteen separate presses to
 * sell whole; from one, a single press of left lands on all of them, which is the number people
 * want most often after one.
 *
 * @param n where the dial is now, from 1 to count
 * @param dir -1 or 1
 * @param count how many there are, which is the top of the range
 */
export function stepWithin(n: number, dir: number, count: number): number {
  if (count <= 1) return 1;
  return ((n - 1 + dir) % count + count) % count + 1;
}

/** A sentence out of a fragment, for the notes under an item's name. */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
