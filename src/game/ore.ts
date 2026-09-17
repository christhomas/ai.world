import { ITEMS } from './items';
import { Yard, type YardJson } from './yards';

/**
 * The ore a village has by it, and the first thing anybody makes something *out of*.
 *
 * Timber was the first material and it is consumed by building: a house takes forty logs and the
 * logs stop existing. Ore is the first one that becomes a different object — a smith turns it and a
 * day of his labour into gear, which is worth more than either, and that is the first new value in
 * this economy that was not dug out of the ground as coin.
 *
 * ## Where it comes from, and why no money is invented
 *
 * A mine already yields `gold`: nuggets the crew carries home and is paid for. Adding ore beside it
 * would be matter from nowhere, and `economy.test.ts` is right to forbid that — a village that
 * mints a sword out of nothing is a village whose whole ledger is decoration.
 *
 * So ore is *kept back* rather than added. A village with a smithy sells a little less of its shift
 * as nuggets and keeps the stone instead: the same day at the same face, split two ways. The gold
 * the crew is paid falls by exactly what the ore was worth, and `ORE.KEPT_BACK` is that share.
 *
 * A village with no smithy keeps nothing back, because there is nobody to keep it for — which is
 * the geographic fact this whole chain exists to make true. A village with a seam, a wood and a
 * smithy makes swords out of its own ground; a village on a rock buys them or goes without.
 *
 * ## Why it is a `Yard`
 *
 * Because everything about being a stack is the same as timber's and the argument is in `yards.ts`:
 * a history beside the stock, a standing heap for a village nobody has looked at, a day's work
 * accounted through a morning that may have been missed, and a ceiling.
 */
export const ORE = {
  /**
   * Ore one miner brings up in a day, in pieces, for the standing heap only.
   *
   * A quarter, which reads oddly until you see what it is for. Day to day the ore comes off the
   * shift and is charged to the seam — see `keptBack` — and this number is never used for that.
   * It exists so a village that has had a seam and a smithy for years starts with a heap by the
   * adit rather than with nothing, and a quarter of a piece per miner per day is what a week of
   * that comes to: a couple of pieces for a small village, a handful for a mining one.
   */
  A_DAY: 0.25,
  /**
   * Days of digging a village is already holding the first time anybody asks.
   *
   * The same week timber gets, and for the same reason: starting every heap in the world at
   * nothing would mean no smith anywhere could work until a player had waited a week watching men
   * come up a ladder, which is a rule that reads as a bug.
   */
  STANDING: 7,
  /**
   * What the heap will hold before the crew stops keeping any back.
   *
   * Sixty pieces, which is a dozen swords' worth. Smaller than timber's two hundred and forty
   * because ore is heavier, worth more and wanted in smaller amounts — and because a heap that took
   * a season to work through would make the smith's supply a thing nobody ever notices.
   */
  HOLDS: 60,
  /**
   * How much of a seam's worth goes out as stone rather than as nuggets, where there is a forge.
   *
   * A fifth. Mining is how money gets into this world in the first place and the crew still comes
   * home paid: what this changes is not their wage but how long the mine lasts, because the stone
   * is charged to the seam exactly as the gold is. A village with a forge works its mine out
   * sooner and has gear to show for it.
   */
  KEPT_BACK: 0.2,
} as const;

/** A heap on disk. The shape is `yards.ts`'s, which is timber's, which is one shape for all of them. */
export type OreJson = YardJson;

/** What one piece of ore is worth, which is what the seam is charged for letting it go. */
export function worthOfOre(): number {
  return Math.max(1, ITEMS.silverore?.price ?? 34);
}

/**
 * What a shift sets aside as stone, and what the seam is charged for it.
 *
 * Carried, and that is the whole of the arithmetic. A day at a fresh face is worth twenty-six gold
 * and one piece of ore is worth thirty-four, so a fifth of a day is two thirds of nothing — taken
 * as a floor it is nought every single day for ever, which is how the first version of this
 * quietly did nothing at all. So the fifth is *accumulated* against the mine, and when enough of
 * it has built up a piece comes out and the carry drops by what it cost.
 *
 * The crew's gold is untouched. What this spends is the seam: `worked` rises by the ore's worth
 * exactly as it rises by the gold's, so a mine yields what a mine yields and a village with a forge
 * simply gets some of it as stone and works the place out sooner. Nothing is minted.
 */
export function keptBack(gold: number, carried: number): { ore: number; carry: number; spent: number } {
  const worth = worthOfOre();
  const set = carried + gold * ORE.KEPT_BACK;
  const ore = Math.floor(set / worth);
  if (ore <= 0) return { ore: 0, carry: set, spent: 0 };
  return { ore, carry: set - ore * worth, spent: ore * worth };
}

/** The ore a village has by it. A `Yard` with a miner's numbers on it; see `timber.ts` for the twin. */
export class Ore {
  private readonly heap: Yard;

  constructor(json?: OreJson, on?: number) {
    this.heap = new Yard(ORE, json, on);
  }

  static from(json?: OreJson, on?: number): Ore { return new Ore(json, on); }

  /** Pieces in this village's heap. Nothing, for a village with no seam or nobody to keep it for. */
  at(village: string): number { return this.heap.at(village); }

  /** Everything ever carried in and sold here, which no forge ever takes back down. */
  sold(village: string): number { return this.heap.sold(village); }

  /** Ore a player carried in and sold here: it joins the heap, and it is remembered. */
  brought(village: string, pieces: number): void { this.heap.brought(village, pieces); }

  /** Ore kept back from a shift, or carried in and sold over a counter. */
  land(village: string, pieces: number): void { this.heap.land(village, pieces); }

  /** A village's own digging accounted through a morning. `day` is the morning being lived. */
  minedThrough(village: string, miners: number, day: number): void {
    this.heap.workedThrough(village, miners, day);
  }

  /** The smith takes what a piece of work wants, or takes nothing and says so. */
  draw(village: string, pieces: number): boolean { return this.heap.draw(village, pieces); }

  /** What the heap is short of for a piece of work, or nought when it can be started. */
  shortBy(village: string, pieces: number): number { return this.heap.shortBy(village, pieces); }

  toJSON(): OreJson { return this.heap.toJSON(); }
}
