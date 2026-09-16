import { DAY_LENGTH } from '../../server/protocol';

/**
 * How much of the world passes while nobody is looking at it.
 *
 * The two worlds need opposite work here, and only look the same from outside. A **shared** world
 * needs nothing: `server/sim.ts` keeps stepping whether or not anybody is connected and
 * `register.advance(today)` walks the days, so a player rejoins at the day the world reached, their
 * body wherever they left it and their holdings worked by whoever `postings.ts` picked each
 * morning. A **single player** world freezes: the day is saved and restored and there is no wall
 * clock in the save at all.
 *
 * So elapsed time has to be *invented* on this side. This is the invention, and it is deliberately
 * one small pure function: what it decides is a number of days, and living them is the register's
 * business through the door it already has.
 */
export const AWAY_TIME = {
  /**
   * Real seconds per world day while nobody is playing.
   *
   * A real day, near enough, against `DAY_LENGTH`'s two real hours for a day somebody lived through.
   *
   * The ratio is the whole argument. At the lived rate a week away is eighty-four world days, and
   * `LIFE.LONGEST_LIFE` is ninety — so a holiday buries very nearly everybody who ever knew you, and
   * you come back to a village of strangers standing on your friends' graves. That is not a harsh
   * rule, it is a rule that deletes the part of this game worth caring about.
   *
   * A day a day instead: a week away is a week of village life. Long enough that things moved,
   * short enough that the people you knew are the people you left.
   */
  A_DAY: 24 * 3600,
} as const;

/**
 * World days that passed while somebody was away, given the real seconds they were gone.
 *
 * Whole days, because a village lives a day at a time and `register.advance` takes a day.
 *
 * Nothing for a negative or a nonsense interval, which is the one case that matters in the field: a
 * machine whose clock was wrong, or corrected while the game was shut, hands back a negative — and
 * a village that un-lived a fortnight would be a village whose dead came back and whose children
 * were unborn. The floor is the honest answer and it costs a line.
 *
 * No cap, and that is a choice rather than an omission. A cap is a cliff: somebody who has been
 * away six months should find a world that moved on without them, not one that stopped politely at
 * the ninetieth day and waited.
 */
export function daysAway(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor(seconds / AWAY_TIME.A_DAY);
}
