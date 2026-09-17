import { OathBook } from './oathbook';
import { VoteBook } from './votebook';
import { enactVote, type Ballot } from './votes';
import { Arrivals, swornTrades, type Arrival } from './arrivals';
import type { Sworn } from './vacancies';
import type { SwornIn, Told } from '../../server/protocol';
import type { TownVote } from './rank';
import type { Change, Settlement } from './settlement';
import type { Person } from './people';

/**
 * The facts about a village that no seed can imply, and the one door they go in through.
 *
 * A village is re-lived from its founding every time anything about it changes far enough back:
 * the same people are born on the same mornings, take up the same trades and die of the same old
 * age, because all of that is a function of the seed. Three things are not, and they are here.
 *
 * - Somebody was **killed**. Teeth, or a blade. The seed had them living another forty years.
 * - A place **declared** itself a town or a city. A vote is cast by whoever was standing in the
 *   hall, and nothing about a seed predicts who that was.
 * - A traveller **swore** to a vacancy. There is no `Person` to point at: the hall writes down the
 *   name it was given, because the person who gave it is not on the roll.
 * - Somebody **walked in**. A hero over the hill on the fourteenth morning, who the seed had no
 *   reason to expect and who a village founded again would simply arrive without.
 *
 * Each is dated, and the date is the load-bearing part. *When* somebody died decides how many
 * children the village had afterwards, so a death that arrives late is written down here and the
 * village lived again from the beginning rather than being patched on to today and quietly
 * disagreeing with everybody else.
 *
 * ## Why it is a book and not three fields on the register
 *
 * The same reason `oathbook.ts` gives for itself, one level up: `register.ts` is against the seven
 * hundred lines `architecture.test.ts` allows, and the answer has never been to argue the cap.
 * But there is a better reason than the cap. The three books, and the forty lines that decide what
 * writing into one of them does to a living country, are *one idea* — a told fact — and they were
 * spread across three private maps and a method sitting between a shrine and a churchyard. The
 * register is who is alive. This is what has been done to them.
 */

/**
 * A fact that has to be told, because nothing can work it out again, as the register wants it.
 *
 * An arrival is the one told fact whose wire shape the register wants unchanged — there is no
 * `Person` to translate a name into, which is the whole of what an arrival is for — so it travels
 * as itself. See `toldAsChange`.
 */
export type Telling = Change | TownVote | SwornIn | Extract<Told, { kind: 'arrived' }>;

export type { Told };

/** Somebody walked into a village, as both halves of the world say it. */
export type Arrived = Extract<Told, { kind: 'arrived' }>;

/**
 * What a told fact borrows from the register to be written into a living country.
 *
 * Deliberately five things and not the register itself. A book that could reach the whole register
 * would grow back into it; this one can look a village up, look a person up, take somebody off the
 * roll and found a place again, and that is the whole of what writing a told fact does.
 */
export interface TheCountry {
  /** The last whole day the register has caught up to. A fact dated after it is not yet true. */
  readonly today: number;
  at(village: string): Settlement | undefined;
  /** Found this village again from its seed, replaying everything this book holds about it. */
  relive(village: string): void;
  find(id: string): Person | undefined;
  /** Take somebody off the roll, violently, on the day it happened. */
  takeOff(person: Person, day: number): Change | null;
}

export class Tellings {
  /**
   * Who was killed, and on which day.
   *
   * By day, because a village that lost its miller in the spring is a different village by autumn
   * from one that lost him in the autumn — see the note above on why the date carries the weight.
   */
  private readonly killed = new Map<string, number>();
  /** One told fact for each declaration in each place. See `votebook.ts`. */
  private readonly votes = new VoteBook();
  /** Told oaths, which survive a re-living because a seed cannot predict who walked in. */
  private readonly sworn = new OathBook();
  /** And who walked in, which is the fact the oath is about. See `arrivals.ts`. */
  private readonly arrived = new Arrivals();

  /** The day this person was killed, or nothing, which is what a living day asks. */
  killedOn(id: string): number | undefined { return this.killed.get(id); }

  /** The oaths a village is holding, as its own record wants them. */
  oathsOf(village: string): Sworn[] { return this.sworn.of(village); }

  /** Put this village's arrivals back after it has been founded again. See `walkThemIn`. */
  putArrivalsBack(village: string, here: Settlement, upTo: number): void {
    this.arrived.putBack(village, here, upTo);
  }

  /** Everybody who walked in anywhere, for whatever has to hand the list on. */
  arrivals(): Array<Arrival & { village: string }> { return this.arrived.all(); }


  /** Who holds what here, and what nobody is doing. See `oathbook.ts`. */
  directory(trades: readonly string[], people: readonly Person[], village: string) {
    return this.sworn.directory(trades, people, village);
  }

  /** The next motion this place can call, and who may cast it. See `votebook.ts`. */
  ballot(here: Settlement | undefined): Ballot | null { return this.votes.ballot(here); }

  /** Call the local vote. The player's aye is supplied by choosing it in the hall. */
  call(village: string, here: Settlement | undefined, day: number): TownVote | null {
    return this.votes.call(village, here, day);
  }

  /** Apply this morning's votes in a village being lived through. See `votebook.ts`. */
  votedOn(village: string, here: Settlement, day: number): void {
    this.votes.applyOn(village, here, day);
  }

  /**
   * Write a told fact down, and make the country agree with it.
   *
   * The one write path, which is why the wire and the save can both hand the same fact in without
   * either of them having to know about the other: a duplicate is refused rather than applied
   * twice. Returns whether anything was actually written.
   */
  apply(change: Telling, on: TheCountry): boolean {
    // Oaths are dated and keyed so the ordinary wire-plus-save duplicate writes only once.
    if (change.kind === 'sworn') {
      if (Math.floor(change.day) > on.today) return false;
      const oath = this.sworn.take(change.village, change.trade, change.who, change.day);
      if (!oath) return false;
      const here = on.at(change.village);
      if (!here) return true;              // nobody has settled it; kept for the morning they do
      // A late oath changes later apprenticeships, so replay rather than patching today's village.
      if (oath.day === on.today) { here.sworn.push(oath); swornTrades(here, here.sworn); return true; }
      on.relive(change.village);
      return true;
    }
    if (change.kind === 'arrived') {
      /*
       * A village nobody has settled cannot have somebody stood on its roll, and unlike an oath
       * this cannot be kept for the morning somebody does: `walkIn` needs the settlement to push a
       * row onto. It is not a loss — the page asks as the hero walks in, and the hero walking in is
       * what settles a village in the first place.
       */
      const here = on.at(change.village);
      if (!here || Math.floor(change.day) > on.today) return false;
      return this.arrived.walkIn(
        change.village, here, { name: change.who, sex: change.sex, purse: change.purse }, change.day,
      ) !== null;
    }
    if (change.kind === 'voted') {
      const voted = { ...change, day: Math.floor(change.day) };
      if (this.votes.has(voted) || !Number.isFinite(voted.day) || voted.day > on.today) return false;
      const here = on.at(voted.village);
      if (here && voted.day === on.today) {
        if (!enactVote(here, voted)) return false;
        this.votes.keep(voted);
        return true;
      }
      this.votes.keep(voted);
      if (!here) return true;
      on.relive(voted.village);
      if (on.at(voted.village)?.rank === voted.rank) return true;
      // An invalid historical vote is not allowed to reserve its key. Re-live once more without it.
      this.votes.drop(voted);
      on.relive(voted.village);
      return false;
    }
    if (change.kind !== 'died' || this.killed.has(change.id)) return false;
    this.killed.set(change.id, change.day);

    const here = on.find(change.id);
    if (here && change.day >= on.today) { on.takeOff(here, change.day); return true; }

    const village = change.village || here?.village || '';
    if (on.at(village)) on.relive(village);
    return true;
  }

  /** A death told directly rather than through `apply`: the register already has the person. */
  killedNow(id: string, day: number): void { this.killed.set(id, day); }
}

/** Whether a delta is one of the three: the narrowing a room's log needs to reach `replayTold`. */
export function isTold(delta: { kind: string }): delta is Told {
  return delta.kind === 'died' || delta.kind === 'voted'
    || delta.kind === 'sworn' || delta.kind === 'arrived';
}

/**
 * Replay a world's told facts into a register, oldest first.
 *
 * Two places do this and they had written it out twice: `sim.ts` catches an authoritative register
 * up with a room's log before anybody is put in a street, and `multiplayer.ts` does the same thing
 * to a page's register as the log arrives over the wire. A conversion written twice is a conversion
 * free to drift, and what it converts — a `who` on the wire into an `id` in the book — is exactly
 * the sort of detail that drifts quietly.
 *
 * Called with the register already advanced to the day it is catching up to, never before. Every
 * told fact is then dated in the past, so each founds its village again from the morning it
 * happened rather than being patched on to today — which is the whole reason the date is kept.
 *
 * A death arrives as `who` rather than as a person because the register it is going into has not
 * necessarily settled the village yet — which is fine, and is the case the book is built for: the
 * killing is written down, and the morning somebody walks in and the place is founded, the seed
 * lives it through knowing about it.
 */
export function replayTold(log: Iterable<Told>, into: (change: Telling) => boolean): void {
  for (const one of log) into(toldAsChange(one));
}

/**
 * One told fact, in the register's vocabulary rather than the wire's.
 *
 * Only a death needs translating, and only in one field: a killing travels as the `who` a village
 * would name and lands as the `id` a register holds. The name is left empty because the register
 * finds the person by id and a name carried alongside would be a second thing that could be wrong.
 */
export function toldAsChange(one: Told): Telling {
  if (one.kind !== 'died') return one;
  return { kind: 'died', id: one.who, name: '', village: one.village, day: one.day, cause: 'violence' };
}
