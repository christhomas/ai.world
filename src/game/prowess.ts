/**
 * Getting better at this.
 *
 * Everything about the hero came out of a shop. Kit improved and the hero never did, so a fight
 * in the second week was the first week's fight with a better sword in it — which makes the shop
 * the only thing that ever changes, and makes a hard fight something you buy your way out of
 * rather than something you get through.
 *
 * So swinging at things teaches you to swing at things. What it buys is small on purpose: a point
 * of damage, then another, against a sword that gives four. It is meant to be the difference
 * between only just failing and only just managing, not a substitute for a weapon.
 *
 * Practice counts, danger counts more, and killing something counts most, because otherwise the
 * best way to get good at fighting is to hit a chicken for an hour.
 */

export const PROWESS = {
  /** What one landed blow is worth. */
  PER_HIT: 1,
  /** And one on something that could have killed you, on top of that, per point of its danger. */
  PER_DANGER: 3,
  /** And finishing it. */
  PER_KILL: 14,
  /** What each level costs, and what each one after it costs on top. */
  FIRST_LEVEL: 260,
  STEEPER: 1.6,
  /** No amount of practice makes you a troll. */
  MOST: 5,
} as const;

/** What a single blow teaches, given what it landed on. */
export function learnedFrom(danger: number, killed: boolean): number {
  return PROWESS.PER_HIT
    + Math.max(0, danger) * PROWESS.PER_DANGER
    + (killed ? PROWESS.PER_KILL : 0);
}

/** How much practice a given level costs in total. */
export function costOf(level: number): number {
  let total = 0;
  let step: number = PROWESS.FIRST_LEVEL;
  for (let n = 0; n < level; n++) {
    total += step;
    step = Math.round(step * PROWESS.STEEPER);
  }
  return total;
}

/** The level all that practice comes to. */
export function levelFor(practice: number): number {
  let level = 0;
  while (level < PROWESS.MOST && practice >= costOf(level + 1)) level++;
  return level;
}

/** How far through the current level, nought to one, for anything that wants to draw a bar. */
export function towardsNext(practice: number): number {
  const level = levelFor(practice);
  if (level >= PROWESS.MOST) return 1;
  const from = costOf(level), to = costOf(level + 1);
  return Math.max(0, Math.min(1, (practice - from) / Math.max(1, to - from)));
}

/** What the player is told they have become. Silence at nought: nobody starts as anything. */
export function saidOf(level: number): string {
  return ['', 'You have the hang of this.', 'Your arm knows the work now.',
    'You fight like somebody who has done it.', 'Few here could stand against you.',
    'There is nothing left for a sword to teach you.'][Math.min(level, PROWESS.MOST)];
}
