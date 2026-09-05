/**
 * Turning the picture down until the game moves.
 *
 * The rig defaults to `high`, which means a device pixel ratio of two and a 2048-square shadow map
 * redrawn every frame. On a retina screen that is four times the fragments of the plain setting
 * before a single shadow is cast, and it is chosen sight unseen on a machine nobody has measured.
 * A player whose computer cannot hold it gets a slideshow and no clue why, because the quality menu
 * is three clicks away and says nothing about what it costs.
 *
 * So the game watches its own frame times for a moment and steps down if it is not keeping up. The
 * rules it follows are deliberately timid:
 *
 * - it never overrides somebody who has chosen a level themselves, because a player who picked
 *   `high` on a slow machine has decided they would rather have the picture
 * - it waits for a settled stretch of frames, because the first second of a world is all chunk
 *   building and tells you nothing about the steady state
 * - it judges on the median rather than the mean, so one long frame from a chunk arriving does not
 *   condemn a machine that is otherwise fine
 * - it only ever goes down, and only one step at a time. A rule that can go both ways will find a
 *   machine sitting exactly on the boundary and flicker between two settings for ever, which looks
 *   far worse than either of them.
 */

export const AUTO = {
  /** The frame time we are trying to stay under, in milliseconds. Sixty frames a second. */
  BUDGET: 16.7,
  /**
   * How far over budget is bad enough to act on.
   *
   * A little over is not worth a visible change in how the game looks: at 1.15 a machine holding a
   * steady 55fps would be dropped to a worse picture for a difference nobody can see. This is
   * about 44fps, which is where the movement itself starts to feel wrong.
   */
  TOO_SLOW: 1.35,
  /**
   * How many frames to judge on, and how many to throw away first while the world is still
   * building itself.
   *
   * Counted in frames rather than seconds, which cuts the right way: a machine managing sixty a
   * second reaches a verdict in a couple of seconds and a machine managing ten takes longer to
   * condemn — but not much longer, because the whole point is that the player struggling most
   * waits least for relief. At double these the slowest machines waited the best part of half a
   * minute before anything happened, which is most of the way to giving up on the game.
   */
  SAMPLE: 60,
  SETTLE: 60,
  /** How many steps down it may take in one session. */
  STEPS: 2,
} as const;

export type Level = 'low' | 'medium' | 'high';

/** The order things get worse in, best first. */
const LADDER: readonly Level[] = ['high', 'medium', 'low'];

/** The next rung down, or null at the bottom. */
export function below(level: Level): Level | null {
  const at = LADDER.indexOf(level);
  return at >= 0 && at + 1 < LADDER.length ? LADDER[at + 1] : null;
}

/** The middle frame time of a stretch, which is what a machine is really doing. */
export function medianOf(frames: readonly number[]): number {
  if (frames.length === 0) return 0;
  const sorted = [...frames].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Watches frame times and says when the picture should come down a step.
 *
 * Fed one frame time per frame. Answers with a level to move to, or null to carry on as we are —
 * which is the answer almost every time it is asked.
 */
export class AutoQuality {
  private readonly frames: number[] = [];
  private settled = 0;
  private stepsTaken = 0;

  /**
   * @param chosenByHand whether the player has ever picked a quality themselves, in which case
   *   this does nothing at all for the rest of the session
   */
  constructor(private readonly chosenByHand: boolean) {}

  /** Somebody opened the menu and picked one. Their choice stands from here on. */
  private handed = false;
  leaveItAlone(): void { this.handed = true; }

  get watching(): boolean {
    return !this.chosenByHand && !this.handed && this.stepsTaken < AUTO.STEPS;
  }

  /**
   * One frame gone by, and what the game is set to now. Returns the level to drop to, or null.
   *
   * The sample is cleared whenever it answers, so the next judgement is made on frames drawn at
   * the new setting rather than on the ones that condemned the old one.
   */
  saw(frameMs: number, current: Level): Level | null {
    if (!this.watching) return null;
    if (this.settled < AUTO.SETTLE) { this.settled++; return null; }
    this.frames.push(frameMs);
    if (this.frames.length < AUTO.SAMPLE) return null;

    const median = medianOf(this.frames);
    this.frames.length = 0;
    if (median <= AUTO.BUDGET * AUTO.TOO_SLOW) return null;

    const next = below(current);
    if (next === null) return null;   // already as plain as it goes; nothing left to give
    this.stepsTaken++;
    return next;
  }
}

/**
 * Has the player ever picked a quality themselves?
 *
 * Read from the same key the rig remembers its level in. Somebody who chose `high` on a slow
 * machine has decided they would rather have the picture, and it is not the game's place to argue.
 */
export function everChoseQuality(): boolean {
  try {
    if (localStorage.getItem('ai.world/quality') === null) return false;
    // a level this thing picked itself is not a choice, and must not be mistaken for one. Without
    // that distinction the first automatic step down is remembered as the player's own decision,
    // and the game never adjusts again — neither further down on a machine that needed two steps,
    // nor back up on one that has been upgraded.
    return localStorage.getItem(AUTO_KEY) !== '1';
  } catch {
    // private browsing, or storage refused: assume nobody has chosen, which is the common case
    return false;
  }
}

const AUTO_KEY = 'ai.world/quality-auto';

/** Note that the level now written down was chosen by the game rather than by a person. */
export function rememberAutoChoice(): void {
  try { localStorage.setItem(AUTO_KEY, '1'); } catch { /* nothing to do */ }
}

/** And that it was not: from here on the player's choice stands and nothing measures against it. */
export function rememberTheirChoice(): void {
  try { localStorage.removeItem(AUTO_KEY); } catch { /* nothing to do */ }
}
