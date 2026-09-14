import { SQUARE } from './civic';

/**
 * How far a place has room to rise, and what it has actually voted to become.
 *
 * Roofs make a vote possible; they do not cast it. A hamlet becomes a village when it first has
 * enough roofs to keep public books, but town and city are told facts: somebody called a vote,
 * the treasury paid for the hall, and the day of it crossed the wire.
 *
 * ## What a rank is allowed to do
 *
 * Unlock buildings and trades; never make numbers bigger. A town that simply earned more per head
 * than a village would be a multiplier wearing a noun, and the economy would stop being a thing you
 * can reason about. What a bigger place has is things a smaller one has not got, and every one of
 * them is something the player can walk up to.
 */

export type Rank = 'hamlet' | 'village' | 'town' | 'city';
export type VotableRank = Exclude<Rank, 'hamlet' | 'village'>;

/** The ranks, and how many roofs must stand before each declaration may be put to a vote. */
export const RANKS: ReadonlyArray<{ id: Rank; roofs: number; label: string }> = [
  { id: 'hamlet', roofs: 0, label: 'hamlet' },
  { id: 'village', roofs: SQUARE.CIVIC_HOUSES, label: 'village' },
  { id: 'town', roofs: SQUARE.CIVIC_HOUSES * 2, label: 'town' },
  { id: 'city', roofs: SQUARE.CIVIC_HOUSES * 4, label: 'city' },
];

/** The two declarations a place can vote for, and what each public building costs. */
export const PROMOTIONS: ReadonlyArray<{
  rank: VotableRank; roofs: number; costs: number; work: string; note: string;
}> = [
  { rank: 'town', roofs: SQUARE.CIVIC_HOUSES * 2, costs: 5000, work: 'townhall',
    note: 'A hall of its own, raised when the village votes to become a town.' },
  { rank: 'city', roofs: SQUARE.CIVIC_HOUSES * 4, costs: 15000, work: 'cityhall',
    note: 'The hall enlarged when the town votes to become a city.' },
];

/** A vote already taken: unlike roofs, this has to be told and carries its morning. */
export interface TownVote {
  kind: 'voted';
  village: string;
  rank: VotableRank;
  day: number;
}

/** The next declaration this many roofs permit, or nothing until more are standing. */
export function promotionFor(rank: Rank, roofs: number): (typeof PROMOTIONS)[number] | null {
  const at = RANKS.findIndex((step) => step.id === rank);
  const next = PROMOTIONS.find((step) => RANKS.findIndex((r) => r.id === step.rank) === at + 1);
  return next && roofs >= next.roofs ? next : null;
}

/** The highest rank this many roofs would permit; not proof that its vote happened. */
export function rankOfRoofs(roofs: number): Rank {
  let rank: Rank = 'hamlet';
  for (const step of RANKS) if (roofs >= step.roofs) rank = step.id;
  return rank;
}


/** Whether a place of this rank is at least another rank. */
export function atLeast(rank: Rank, wanted: Rank): boolean {
  const has = RANKS.findIndex((step) => step.id === rank);
  const needs = RANKS.findIndex((step) => step.id === wanted);
  return has >= needs;
}
