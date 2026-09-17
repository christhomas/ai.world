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

import { Yard, type YardJson } from './yards';

/** A yard on disk. The shape is `yards.ts`'s and is unchanged: an old save reads as it did. */
export type TimberJson = YardJson;

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

/**
 * The timber a village has by it.
 *
 * A `Yard` with a woodcutter's numbers on it. Everything about *being a stack* — the history beside
 * the stock, the standing week, the ceiling, a day's felling accounted through a morning that may
 * have been missed — moved to `yards.ts` when ore needed the same machinery for a smith, because
 * the argument above was always about stacks rather than about wood. What is left here is the wood.
 *
 * The names are the wood's too, and deliberately: `felledThrough` reads as something a woodcutter
 * does, and half this repository's benches and comments quote it. A general mechanism does not have
 * to make every caller speak generally.
 */
export class Timber {
  private readonly stack: Yard;

  constructor(json?: TimberJson, on?: number) {
    this.stack = new Yard(TIMBER, json, on);
  }

  static from(json?: TimberJson, on?: number): Timber { return new Timber(json, on); }

  /** Logs in this village's yard. Nothing, for a village nobody has looked at or cut for. */
  at(village: string): number { return this.stack.at(village); }

  /** Everything ever carried into this village and sold, which is what the wright is paying back. */
  sold(village: string): number { return this.stack.sold(village); }

  /** Wood a player carried in and sold here: it joins the stack, and it is remembered. */
  brought(village: string, logs: number): void { this.stack.brought(village, logs); }

  /** Wood landed at a village: cut by its own woodcutters, or carried in and sold over a counter. */
  land(village: string, logs: number): void { this.stack.land(village, logs); }

  /** Felling accounted through a particular world day. `day` is the morning being lived. */
  felledThrough(village: string, woodcutters: number, day: number): void {
    this.stack.workedThrough(village, woodcutters, day);
  }

  /** The builder takes what a job wants, or takes nothing and says so. */
  draw(village: string, logs: number): boolean { return this.stack.draw(village, logs); }

  /** What the yard is short of for a job of this size, or nought when it can be started. */
  shortBy(village: string, logs: number): number { return this.stack.shortBy(village, logs); }

  toJSON(): TimberJson { return this.stack.toJSON(); }
}
