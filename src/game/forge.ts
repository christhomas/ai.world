import { FORGES, aSmithsDay, dearnessOfGear } from './smithing';

/**
 * What each village has on its shelf, made by its own smith.
 *
 * A count per item rather than one number, for the reason `smithing.ts` gives: a village that has
 * made two helms and no swords is a different place to walk into than one that has made two swords
 * and no helms, and that difference is most of what makes somewhere worth the walk.
 *
 * Kept rather than derived, like the timber yard and for the same reason: it is a running total of
 * two histories — what was made and what was bought — and the second is the player's, which no
 * seed can reconstruct.
 */
export type ForgeJson = Record<string, Record<string, number>>;

export class Forge {
  private readonly shelves = new Map<string, Map<string, number>>();
  /** The last day each village's smith has been accounted for, so a morning is worked once. */
  private readonly workedOn = new Map<string, number>();

  constructor(json?: ForgeJson) {
    for (const [village, shelf] of Object.entries(json ?? {})) {
      this.shelves.set(village, new Map(Object.entries(shelf)));
    }
  }

  static from(json?: ForgeJson): Forge { return new Forge(json); }

  /** How many of this thing are on this village's shelf. */
  at(village: string, id: string): number {
    return this.shelves.get(village)?.get(id) ?? 0;
  }

  /** Put one on the shelf. */
  made(village: string, id: string): void {
    const shelf = this.shelves.get(village) ?? new Map<string, number>();
    shelf.set(id, (shelf.get(id) ?? 0) + 1);
    this.shelves.set(village, shelf);
  }

  /**
   * Take one off, or say there is none.
   *
   * Asked before the money moves, which is `offTheShelf`'s rule and the whole of why a shelf is
   * worth having: a purchase that took the coin and then found no sword would be exactly the
   * direction this economy is audited against.
   */
  take(village: string, id: string): boolean {
    const shelf = this.shelves.get(village);
    const held = shelf?.get(id) ?? 0;
    if (held <= 0) return false;
    shelf!.set(id, held - 1);
    return true;
  }

  /** Whether this village's forge makes this at all, which decides if its shelf can ever run out. */
  static makes(id: string): boolean {
    return FORGES.some((one) => one.id === id);
  }

  /** What the village is asking for one of these, against the catalogue. */
  dearness(village: string, id: string): number {
    return Forge.makes(id) ? dearnessOfGear(this.at(village, id)) : 1;
  }

  /**
   * One village's smiths, working through a morning.
   *
   * Idempotent per day the way the yards are, and for the same reason: a day skipped by a clock
   * correction or lived again by `relive` is still one day's work, and the same morning must not
   * be forged twice. Draws only on a day that actually made something, so a forge short of ore
   * spends nothing.
   */
  workThrough(
    seed: number, village: string, day: number, smiths: number,
    held: { ore: number; timber: number },
    draw: (ore: number, timber: number) => boolean,
  ): boolean {
    const today = Math.floor(day);
    if (!Number.isFinite(today)) return false;
    const last = this.workedOn.get(village);
    if (last !== undefined && today <= last) return false;
    this.workedOn.set(village, today);
    const work = aSmithsDay(seed, village, today, smiths, held, (id) => this.at(village, id));
    if (!work) return false;
    if (!draw(work.made.ore, work.made.timber)) return false;
    this.made(village, work.made.id);
    return true;
  }

  toJSON(): ForgeJson {
    const out: ForgeJson = {};
    for (const [village, shelf] of this.shelves) out[village] = Object.fromEntries(shelf);
    return out;
  }
}
