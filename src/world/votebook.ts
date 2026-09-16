import { ballotFor, enactVote, finishVotedHall, recogniseVillage, type Ballot } from './votes';
import type { TownVote } from './rank';
import type { Settlement } from './settlement';

/**
 * Every motion a village has carried, keyed so one cannot be carried twice.
 *
 * A vote is a *told* fact, like an oath and a violent death: a village declares itself a town and
 * no seed implies that, so the register keeps them, replays them through `apply`, and writes them
 * into a save. The bookkeeping is here, for the reason `oathbook.ts`, `daybook.ts` and
 * `stablebook.ts` all give — `register.ts` is against the seven hundred lines
 * `architecture.test.ts` allows, and the answer here has never been to argue the cap.
 *
 * Keyed on village and rank rather than dated, and that is the point of the key: a place becomes a
 * town once. A second motion to the same rank is the same motion arriving twice — over the wire and
 * out of a save, which is the ordinary case — and writes once.
 */
export class VoteBook {
  private readonly carried = new Map<string, TownVote>();

  /** A village becomes each rank once, so this is what "the same vote" means. */
  static keyOf(vote: TownVote): string { return `${vote.village}:${vote.rank}`; }

  has(vote: TownVote): boolean { return this.carried.has(VoteBook.keyOf(vote)); }
  keep(vote: TownVote): void { this.carried.set(VoteBook.keyOf(vote), vote); }
  drop(vote: TownVote): void { this.carried.delete(VoteBook.keyOf(vote)); }

  /** The next motion that can be called here, and the residents entitled to cast it. */
  ballot(here: Settlement | undefined): Ballot | null {
    return here ? ballotFor(here) : null;
  }

  /** Call the local vote. The caller supplies the player's aye by choosing it in the hall. */
  call(village: string, here: Settlement | undefined, day: number): TownVote | null {
    const ballot = this.ballot(here);
    if (!here || !ballot?.ready) return null;
    const voted: TownVote = { kind: 'voted', village, rank: ballot.rank, day: Math.floor(day) };
    if (!enactVote(here, voted)) return null;
    this.keep(voted);
    return voted;
  }

  /**
   * Apply this morning's votes, then move into a finished hall.
   *
   * Town before city, because a place that carried both on one morning has to become the first
   * before it can become the second — and a vote that will not take is dropped rather than kept,
   * so a motion that was invalid does not go on reserving its key against the day it would be
   * valid.
   */
  applyOn(village: string, here: Settlement, day: number): void {
    recogniseVillage(here);
    const today = [...this.carried.values()]
      .filter((vote) => vote.village === village && vote.day === day)
      .sort((a, b) => (a.rank === b.rank ? 0 : a.rank === 'town' ? -1 : 1));
    for (const vote of today) if (!enactVote(here, vote)) this.drop(vote);
    finishVotedHall(here, day);
  }
}
