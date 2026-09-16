import { directoryOf, takeTheOath, type Sworn } from './vacancies';
import type { SwornIn } from '../../server/protocol';
import type { Person } from './people';

/**
 * Every oath sworn at a hall, by village.
 *
 * An oath is a *told* fact — a player answers a vacancy, and no seed can imply that — so the
 * register holds them beside the votes and the violent deaths, replays them through `apply`, and
 * writes them into a save. What it does not need to hold is the bookkeeping, which is this.
 *
 * A book rather than a map on the register, for the reason `daybook.ts` and `stablebook.ts` both
 * give: `register.ts` is against the seven hundred lines `architecture.test.ts` allows, and the
 * answer here has never been to argue the cap.
 *
 * ## Why it came out today
 *
 * `main` was over the cap and nothing had caught it. Two pull requests each passed on their own —
 * one shrank this file, one grew it — and the sum of them did not, because strict branch protection
 * tests a branch against `main` *before* the other one lands, so nothing tested the combination.
 * The `main` runs that would have said so were all cancelled by `cancel-in-progress` as the merges
 * arrived faster than the runs finished.
 */
export class OathBook {
  private readonly byVillage = new Map<string, Sworn[]>();

  /** The oaths this village is holding, as the village's own record wants them. */
  of(village: string): Sworn[] {
    return [...(this.byVillage.get(village) ?? [])];
  }

  /**
   * Who is holding what here, and what nobody is doing.
   *
   * The register is where this lives because the register is who is alive — `directoryOf` decides
   * it and knows nothing about villages. This hands it the three lists it needs.
   */
  directory(
    trades: readonly string[], people: readonly Person[], village: string,
  ): ReturnType<typeof directoryOf> {
    return directoryOf(trades, people, this.byVillage.get(village) ?? []);
  }

  /**
   * Write an oath down, if the vacancy is really vacant.
   *
   * Nothing about whether the village exists or the day is in the future: that is the register's,
   * which is the only thing that knows either.
   */
  take(village: string, trade: string, who: string, day: number): Sworn | null {
    const held = this.byVillage.get(village) ?? [];
    const oath = takeTheOath(held, trade, who, day);
    if (!oath) return null;
    this.byVillage.set(village, [...held, oath]);
    return oath;
  }

  /** Every oath anywhere, as told facts, for a save to write down. */
  all(): SwornIn[] {
    return [...this.byVillage].flatMap(([village, held]) => held.map((one) =>
      ({ kind: 'sworn' as const, village, trade: one.trade, who: one.who, day: one.day })));
  }
}
