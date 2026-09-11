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
  /**
   * And one on something that could have killed you, on top of that, per point of its danger.
   *
   * Three tenths, and it was three. `dangerous` is a creature's damage and moved onto the health
   * scale with everything else — a wolf hits for ten where it used to hit for one — so this came
   * down by the same factor to leave what a fight teaches exactly where it was. Two numbers had to
   * move together because they are one fact seen twice: how hard a thing hits is also how much
   * there is to learn from it.
   */
  PER_DANGER: 0.3,
  /** And finishing it. */
  PER_KILL: 14,
  /**
   * What a level of practice adds to how much of you there is.
   *
   * Forty, against a hundred to start with, so a man at the top of the table has three times the
   * health he set out with before he puts anything on. This is power scaling, and it is the whole
   * reason the health scale was widened: on ten hearts there was nowhere to put it, because the
   * smallest blow in the game was already a tenth of the hero and a tougher hero would have had to
   * be a hero who could not be hurt.
   *
   * What it buys is the thing that was asked for in so many words: an experienced hero should not
   * be finished by a wolf in five or six bites. At the start a wolf is a tenth of him and ten bites
   * is a real fight; at the top it is a thirtieth and a wolf is an inconvenience — *without the
   * wolf changing*, which is the point. The bestiary stays where it is and the hero moves past it,
   * so a bear is still a bear and a beginner still has no business fighting one.
   *
   * Deliberately not a multiplier on everything. Practice already buys `PER_LEVEL` of attack, and
   * the two together are what a level means; a level that also improved armour and speed would be
   * a level that made every other number in the game decorative.
   */
  TOUGHER: 40,
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
