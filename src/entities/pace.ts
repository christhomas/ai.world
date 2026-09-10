/**
 * How many creatures this machine can afford to think for, measured rather than declared.
 *
 * C1 called `Roster`'s four thousand "the threshold that is obviously wrong", and the reason is
 * that it is a *per-world* cap which happens to match what one laptop can tick. On a Raspberry Pi
 * the hardware says four hundred while the cap goes on saying four thousand, and the two agree
 * today only by coincidence — a coincidence C2a then broke, because after the tiers most of what a
 * world holds costs nothing and the machine can hold far more than it can think for.
 *
 * The decision this is built on, taken deliberately: **a world's population is the world's
 * business, and what a machine sheds is its own.** Two players standing in one field must see the
 * same deer, which is the whole reason the world owns the wildlife at all — so nothing here
 * refuses a spawn, kills anything, or changes what exists. What it changes is how many of the
 * creatures near a player are *thought for* this tick. A laptop thinks for four hundred and a Pi
 * for a hundred, and both are looking at the same eighteen hundred.
 *
 * That is also why shedding is by distance. What a player is looking at is thought for; what has
 * dropped out is the far edge of the live band, where a creature was already going to be handed to
 * the closed forms the moment it crossed into the coarse tier. Nothing changes *kind*, it only
 * happens a little nearer in.
 */

/**
 * How much of a tick may go on thinking for creatures.
 *
 * A fifth. The rest of a tick is the ground, the drawing, the network and everything else with a
 * claim on it, and a simulation that eats half the frame is a simulation that makes the game feel
 * slow while looking fine on paper. It is a share rather than a number of milliseconds because a
 * server ticks ten times a second and a page draws sixty: the same fraction means the same thing
 * to both, and neither has to be told what the other does.
 */
const SHARE_OF_A_TICK = 0.2;

/**
 * The fewest creatures this will ever think for, however slow the machine.
 *
 * Sixty is about what stands round a player in a busy village — the crowd on the square, the
 * animals in the paddock beside it, whatever is coming down the road. Below that the shedding
 * would start taking things a player is looking directly at, and a machine too slow for sixty
 * creatures is a machine too slow for the game rather than one that needs managing.
 */
const FEWEST = 60;

/**
 * And the most, which is a guard against a machine that measures as infinitely fast.
 *
 * A tick that comes back as nought — a browser that has throttled a background tab, a clock with a
 * millisecond of resolution — would otherwise let this climb for ever and hand the whole world to
 * the live tier the moment the tab came back. Four thousand is `Roster`'s own ceiling, which is
 * where the number came from originally and is a perfectly good backstop now that it is no longer
 * pretending to be a policy.
 */
const MOST = 4_000;

/** How fast the budget may move, up or down, per tick. A budget that jumps makes the world flicker. */
const EASE = 0.08;

/**
 * A budget that follows the clock.
 *
 * Deliberately slow in both directions and by the same amount. Quick to shed sounds right — the
 * machine is struggling, take the load off — but a budget that drops the instant one tick runs long
 * drops on the tick where a chunk was meshed or a save was written, which is a frame that had
 * nothing to do with the creatures. And a budget that climbs quickly oscillates: it sheds, the tick
 * gets cheap, it un-sheds, the tick gets dear again, and creatures at the edge of the band twitch
 * between thinking and not several times a second. Eight per cent a tick settles in about a second
 * either way, which is slower than a frame and faster than anybody notices.
 */
export class Pace {
  private budget: number;

  constructor(start = 800) {
    this.budget = Math.max(FEWEST, Math.min(MOST, start));
  }

  /** How many creatures may be thought for this tick. */
  get many(): number {
    return Math.round(this.budget);
  }

  /**
   * What the last tick actually cost, in seconds, against the tick it had to fit in.
   *
   * `spent` is the time the live pass took and `dt` is the tick it was part of. Both are handed in
   * rather than measured here, because the thing that knows when the pass began and ended is the
   * thing that runs it, and a timer this file started would be timing the call into it as well.
   */
  measured(spent: number, dt: number, live: number): void {
    /*
     * A tick with nothing in it says nothing about what the machine can carry — and neither does a
     * clock that says the work took no time at all.
     *
     * That second one is not hypothetical and the test that caught it is worth keeping: `Date.now`
     * has a millisecond of resolution, and a browser throttling a background tab coarsens it
     * further, so a pass over a few hundred creatures genuinely measures as nought. Read as a cost
     * that would be a machine of infinite speed, and the budget climbed to its ceiling and handed
     * the entire world to the live tier the moment the tab came back. A measurement of nought is a
     * clock that cannot see, not a machine that is infinitely fast, and the right thing to do with
     * it is nothing.
     */
    if (dt <= 0 || live <= 0 || spent <= 0) return;
    const afford = dt * SHARE_OF_A_TICK;
    /*
     * What the budget would be if the cost per creature held, which it roughly does.
     *
     * Per creature rather than as a ratio of the whole, because the live count is exactly what is
     * being changed: scaling the budget by `afford / spent` assumes the cost is all in the
     * creatures, and a tick that ran long because something else in it ran long would then shed
     * creatures that were never the problem.
     */
    const each = spent / live;
    const want = afford / each;
    this.budget += (Math.max(FEWEST, Math.min(MOST, want)) - this.budget) * EASE;
  }
}

/**
 * The clock, wherever this is running.
 *
 * `performance.now` in a browser and on a modern server, and `Date.now` as the fallback — a
 * millisecond of resolution is coarse for timing a pass that takes two, but a budget that eases at
 * eight per cent a tick does not need better, and a machine without a high-resolution clock is not
 * one that should be refused a working game over it.
 */
export const now = (): number =>
  (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
