import { mulberry32 } from '../core/rng';

/**
 * Darts, played in a pub for a stake.
 *
 * A village had a shop, an inn and somebody with an errand, and that was everything you could do
 * in one. A game gives the pub a reason to be walked into that is not a transaction, and it moves
 * money in both directions, which is the half of an economy the player has never been on the
 * losing side of.
 *
 * Deliberately a skill check rather than a physics toy: three throws against a house player whose
 * standard is fixed and known, so it is a decision about whether to stake rather than a test of
 * anybody's mouse. The hero's own practice counts, so getting better at fighting is not the only
 * thing that gets better.
 */

export const DARTS = {
  /**
   * What it costs to play, and what the house pays back on a win.
   *
   * Tuned so a beginner loses steadily, somebody who has been fighting for a while breaks about
   * even, and only a hero who has really practised makes money at it — and then slowly, a few
   * gold a leg. A pub that pays better than a day's work is a pub nobody ever leaves.
   */
  STAKE: 8,
  WINNINGS: 17,
  /** Three darts a leg, as anybody would expect. */
  THROWS: 3,
  /** What the house scores per throw, on average, out of twenty. */
  HOUSE: 13,
  /** What a hero with no practice at all averages, and what every level of it adds. */
  GREEN: 9.5,
  PER_LEVEL: 1.1,
} as const;

export interface Leg {
  /** What each dart scored, in order. */
  throws: number[];
  total: number;
  houseTotal: number;
  won: boolean;
}

/** One throw: a score out of twenty, clustered around a standard rather than uniform. */
function oneThrow(rng: () => number, standard: number): number {
  // two rolls averaged, so middling scores are common and both twenty and one are rare — a dart
  // board with a flat distribution is a raffle
  const spread = (rng() + rng()) / 2;
  const score = standard + (spread - 0.5) * 18;
  return Math.max(1, Math.min(20, Math.round(score)));
}

/**
 * Play a leg. `seed` makes it deterministic for a given throw of the dice, and `skill` is the
 * hero's practice level, which is worth about a point a level against the house.
 */
export function playLeg(seed: number, skill: number): Leg {
  const rng = mulberry32(seed);
  const standard = DARTS.GREEN + skill * DARTS.PER_LEVEL;
  const throws: number[] = [];
  for (let n = 0; n < DARTS.THROWS; n++) throws.push(oneThrow(rng, standard));
  const total = throws.reduce((a, b) => a + b, 0);

  let houseTotal = 0;
  for (let n = 0; n < DARTS.THROWS; n++) houseTotal += oneThrow(rng, DARTS.HOUSE);

  return { throws, total, houseTotal, won: total > houseTotal };
}

/** How the leg reads out loud. */
export function saidOfLeg(leg: Leg): string {
  const darts = leg.throws.join(', ');
  return leg.won
    ? `You throw ${darts} for ${leg.total}. The house makes ${leg.houseTotal}. Yours.`
    : `You throw ${darts} for ${leg.total}, and the house makes ${leg.houseTotal}. Bad luck.`;
}
