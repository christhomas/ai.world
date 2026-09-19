/**
 * What moved in and out of each purse on the last day that person lived through.
 *
 * Three ledgers, one shape, one lifetime: the hall's tax, the hall's wages, and whatever a carrier
 * paid or was paid. All of them are per *person* rather than per village, and that is the point
 * rather than an implementation detail — a village total cannot be squared against a roll that has
 * lost somebody overnight. Every attempt at it turns into an argument about who was still standing
 * when the money moved, and a row that carries its own tax needs no such argument.
 *
 * `chore test economy` is the only thing that reads any of it, and it is the only thing that ever
 * needed to. The conservation audit asks each person what they were charged and what they were
 * handed, and adds it up against what their purse actually did.
 *
 * ## Why it is a book rather than three maps on the register
 *
 * They were three maps on the register, written the same way. They are cleared together, read
 * together and mean the same kind of thing, and `register.ts` is at the seven hundred lines the
 * architecture test allows and has been extracted twice already for exactly this reason —
 * `larder.ts` and `stablebook.ts` came out of it the same way.
 *
 * ## Why there is no fourth ledger for the posts
 *
 * There was one, and it did not survive being asked #264's fourth question. Everything here is one
 * day deep and cleared every morning by `advance` — which is right for the hall and the carrier,
 * and was wrong for a post, because the catch-up inside `settle` lives a hundred mornings and
 * clears nothing. A re-lived village therefore answered with the last value ever *written* for
 * somebody rather than with today's, and on seed 1234 at day 120 that put two people in the roll
 * charged and paid for a morning no post of theirs stood on.
 *
 * A wage is not the same kind of fact as a tax. The hall's tax is a fact about a person's day; a
 * post is a fact about a **holding**, which outlives whoever stood on it and goes on earning while
 * its owner is not looking. It is kept for the life of the save now, keyed by the morning, in
 * `holdingbook.ts` — and being keyed by the morning is what made the divergence above impossible
 * rather than fixed.
 */
export class DayBook {
  private readonly taxed = new Map<string, number>();
  private readonly waged = new Map<string, number>();
  private readonly carried = new Map<string, number>();

  /** The hall took this from them today. */
  tax(id: string, much: number): void { this.taxed.set(id, much); }

  /** The hall paid them this today, for work the village bought. */
  wage(id: string, much: number): void { this.waged.set(id, much); }

  /** A carrier moved this into their purse, or out of it where it is negative. */
  cart(id: string, much: number): void { this.carried.set(id, much); }

  /** What the hall took from one person on the last day they lived through. */
  taxPaidBy(id: string): number { return this.taxed.get(id) ?? 0; }

  /** And what it paid them. Nought on nearly every day. */
  hallPaid(id: string): number { return this.waged.get(id) ?? 0; }

  /** What the next valley paid this person today, or what they paid it. Nought on most days. */
  carriedBy(id: string): number { return this.carried.get(id) ?? 0; }

  /**
   * The map a carrier writes its day into.
   *
   * Handed out rather than copied in afterwards, because a cart is settled between two villages at
   * once and the alternative is the caller keeping a map of its own and merging it — which is a
   * second place the same numbers live. See `carriers.ts`.
   */
  get cartsToday(): Map<string, number> { return this.carried; }

  /** A new morning: yesterday's tax and yesterday's wages are not today's. */
  clear(): void {
    this.taxed.clear();
    this.waged.clear();
    this.carried.clear();
  }
}
