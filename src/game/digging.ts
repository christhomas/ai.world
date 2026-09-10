import { DIG, groundOf, richness, seamAt, type Find, type Ground } from '../world/seams';

// What the ground holds is a fact about the world and lives there; this is what a person with a
// spade does about it. Re-exported because everything that digs has always asked this file.
export { DIG, groundOf, richness, seamAt } from '../world/seams';
export type { Find, Ground } from '../world/seams';

/**
 * Digging: a shovel, a likely looking slope, and whatever the hill has been keeping.
 *
 * What lies under a tile is rolled from the world seed and the tile's own coordinates, so two
 * players who have never spoken turn up the same nugget on the same hillside and nothing has to
 * travel between them. It is a fact about the world rather than a thing that happens in it, which
 * is why nothing here is saved and nothing here is sent.
 *
 * The decision worth explaining is which holes are remembered: only the ones that paid. Barren
 * ground rolls barren for ever, so there is nothing to farm there and nothing to write down; that
 * leaves the memory small enough to keep in a session and throw away with it.
 */

const key = (tx: number, tz: number): string => `${Math.floor(tx)},${Math.floor(tz)}`;


/**
 * The holes dug this sitting. Local and unsaved on purpose: the seam is derivable, so the only
 * work left is stopping a player who has found one lucky tile from pressing Enter until they are
 * rich on it.
 */
export class Digging {
  private readonly order: string[] = [];
  private readonly dug = new Set<string>();

  /** Has this tile already given up what it had? */
  turned(tx: number, tz: number): boolean {
    return this.dug.has(key(tx, tz));
  }

  /**
   * Turn over a tile. Returns what came out, or null when the ground held nothing or has already
   * been dug. An empty hole is not remembered, because the roll will say the same next time.
   */
  dig(seed: number, tx: number, tz: number, ground: Ground): Find | null {
    if (this.turned(tx, tz)) return null;
    const found = seamAt(seed, tx, tz, ground);
    if (!found) return null;
    this.dug.add(key(tx, tz));
    this.order.push(key(tx, tz));
    if (this.order.length > DIG.HOLES) this.dug.delete(this.order.shift()!);
    return found;
  }
}
