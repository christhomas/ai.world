import { rebuildPatch } from './endless';
import { boundsOf, type Patchwork } from './patchwork';
import type { CountryReply, CountryRequest } from './countrymessages';
import type { TerrainSampler } from './terrain';

/**
 * Asking somebody else to grow the country.
 *
 * A patch is about five seconds of work and about a tenth of a second to rebuild from its parts, so
 * the arrangement writes itself: a worker grows, the page rebuilds, and the page never blocks. What
 * this owns is the *asking* — which squares are wanted, which are already on their way, and what to
 * do with one when it arrives.
 *
 * ## The worker is an optimisation and never a guarantee
 *
 * A hero can outwalk it: the patch he is standing in has to exist *now*, and if nobody has grown it
 * he gets the five seconds on the main thread rather than a hole in the world. That is the right
 * trade and it is why `Patchwork.patch` still grows one itself. Everything here is about making
 * that case rare — ask for the neighbours while there is still ground underfoot, and by the time
 * anybody reaches an edge the next square is already in hand.
 *
 * ## Why it is one worker and one at a time
 *
 * Three workers growing three patches finish none of them sooner: the work is processor-bound and
 * the machine has the cores it has, most of which are already drawing the game. What three would do
 * is hold three patches of country in memory at once and make the one that matters — the square the
 * hero is walking into — wait behind two nobody has reached yet. So: one worker, a queue, and the
 * nearest square asked for first.
 */
export class Grower {
  /** Squares asked for and not yet arrived, in the order they were asked. */
  private readonly asked: string[] = [];
  private busy = false;
  /** How many squares this session has grown elsewhere, and how long the last one took. */
  grown = 0;
  lastTook = 0;

  constructor(
    private readonly seed: number,
    private readonly patches: Patchwork,
    /** How to send a square off to be grown. Handed in so a test needs no `Worker`. */
    private readonly send: (msg: CountryRequest) => void,
    /** And how to put one back together here, which is the cheap half. */
    private readonly rebuild: typeof rebuildPatch = rebuildPatch,
  ) {}

  /**
   * Ask for a square, unless it is already held or already on its way.
   *
   * Cheap to call every frame with the same patch, which is what the caller does: "grow what is
   * around the hero" is a question with the same answer for minutes at a time.
   *
   * It asks with `wanted` rather than `has`, and that one word is what keeps the ring of squares
   * round the hero from being dropped out from under the very thing asking for them. Being asked
   * for is a use: a square somebody is walking towards is wanted now, whether or not anything has
   * happened to paint a chunk on it lately. See `Patchwork.wanted`.
   */
  want(patch: string): void {
    if (this.patches.wanted(patch) || this.asked.includes(patch)) return;
    this.asked.push(patch);
    this.pump();
  }

  /** A square has come back. Rebuild it here — a tenth of a second — and put it with the rest. */
  took(reply: CountryReply): void {
    this.busy = false;
    this.grown++;
    this.lastTook = reply.took;
    const at = this.asked.indexOf(reply.patch);
    if (at >= 0) this.asked.splice(at, 1);
    this.patches.put(reply.patch, this.rebuild(this.seed, boundsOf(reply.patch), reply.parts));
    this.pump();
  }

  /** What is still coming, for a debug readout and for a test. */
  get waiting(): string[] {
    return [...this.asked];
  }

  /**
   * Send the next one, if nothing is already out.
   *
   * `wanted` again rather than `has`, for the same reason and with a second one of its own: every
   * square still in the queue is by definition one somebody has asked for, so walking the queue is
   * a use of every square it skips past as well as of the one it settles on.
   */
  private pump(): void {
    if (this.busy) return;
    const next = this.asked.find((patch) => !this.patches.wanted(patch));
    if (!next) return;
    this.busy = true;
    this.send({ type: 'grow', seed: this.seed, patch: next });
  }
}

/** What a rebuilt patch looks like, for anybody wiring one of these up. */
export type Rebuilt = TerrainSampler;
