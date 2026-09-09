import { packChunk, parcelKey, unpackChunk, type Parcel } from './chunkparcel';

/**
 * The country a page has already been sent, kept so it is never sent twice.
 *
 * The world is the same every time it is grown, so a chunk of it is worth exactly one journey down
 * the wire — ever. Fifty-three kilobytes to fill a view on the first visit and silence on every
 * visit after that, which is what makes an endless world affordable to stream at all: the cost is
 * paid per acre of new country rather than per hour of play.
 *
 * The danger in keeping it is staleness, and it is a worse danger than not keeping it. Ground saved
 * by an older generator, read back and drawn beside ground the server grew today, is two halves in
 * different countries — the fault all of this exists to end, arriving by the back door. So every key
 * carries a stamp of what made the country (`worldStamp`), and when generation moves the stamp moves
 * and every kept chunk becomes unreachable at once. There is no invalidation to get wrong.
 *
 * It lives with the world rather than with the saves, and the store it writes into is handed in
 * rather than reached for. That is what keeps it here: a chunk is a fact about the country, and the
 * only thing about this that belongs to a browser is where the bytes are put — so that part is a
 * port, which also makes it testable without one, and a page in a private window may have no store
 * at all. Nothing here fails when
 * there is nowhere to keep anything; it simply keeps nothing, and the world is sent again.
 */

/** The little of a key-value store this needs. `idb-keyval` satisfies it; so does a Map. */
export interface Keep {
  get(key: string): Promise<ArrayBuffer | undefined>;
  set(key: string, value: ArrayBuffer): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * How much country one world may keep.
 *
 * A chunk is about three and a half kilobytes, so this is some tens of megabytes — a good many hours
 * of walking, and well inside what a browser will hold without asking anybody's permission. Past it
 * the oldest are dropped, which costs one journey each if the player ever goes back.
 */
const CHUNKS_KEPT = 8_000;

export class ChunkStore {
  /**
   * @param stamp what made this country, from `worldStamp`. The whole of the staleness rule.
   */
  constructor(
    private readonly keep: Keep,
    private readonly seed: number,
    private readonly kind: string,
    private readonly stamp: string,
  ) {}

  private keyOf(cx: number, cz: number): string {
    return parcelKey(this.seed, this.kind, this.stamp, cx, cz);
  }

  /** The chunk, if this page has been sent it before and the country has not changed since. */
  async get(cx: number, cz: number): Promise<Parcel | null> {
    try {
      const bytes = await this.keep.get(this.keyOf(cx, cz));
      return bytes ? unpackChunk(bytes) : null;
    } catch {
      return null;                        // a store that will not answer is a store with nothing in it
    }
  }

  /** Keep a chunk the world has sent. Failure here costs a journey, so it is not worth reporting. */
  async put(parcel: Parcel): Promise<void> {
    try {
      await this.keep.set(this.keyOf(parcel.cx, parcel.cz), packChunk(parcel));
    } catch {
      // out of room, or no room at all: the world will send it again
    }
  }

  /**
   * Throw out what is no longer worth keeping, and say how much went.
   *
   * Two kinds of rubbish. Ground from a country that no longer exists — same world, older stamp —
   * which is not merely useless but dangerous, so it goes first and completely. And ground from this
   * country beyond what one world may keep, which is only bulk: the excess goes and costs a journey
   * apiece if anybody walks back.
   *
   * Other worlds are left alone. A player with three saves has three countries kept, which is what
   * they asked for by having three saves.
   */
  async sweep(): Promise<number> {
    let dropped = 0;
    try {
      const mine = `${this.seed}:${this.kind}:`;
      const current = `${mine}${this.stamp}:`;
      const keys = await this.keep.keys();
      const stale = keys.filter((key) => key.startsWith(mine) && !key.startsWith(current));
      for (const key of stale) { await this.keep.delete(key); dropped++; }

      const kept = keys.filter((key) => key.startsWith(current));
      for (const key of kept.slice(0, Math.max(0, kept.length - CHUNKS_KEPT))) {
        await this.keep.delete(key);
        dropped++;
      }
    } catch {
      // nothing to sweep, or nowhere to sweep it: neither is worth a word to the player
    }
    return dropped;
  }
}
