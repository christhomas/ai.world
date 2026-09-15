import { commissionAStable, type StablePurchase, type StableYard } from './farmbuilds';
import type { Settlement } from './settlement';

/**
 * Which village bought a stable on which morning, and the one rule that a morning is bought once.
 *
 * Out of `register.ts`, which was over the length the architecture test allows a module to reach.
 * The cut is not arbitrary: everything here is keyed by village and morning and touches nothing
 * else the register holds, so it is the piece of that file which was already standing on its own.
 *
 * A purchase is kept rather than derived, for the reason every told fact is: a village is re-lived
 * from its founding whenever anybody learns something new about its past, and a stable bought with
 * timber a player carried in is not something a seed can work out again.
 */
export class StableBook {
  private readonly bought = new Map<string, StablePurchase>();

  private key(village: string, day: number): string { return `${village}:${Math.floor(day)}`; }

  /** What this village bought on that morning, or nothing. */
  on(village: string, day: number): StablePurchase | null {
    return this.bought.get(this.key(village, day)) ?? null;
  }

  /** Restore purchases before catching the register up, so works and payments replay in order. */
  remember(purchases: readonly StablePurchase[]): void {
    for (const purchase of purchases) {
      this.bought.set(this.key(purchase.village, purchase.day), { ...purchase });
    }
  }

  /**
   * Commission at most one rung for a morning that has not been lived yet.
   *
   * The caller hands in the morning rather than today, and that is the fix for a real fault. A
   * builder's morning runs beside the register: `tidings.ts` lives each missed day — `builderDay(day)`
   * then `advance(day)` — and then, when no day was missed at all, calls `builderDay(today)` once
   * more so that a commission placed after the register's own work still gets a morning.
   *
   * That last call used to hand `state.day` in, and `advance` lives every day *after* the one it is
   * standing on. So a purchase dated today, on a register already standing on today, was never
   * lived: no charge, no wage, no wider paddock. It then appeared out of nowhere on the next
   * reopening, when the founding was replayed and that morning came round again — charging a farmer
   * for a stable commissioned in a session that had ended.
   *
   * `today + 1` is the same day in both paths. Inside the missed-day loop the register is standing
   * on the day before the one being lived, so it is that day; after it, it is tomorrow. One
   * expression, lived exactly once, and keyed by village and morning so a replay cannot pay twice.
   */
  commission(
    village: string, settlement: Settlement | undefined, on: number, yard: StableYard,
  ): StablePurchase | null {
    if (!settlement) return null;
    const key = this.key(village, on);
    if (this.bought.has(key)) return null;
    const purchase = commissionAStable(village, settlement, yard, on);
    if (purchase) this.bought.set(key, purchase);
    return purchase;
  }
}
