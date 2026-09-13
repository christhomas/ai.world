/**
 * The timber a village has by it, and the first thing in this economy that is not money.
 *
 * Every price in this world has been paid in coin and nothing has ever been short of anything, so a
 * builder could in principle put up houses until the gold ran out. That is arithmetic rather than a
 * world: a village on a plain with a wood behind it and a village on a bare rock differ by nothing
 * except how fast their purses fill. Timber is the answer, and what it buys is *a limit that is not
 * a number going down*. A house cannot be built out of an empty yard, whatever is on the table.
 *
 * ## Why the same wood a player carries, rather than a quantity like the herd
 *
 * The herd was the obvious precedent and it is the wrong one. A village's cattle are a number
 * because which particular cow is which is nobody's business — the paddock is *drawn* from the
 * number, and no cow is ever in anybody's pack. Wood is already the opposite of that in every
 * respect: `ITEMS.wood` exists, a saw already makes it, a player already carries it and already
 * sells it over a counter, and `Market` already counts what came through. Inventing a second,
 * parallel village-quantity of wood would have put two kinds of wood in one game, and the first
 * player to fell a tree and walk into a village that could not build would have found that the
 * wood on his back was not the wood the builder was short of.
 *
 * So there is one wood. What is new is the *yard*: somewhere the stuff sits between being cut and
 * being built with, counted per village because timber is heavy and a yard is where it was landed.
 *
 * ## What fills it
 *
 * Two things, and the second one is what makes this a chain rather than a tax.
 *
 * A village's **woodcutters** cut it. That is the trade this exists for, and it is the first pair in
 * this economy that need each other rather than both needing the player: a builder with no woodcutter
 * in his village has nothing to build with, and a woodcutter with no builder has cut wood nobody wants.
 *
 * And **anybody who sells wood at that village's market**, which is already an act the game has —
 * so a player who walks into a place that has no wood behind it and no woodcutter in it can be the
 * supply himself. That is the whole loop of item 50 available to a player on the first afternoon,
 * out of parts that were all already there.
 *
 * ## Why it is kept rather than derived
 *
 * Almost everything about a village is worked out again from the seed and the day, and this cannot
 * be. A yard is a running total of two histories — what was cut and what was built — and the second
 * of them includes what a *player* chose to have built, which no seed implies. It rides in the save
 * beside the commissions it pays for, which is also where it belongs: a yard of timber waiting for
 * a job is a builder's book as much as the job is.
 */

export const TIMBER = {
  /**
   * Logs one woodcutter lands in a day.
   *
   * Six, and the number is chosen off the other end: a house wants forty, so one woodcutter keeps one
   * building crew going and takes a week over it. That is the sentence this whole feature exists to
   * make true — a house is a thing that required somebody's week — and it means a village with one
   * woodcutter builds steadily, a village with two builds twice as often, and a village with none does
   * not build at all however rich it gets.
   */
  A_DAY: 6,
  /**
   * Days of felling a village is already holding the first time anybody asks.
   *
   * A village that has stood for years has a stack by the sawpit; starting every yard in the world
   * at nothing would mean no house anywhere could be commissioned until a player had waited a week
   * watching a man cut wood, which is a rule that reads as a bug. A week of its own woodcutters' work
   * is what a place that has always had a wood behind it would have, and it is exactly nothing for
   * a place that has never had anybody to cut it — which is the distinction the whole feature is
   * about, visible on the first afternoon rather than after one.
   */
  STANDING: 7,
  /**
   * What a yard will hold before the woodcutters stop.
   *
   * Six houses' worth. A village does not fell timber it has nowhere to stack and nobody to sell,
   * and without a ceiling a quiet century would leave every village in the country able to build
   * anything instantly — which is the limit going away again by arithmetic, the exact thing this
   * was built to stop.
   */
  HOLDS: 240,
} as const;

/** What a village's yard holds, and how it got there. */
/**
 * A yard on disk: the stack that is standing, and the wood that was carried in to it.
 *
 * Two records rather than one, because they are two different kinds of number. The first goes up
 * and down and is a *stock*; the second only ever goes up and is a *history*, and a history is what
 * the wright works from — a village that put up a house would otherwise forget the week somebody
 * spent hauling timber into it, which is the one thing it ought to remember.
 *
 * The bare `Record<string, number>` is the shape this was saved in before the second record
 * existed, and it is still read: a yard from that day is a stack nobody is recorded as having
 * brought, which is exactly what it was.
 */
export type TimberJson = Record<string, number> | {
  yards: Record<string, number>;
  brought: Record<string, number>;
};

export class Timber {
  private readonly yards = new Map<string, number>();
  /** Cumulative logs carried in and sold here, which no building ever takes back down. */
  private readonly carriedIn = new Map<string, number>();
  /** Villages whose standing stack has already been counted, so it is counted once. */
  private readonly opened = new Set<string>();

  constructor(json?: TimberJson) {
    const stacks = json && 'yards' in json ? json.yards : (json as Record<string, number> | undefined);
    for (const [village, logs] of Object.entries(stacks ?? {})) {
      this.yards.set(village, logs);
      this.opened.add(village);
    }
    if (json && 'brought' in json) {
      for (const [village, logs] of Object.entries(json.brought)) this.carriedIn.set(village, logs);
    }
  }

  static from(json?: TimberJson): Timber { return new Timber(json); }

  /** Logs in this village's yard. Nothing, for a village nobody has looked at or cut for. */
  at(village: string): number {
    return this.yards.get(village) ?? 0;
  }

  /**
   * Everything ever carried into this village and sold, which is what the wright is paying back.
   *
   * Deliberately not the yard: the yard is a stack and this is a history, and the difference is a
   * village that has built a house since. Deliberately not the felling either — a woodcutter lives
   * here, and counting his week would hand a cart to a player who stood still for it.
   */
  sold(village: string): number {
    return this.carriedIn.get(village) ?? 0;
  }

  /**
   * Wood a player carried in and sold here: it joins the stack, and it is remembered.
   *
   * The tally counts what was *sold*, not what fitted. A seller whose logs meet a full yard has
   * still been paid for them by a market that wanted them, and refusing to credit the surplus would
   * make the wright's memory depend on how much building the village happened to be doing.
   */
  brought(village: string, logs: number): void {
    if (logs <= 0) return;
    this.carriedIn.set(village, this.sold(village) + logs);
    this.land(village, logs);
  }

  /**
   * Wood landed at a village: cut by its own woodcutters, or carried in and sold over a counter.
   *
   * One way in for both, because they are the same act from the yard's point of view — a stack of
   * timber does not know who brought it. Capped, and the surplus is simply not landed rather than
   * being refused: a woodcutter who finds the yard full spends the day doing something else, and a
   * player selling into a full yard has still sold his wood, which the market has already paid for.
   */
  land(village: string, logs: number): void {
    if (logs <= 0) return;
    this.yards.set(village, Math.min(TIMBER.HOLDS, this.at(village) + logs));
  }

  /**
   * A day's felling by however many woodcutters a village has.
   *
   * The first day it is asked about a village it also lands whatever was already stacked there, so
   * a place with a wood behind it is found with timber in it rather than with a week to wait. A
   * village with no woodcutter is opened at nothing and stays at nothing, which is the limit.
   */
  felled(village: string, woodcutters: number): void {
    if (!this.opened.has(village)) {
      this.opened.add(village);
      this.land(village, woodcutters * TIMBER.A_DAY * TIMBER.STANDING);
    }
    this.land(village, woodcutters * TIMBER.A_DAY);
  }

  /**
   * The builder takes what a job wants, or takes nothing and says so.
   *
   * All of it or none of it: half the timber for a house is a house nobody can start, and a yard
   * quietly emptied by a job that was then refused would be a village that lost its wood to a
   * conversation. The caller asks before it commits, and this is the committing.
   */
  draw(village: string, logs: number): boolean {
    if (logs <= 0) return true;
    const held = this.at(village);
    if (held < logs) return false;
    this.yards.set(village, held - logs);
    return true;
  }

  /** What the yard is short of for a job of this size, or nought when it can be started. */
  shortBy(village: string, logs: number): number {
    return Math.max(0, logs - this.at(village));
  }

  toJSON(): TimberJson {
    return { yards: Object.fromEntries(this.yards), brought: Object.fromEntries(this.carriedIn) };
  }
}
