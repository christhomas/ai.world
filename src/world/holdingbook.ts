import type { Owner } from './holdings';

/**
 * Dated work and income facts about a holding, kept for as long as the save lives.
 *
 * A hero's farm earns while he is asleep — `postings.ts` stands its posts and `aday.ts` records
 * its cattle and crop receipts in the register's own day. Nobody reading this book pays anyone.
 * #264 asks for facts keyed by **holding** and folded nowhere.
 *
 * ## Why every fact and not a running total
 *
 * `relive` throws a village away and founds it again, carrying over only what was *told* —
 * memories, opinions, hurt — and re-deriving the rest by living every day a second time. A day
 * whose facts were dropped is a day the village genuinely lives differently, so a book that kept
 * a total would be a book that could not be replayed into.
 *
 * And a total cannot stand in for a trajectory, because money in this world is clamped at both
 * ends: `deeds.ts` floors a `take` at nought and caps a `give` at `PROSPER.MOST`, which is 4000.
 * A purse at 3900 given 200 and then taken 200 from holds **3800**; the sum of the two says 3900.
 * Where the cap binds the surplus goes to the hall on purpose, so a summed checkpoint would mint a
 * hundred gold and leave a village whose books do not balance with no transaction to explain it.
 * The facts are kept in the order they happened and anything anybody wants adding up is added up
 * on the way out, where the clamps are not in the room.
 *
 * ## Why per holding and not per person
 *
 * #359 found a settled village hiring in a **ring** — five builders each standing the next one's
 * yard — so every purse nets to nought on the day and a per-person daily figure shows nothing at
 * all. Keyed by the holding, the same morning reads as five yards each buying a day of building,
 * which is what actually happened.
 *
 * ## What it costs
 *
 * Memory, and nothing else. It is one keyed write a village a morning, exactly as `StableBook.on`
 * is one keyed lookup, so replay does not get slower for it. How big it actually gets is measured
 * rather than argued about: `chore test economy` reports `facts`, `holdings` and `weigh` after a
 * hundred days.
 *
 * ## Why it is neither saved nor sent
 *
 * It used to be both: written into the world file and handed to every joining page, then restored
 * over whatever book the other side had. And then thrown away unread, because the first `settle`
 * of the village forgets it and lives it again from its founding — which is the one source of
 * truth this book has. Every row is the replay's, and the replay is deterministic, so a page that
 * grows a village writes the same book the server does without a row passing between them. The
 * copy cost 2 MB of welcome and 2.85 MB of save after a year on seed 7, and the restore wiped
 * every village the sender had not grown. #484.
 */

/** One holding, one morning: who stood its post, at what price, and what actually moved. */
export interface HoldingDay {
  /** The morning. Whole days, because a village lives a day at a time. */
  day: number;
  /** Which holding. The key, and the thing that outlives whoever stood on it. */
  holding: string;
  /** Which sort of post: see `POSTINGS`. */
  kind: string;
  /** Who stood it that morning, worked out fresh and never remembered between days. */
  who: string;
  /** Whose purse it came out of: a villager, or the hall. */
  funder: Owner;
  /** What the morning was priced at, which is what `postsToday` asked. */
  wage: number;
  /**
   * And what actually left a purse for it, which is not the same number and cannot be derived.
   *
   * Nought where a man stands his own yard — the two ends of the hand-over are one purse, so the
   * wage is real work at a real price and no coin moves. A hall-owned holding instead transfers
   * from the hall treasury to the worker's purse. A reader wanting *what this holding cost its
   * owner* wants this; a reader wanting *what a day on it was worth* wants `wage`. Keeping only one
   * of them would have made the other unanswerable, the argument of this file in one field.
   */
  paid: number;
}

/** Farm income already allocated by the day's economy; writing it never moves money. */
export interface HoldingIncome {
  type: 'income';
  day: number;
  holding: string;
  owner: Owner;
  cattle: number;
  crop: number;
}

/** A daybook fact with its village key, flattened for weighing. */
type HoldingRecord = { village: string } & (HoldingDay | HoldingIncome);

export class HoldingBook {
  /**
   * Village, then holding, then morning.
   *
   * The morning is a key rather than a position in a list because the question this book exists to
   * answer — *what has my yard been doing while I was away* — is a walk down one holding, and
   * because writing a morning twice has to be writing it once.
   *
   * The village on the front is the level that lets a village be **forgotten**, and that is not
   * tidiness. A village is thrown away and founded again whenever somebody learns late that it
   * buried a man, and it then lives a hundred days *differently* — different people alive on
   * different mornings, so different men on different gates. A book that kept both lives would be
   * the union of two histories that contradict each other, with nothing in a row to say which life
   * it came from. `register.settle` forgets the place before it lives it again.
   */
  private readonly told = new Map<string, Map<string, Map<number, HoldingDay>>>();
  private readonly income = new Map<string, Map<string, Map<string, HoldingIncome>>>();

  /**
   * What a post moved in or out of one person's purse on one morning.
   *
   * An index over the facts above rather than a second record of them: it is written in the same
   * call, from the same morning, and holds the net of that morning's posts for that person — the
   * figure `records.ts` puts in the roll. It is *not* a fold across days, which is the thing this
   * book refuses; a morning is the grain the facts are kept at and this is the same grain seen
   * from the purse's end.
   *
   * It exists because the alternative is scanning every holding in the world for every person on
   * every evening. The bench asks this question about 16,000 times in a hundred days.
   */
  private readonly nets = new Map<string, Map<string, number>>();

  private key(id: string, day: number): string { return `${id}:${Math.floor(day)}`; }

  /** Every row, flat and in a stable order: what `weigh` measures. */
  private records(): HoldingRecord[] {
    const rows: HoldingRecord[] = [];
    for (const [village, here] of this.told) for (const days of here.values()) {
      for (const fact of days.values()) rows.push({ village, ...fact });
    }
    for (const [village, here] of this.income) for (const days of here.values()) {
      for (const fact of days.values()) rows.push({ village, ...fact });
    }
    return rows.sort((a, b) => a.village.localeCompare(b.village)
      || a.day - b.day || a.holding.localeCompare(b.holding)
      || ('type' in a ? 1 : 0) - ('type' in b ? 1 : 0));
  }

  /** Replace a village's dated attribution with the same fact when a morning is lived again. */
  earned(village: string, facts: readonly HoldingIncome[]): void {
    let here = this.income.get(village);
    if (!here) { here = new Map(); this.income.set(village, here); }
    for (const fact of facts) {
      let days = here.get(fact.holding);
      if (!days) { days = new Map(); here.set(fact.holding, days); }
      days.set(this.key(fact.owner, fact.day), { ...fact, day: Math.floor(fact.day) });
    }
  }

  incomeOn(holding: string): readonly HoldingIncome[] {
    for (const here of this.income.values()) {
      const days = here.get(holding);
      if (days) return [...days.values()].sort((a, b) => a.day - b.day || a.owner.localeCompare(b.owner));
    }
    return [];
  }

  /**
   * One village's morning, written down.
   *
   * Keyed by holding and morning so that writing it twice is writing it once — which is not a
   * nicety but the condition of the thing working at all. A village is re-founded and lived again
   * whenever anybody learns something late about its past, and `foundOn` re-founds one whenever a
   * page and the world disagree about which trades a place supports. Both replay mornings this
   * book already has. Set, never added: added, a village re-lived twice would have paid its
   * builders twice over and nothing would have said so.
   */
  stood(village: string, day: number, facts: readonly HoldingDay[], owed: ReadonlyMap<Owner, number>): void {
    const morning = Math.floor(day);
    let here = this.told.get(village);
    if (!here) { here = new Map(); this.told.set(village, here); }
    for (const fact of facts) {
      let days = here.get(fact.holding);
      if (!days) { days = new Map(); here.set(fact.holding, days); }
      days.set(morning, { ...fact, day: morning });
    }
    if (owed.size === 0) return;
    let purses = this.nets.get(village);
    if (!purses) { purses = new Map(); this.nets.set(village, purses); }
    for (const [id, much] of owed) purses.set(this.key(id, morning), much);
  }

  /**
   * This village is about to be lived again from its founding: what it did before never happened.
   *
   * Called by `settle`, which is the one door a village comes into existence through and which
   * returns early for a village that already exists — so every call that gets past it is a fresh
   * life of the place and every row this book holds for it belongs to a life that has been thrown
   * away. Without this, a village re-lived on a slightly different roll kept the mornings of both.
   */
  forget(village: string): void {
    this.told.delete(village);
    this.income.delete(village);
    this.nets.delete(village);
  }

  /**
   * Every morning this holding ever posted a man, oldest first.
   *
   * The whole record and not a window on it. A caller that wants a window takes one; a book that
   * chose the window for them would be a book that had decided which days matter.
   *
   * A walk across the villages rather than one lookup, because the village is the level a life is
   * forgotten at and a holding id is not asked to carry its village. There are a handful of
   * villages in a world and fifteen holdings in each, so it is a walk across the handful.
   */
  on(holding: string): readonly HoldingDay[] {
    for (const here of this.told.values()) {
      const days = here.get(holding);
      if (days) return [...days.values()].sort((one, two) => one.day - two.day);
    }
    return [];
  }

  /**
   * What a post paid this person on that morning, or cost them where it is negative.
   *
   * Asked of the morning rather than of "the last day", which is what makes the two ways a village
   * comes to exist agree. The register used to keep this in a ledger cleared each morning by
   * `advance` — and the catch-up inside `settle` lives a hundred mornings and clears nothing, so a
   * re-lived village answered with the last value ever written for somebody rather than with
   * today's. Seed 1234 at day 120 read two people charged and paid for a morning no post of theirs
   * stood on. A book keyed by the day cannot have that fault. See `relived.test.ts`.
   */
  paidTo(id: string, day: number): number {
    // the same walk `on` makes, and for the same reason: a person id does not name their village
    const key = this.key(id, day);
    for (const purses of this.nets.values()) {
      const much = purses.get(key);
      if (much !== undefined) return much;
    }
    return 0;
  }

  /** How many holdings have ever posted anybody, anywhere. */
  holdings(): number {
    let all = 0;
    for (const here of this.told.values()) all += here.size;
    return all;
  }

  /**
   * And how many rows are written down across all of them, which is what actually grows: a post
   * stood, and — since #442 — a farm's takings for an owner, which a manned farm writes every
   * morning and which is most of the book.
   */
  facts(): number {
    let all = 0;
    for (const here of this.told.values()) for (const days of here.values()) all += days.size;
    for (const here of this.income.values()) for (const days of here.values()) all += days.size;
    return all;
  }

  /** The villages this book has any row for: what a world file keeps instead of the rows. */
  villages(): string[] {
    const named = new Set<string>();
    for (const shelf of [this.told, this.income]) for (const [village, here] of shelf) if (here.size > 0) named.add(village);
    return [...named].sort();
  }

  /**
   * What the book weighs, in bytes of JSON.
   *
   * Measured rather than estimated, as JSON because that is what it would cost to save or send —
   * which is the bill #484 stopped paying, and the number to look at before anybody starts paying
   * it again. Reported by `chore test economy` at a hundred
   * days, which is #264's fourth line and the reason this method exists rather than an argument
   * about whether keeping everything is affordable.
   */
  weigh(): number {
    return JSON.stringify(this.records()).length;
  }
}
