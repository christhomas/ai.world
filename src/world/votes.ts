import { whoIsPaidToRaiseIt } from './founding';
import { housesStanding } from './growth';
import { payAndSweep } from './purses';
import { beganOn, RAISING_TAKES } from './roofs';
import {
  PROMOTIONS, promotionFor, rankOfRoofs, type Rank, type TownVote, type VotableRank,
} from './rank';
import type { Settlement } from './settlement';

/** The motion that can be put before a place today. Every adult trade-holder has one vote. */
export interface Ballot {
  rank: VotableRank;
  costs: number;
  work: string;
  note: string;
  voters: readonly string[];
  /** Enough money and at least one resident elector: the motion can be called now. */
  ready: boolean;
}

/** A new settlement's title: eight roofs make a village, while higher titles require a vote. */
export function foundingRank(roofs: number): Rank {
  return rankOfRoofs(roofs) === 'hamlet' ? 'hamlet' : 'village';
}

/** Crossing eight roofs makes a hamlet a village; the higher names still require votes. */
export function recogniseVillage(village: Settlement): void {
  if (village.rank === 'hamlet' && foundingRank(housesStanding(village.houses, village.works)) === 'village') {
    village.rank = 'village';
  }
}

/** The next motion its standing roofs permit, including whether the treasury can meet it. */
export function ballotFor(village: Settlement): Ballot | null {
  const promotion = promotionFor(village.rank, housesStanding(village.houses, village.works));
  if (!promotion) return null;
  const voters = village.people.filter((person) => person.trade !== '').map((person) => person.id).sort();
  return {
    rank: promotion.rank,
    costs: promotion.costs,
    work: promotion.work,
    note: promotion.note,
    voters,
    ready: voters.length > 0 && village.hall.purse >= promotion.costs,
  };
}

/**
 * Carry out a recorded vote at the point in the village's history when it happened.
 *
 * The event says only what was decided and when. Roofs, electorate, price and payees are derived
 * from that morning, so two books replaying the same event move the same money to the same people.
 */
export function enactVote(village: Settlement, vote: TownVote): boolean {
  const ballot = ballotFor(village);
  if (!ballot || ballot.rank !== vote.rank || !ballot.ready) return false;
  const wages = whoIsPaidToRaiseIt(village.people, ballot.costs);
  if (!wages) return false;
  const owed = new Map(wages);
  owed.set(village.hall.id, -ballot.costs);
  payAndSweep(village, owed);
  village.rank = vote.rank;
  village.hall.body = 'mayor-house';
  village.works.push(`${ballot.work}@${Math.floor(vote.day)}`);
  finishVotedHall(village, vote.day);
  return true;
}

/** Move the unchanged hall entity into its own building once the latest voted work is finished. */
export function finishVotedHall(village: Settlement, day: number): void {
  let work: string | undefined;
  for (let at = village.works.length - 1; at >= 0; at--) {
    const id = village.works[at].split('@')[0];
    if (PROMOTIONS.some((promotion) => promotion.work === id)) { work = village.works[at]; break; }
  }
  if (!work) return;
  const begun = beganOn(work);
  village.hall.body = begun === null || day - begun >= RAISING_TAKES ? 'town-hall' : 'mayor-house';
}
