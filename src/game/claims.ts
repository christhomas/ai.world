/**
 * Something the page did before the world agreed to it.
 *
 * Three of these were written on the same night — a chest opened, a crop lifted, a seed put in the
 * ground — and all three had the same twelve lines in them: a counter, a map of what was given,
 * hand out a number, look the number up once, put it back if the answer says no. That is the shape
 * item 26 was about, arriving again in a different coat, and it is worth having exactly once before
 * the fourth one is written.
 *
 * ## What this is for
 *
 * The whole of the argument for deciding things on the server rather than on the page — see
 * `docs/server-authority.md` — runs into one objection: a game where every action waits a round trip
 * feels like it is being played through a letterbox. The answer games use is prediction and
 * reconciliation, and this is the reconciliation half made small enough to reach for.
 *
 * The page acts immediately and keeps what it gave itself, numbered. The world answers that number.
 * If it agrees, the claim is forgotten and nothing happened at all; if it does not, the page puts it
 * back. The rule that makes it safe is that **what was given is kept, not recomputed** — a rollback
 * that worked out what it should undo could work it out differently by then.
 *
 * ## What it deliberately does not do
 *
 * It does not decide anything, know what any of these things are, or contain a single line about
 * chests or crops. Each caller keeps its own undo, because what it means to put a thing back is
 * exactly the part that is different every time: a chest shuts, a crop goes back in the ground as
 * ripe as it was, a seed comes out and returns to the pack.
 *
 * It also does not time anything out. A hero who walks away with the answer still in flight keeps
 * what he was given until it arrives, and an answer that never comes leaves one entry in a map — the
 * cost of a socket dropping, which is bounded by how fast a person can press a button.
 */
export class Claims<T> {
  private asked = 0;
  private readonly waiting = new Map<number, T>();

  /** How many answers are still owed. Nothing in the game needs it; a probe and a test do. */
  get pending(): number { return this.waiting.size; }

  /** The page has done it. Keep what it gave itself, and take a number for the answer. */
  ask(given: T): number {
    const seq = ++this.asked;
    this.waiting.set(seq, given);
    return seq;
  }

  /**
   * The world has answered this one. Hands back what was given, once.
   *
   * Once, and that is the point of taking it out of the map here rather than leaving it to the
   * caller: an answer that arrived twice would undo a thing twice, and the second undoing would
   * take a coin out of a purse that had already given it back.
   *
   * Nothing for a number this has never handed out, which covers an answer to somebody else's
   * claim, an answer to one already settled, and a world saying something a page has no idea about.
   */
  answered(seq: number): T | null {
    const given = this.waiting.get(seq);
    if (given === undefined) return null;
    this.waiting.delete(seq);
    return given;
  }
}
