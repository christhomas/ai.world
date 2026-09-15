import type { Change } from '../src/world/register';

/**
 * What has happened lately, kept so that somebody can watch it happen.
 *
 * The Domesday Book answers "what is true now". This is the other half of watching a world: what
 * *changed*, which nothing in the game keeps. `Register.advance` hands back every birth, death,
 * emptied village and resettlement as it lives the days — the exact list somebody would want — and
 * every caller has always thrown it away after acting on it, because nothing had a use for a
 * history.
 *
 * ## Why it is a ring and not a log
 *
 * A world that runs for a month is a world with tens of thousands of these in it, and there is no
 * version of "keep them all" that ends well: it grows without bound, it has to be written somewhere,
 * and it would have to be pruned by a rule nobody has agreed. What a person watching a world
 * actually wants is the last while — who has died since I looked, which village is emptying, is
 * anybody being born — and that is a fixed number of entries.
 *
 * So it is a ring of the most recent `KEEPS`, still a window rather than an unbounded history.
 * A server may give it an equally bounded durable copy; a browser or test may leave that out. The
 * register's own `Burial` list and world log remain separate records with separate purposes.
 *
 * ## What it deliberately does not do
 *
 * It does not decide what is interesting. Everything the register reports goes in, in the order it
 * was reported, and whoever is reading may filter. A chronicle that kept only deaths would be a
 * chronicle that could not answer why a village was emptying, and the day somebody wants births is
 * the day it turns out they were never kept.
 */

/** One thing that happened, with the moment it was noticed as well as the day it happened on. */
export interface Entry extends Change {
  /** Wall-clock milliseconds, so a reader can ask for whatever is newer than their last look. */
  at: number;
  /** A running number, so "what is new" survives two things happening in the same millisecond. */
  n: number;
}

/**
 * How many are kept.
 *
 * A thousand, which is a busy week in a world with twenty villages in it and about a hundred
 * kilobytes of memory. The number wants to be large enough that somebody looking once a minute
 * never misses anything and small enough that nobody has to think about it, and there is a wide
 * range where both are true.
 */
export const KEEPS = 1000;

/** The last while of a world's history, per world. */
export class Chronicle {
  private readonly entries: Entry[] = [];
  private next = 1;

  constructor(
    initial: readonly Entry[] = [],
    private readonly persist?: (entries: readonly Entry[]) => void,
    next?: number,
  ) {
    const ordered = [...initial].sort((a, b) => a.n - b.n).slice(-KEEPS);
    this.entries.push(...ordered);
    this.next = Math.max((ordered.at(-1)?.n ?? 0) + 1, next ?? 1);
  }

  /** Write down everything a day turned up. Returns what was kept, for anybody who wants it now. */
  record(changes: readonly Change[], at = Date.now()): Entry[] {
    const kept = changes.map((change, offset) => ({ ...change, at, n: this.next + offset }));
    // Commit before publishing. If the disk refuses this turn, the HTTP window must not claim it
    // happened durably and then continue its cursor as though nothing went wrong.
    this.persist?.(kept);
    this.next += kept.length;
    this.entries.push(...kept);
    // trimmed from the front, because the oldest is the first thing nobody wants
    if (this.entries.length > KEEPS) this.entries.splice(0, this.entries.length - KEEPS);
    return kept;
  }

  /**
   * Everything newer than a number the caller was given last time, oldest first.
   *
   * `since` rather than a timestamp, because two things in the same millisecond are ordinary in a
   * world that lives a day in a second, and a reader polling on a clock would see one of them and
   * never the other. Nought — or anything older than the ring still holds — gives what there is,
   * which is the right answer for a reader opening the page for the first time.
   */
  since(n: number, most = KEEPS): Entry[] {
    const out = this.entries.filter((e) => e.n > n);
    return out.length > most ? out.slice(out.length - most) : out;
  }

  /** The newest number handed out, so a reader knows what to ask for next time. */
  get latest(): number { return this.next - 1; }

  /** How many are being kept, for anybody checking the ring is behaving. */
  get held(): number { return this.entries.length; }
}
