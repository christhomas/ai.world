/**
 * What moved in and out of each purse on the last day that person lived through.
 *
 * Four ledgers, one shape, one lifetime: the hall's tax, the hall's wages, whatever a carrier paid
 * or was paid, and what a day on somebody's post was worth. All of them are per *person* rather than per village, and that is the point
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
 * They were three maps on the register, and a fourth would have been written the same way. They
 * are cleared together, read together and mean the same kind of thing, and `register.ts` is at the
 * seven hundred lines the architecture test allows and has been extracted twice already for
 * exactly this reason — `larder.ts` and `stablebook.ts` came out of it the same way.
 */
export class DayBook {
  private readonly taxed = new Map<string, number>();
  private readonly waged = new Map<string, number>();
  private readonly carried = new Map<string, number>();
  private readonly posted = new Map<string, number>();

  /** The hall took this from them today. */
  tax(id: string, much: number): void { this.taxed.set(id, much); }

  /** The hall paid them this today, for work the village bought. */
  wage(id: string, much: number): void { this.waged.set(id, much); }

  /** A carrier moved this into their purse, or out of it where it is negative. */
  cart(id: string, much: number): void { this.carried.set(id, much); }

  /**
   * A day of standing somebody's post, or of paying for one where it is negative.
   *
   * The fourth ledger, and it is here for the reason the other three are: a man on another man's
   * gate is money moving *inside* a village between two people, so a village total cannot square it
   * and a row that carries its own wage needs no argument about who was standing when it moved.
   *
   * Added because the posting stopped being something the page did. It used to be paid out of
   * `tidings.ts`, on the client, inside the loop over the warbands — so it happened because a frame
   * was drawn, and a holding earned nothing on any day its owner was not looking at it. See #264.
   *
   * Set rather than added, exactly as the tax and the hall's wages are, and for a reason a village
   * being re-lived makes visible: `advance` clears the book every morning, but a village founded and
   * caught up inside `settle` lives a hundred days without one. A ledger that added would hand the
   * audit the sum of every morning that village ever had. What is wanted is the last one. Several
   * posts on one morning are summed before they get here.
   */
  post(id: string, much: number): void { this.posted.set(id, much); }

  /** What the hall took from one person on the last day they lived through. */
  taxPaidBy(id: string): number { return this.taxed.get(id) ?? 0; }

  /** And what it paid them. Nought on nearly every day. */
  hallPaid(id: string): number { return this.waged.get(id) ?? 0; }

  /** What the next valley paid this person today, or what they paid it. Nought on most days. */
  carriedBy(id: string): number { return this.carried.get(id) ?? 0; }

  /** What a post paid this person today, or what one cost them. Nought on most days. */
  postedTo(id: string): number { return this.posted.get(id) ?? 0; }

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
    this.posted.clear();
  }
}
