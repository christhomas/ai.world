import type { Person } from './people';

/**
 * How a village is doing, and whether it is still a village at all.
 *
 * The register already knows what a place was founded at and who is left, so a village's plight
 * is a subtraction rather than a system. This file is only the reading of that number: what
 * counts as trouble, what counts as lost, and how long an empty place takes to come back.
 *
 * The important decision is that losing a village is NOT the same as emptying it. A place with
 * two people in it is dying but not dead, and a place with nobody is a ruin the map still names.
 * Keeping those apart is what lets somebody arrive in time, which is the whole of the drama: a
 * village that flips straight from fine to gone gives nobody anything to do.
 */

export const FORTUNE = {
  /** Below this share of its founding size, a village knows it is in trouble and will say so. */
  STRUGGLING: 0.65,
  /** Below this, it cannot hold itself together and stops replacing its dead. */
  FAILING: 0.3,
  /** Days a ruin lies empty before a neighbour will put people back into it. */
  RESETTLE_AFTER: 14,
  /** How near a neighbour has to be, in tiles, to spare anybody for a resettlement. */
  NEIGHBOUR_WITHIN: 220,
  /** A neighbour will not send people if doing so would drop it below this share of its own size. */
  SPARE_ABOVE: 0.8,
} as const;

/** What state a village is in, in the only terms anybody needs. */
export type Fortune = 'well' | 'struggling' | 'failing' | 'lost';

/** How a village is doing, from what it was founded at and who is left alive in it. */
export function fortuneOf(living: number, founded: number): Fortune {
  if (living <= 0) return 'lost';
  const share = living / Math.max(1, founded);
  if (share < FORTUNE.FAILING) return 'failing';
  if (share < FORTUNE.STRUGGLING) return 'struggling';
  return 'well';
}

/**
 * Whether a village can still replace the people it loses.
 *
 * A failing village cannot. That is what makes arriving in time matter: past the point where
 * there are enough adults to keep the place going, it will not recover on its own however long
 * you leave it, and only somebody dealing with the cause will do.
 */
export function canRecover(fortune: Fortune): boolean {
  return fortune === 'well' || fortune === 'struggling';
}

/** How somebody who lives there would put it, which is the only form the player ever sees. */
export function saidOf(fortune: Fortune, village: string): string {
  switch (fortune) {
    case 'well': return `${village} is doing well enough.`;
    case 'struggling': return `${village} has buried too many this month. People are talking about leaving.`;
    case 'failing': return `There is hardly anybody left in ${village}. It will not last the season.`;
    case 'lost': return `${village} is empty. The doors are open and nobody has shut them.`;
  }
}

/** Everybody grown enough to keep a village going, which is who a resettlement needs. */
export function grownFolk(people: readonly Person[], day: number, adultAt: number): Person[] {
  return people.filter((p) => day - p.born >= adultAt);
}
