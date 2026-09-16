import { PROSPER } from './prosperity';
import { ownedBy, type Owner } from './holdings';
import type { Person } from './people';

/**
 * What one villager owes another, which is the one thing this world has never been able to say.
 *
 * `purses.ts` floors a purse at nought and states the reason in so many words: *"a purse that
 * could go negative would be somebody in debt, which this world has no idea what to do with"*.
 * The floor is right and it stays. What was wrong is the sentence after it — the floor was not
 * recording anything, it was *swallowing* something. A villager who could not pay simply did not
 * pay, the thing he was paying for happened anyway, and the man who did the work was quietly
 * worse off with no book anywhere saying so. See `wounds.ts`, where the doctor sets a bone he
 * cannot be paid for and the comment above the fee has always read "and he does not refuse".
 *
 * ## A debt is a claim, not coin
 *
 * This is the whole of the design and every other decision here follows from it. Writing a debt
 * down moves nothing: no purse goes up, no purse goes down, and the sum of the money in a village
 * is exactly what it was a moment before. Coin moves later, on a morning the debtor can spare it,
 * and it moves the way every coin in this world moves — out of one purse and into another,
 * through the one door in `purses.ts` that an audit can see.
 *
 * The alternative was to hand the money over now and record that it is owed back, which is what a
 * bank does and what a reader expects the word "debt" to mean. It is also the version that can
 * break the only rule this economy has. Coin paid now and owed back later is a coin that is in the
 * creditor's purse and on the debtor's books at the same time — two places at once, from the point
 * of view of anything adding the village up — and the day it is written off it has to vanish from
 * one of them. A claim cannot do that, because there was never a second copy of it. An unpaid debt
 * here is not money that exists twice and not money that has gone missing; it is money that has
 * not moved yet, and the reason it can be struck off at a funeral without anybody auditing a hole
 * is that striking it destroys nothing.
 *
 * ## What that costs
 *
 * Being owed is not being rich. A doctor with forty gold of claims against paupers has forty gold
 * of nothing: he cannot spend it, he cannot be taxed on it, and if the village starves he starves
 * with it. That is the honest reading of a claim in a place with no courts, and it is a far better
 * story than a number that behaves like a purse.
 *
 * ## Why no door on the register
 *
 * A village is founded from its seed and lived forward to today, and anything a re-living cannot
 * work out for itself has to be *told* — a violent death, a vote, a raising, an oath. A debt is not
 * one of those. It falls out of a wound and a purse, and the wound already has its door
 * (`Register.hurt`) while the purse is derived like everything else. A second door for the
 * consequence of a fact the register has already been told would be telling it the same thing
 * twice, and two copies of one fact are two copies that can disagree.
 */

/**
 * One claim: who owes it, who holds it, and what is left of it.
 *
 * Three fields and no date, deliberately. Nothing in this world charges interest or presses a
 * claim after a stretch of time, so a day on it would be a field written and never read — and the
 * moment something does want one, the thing it will actually want is the day the *work* was done,
 * which belongs to whatever ordered the work rather than here.
 */
export interface Debt {
  /** Whose obligation it is. */
  who: Owner;
  /** And whose claim. */
  to: Owner;
  /** What is still outstanding, in gold. */
  much: number;
}

/**
 * What a payment did not cover, as a claim, or nothing where it covered the lot.
 *
 * The one way a debt is made in this world, so that a site that short-changes somebody has to say
 * so in one line rather than by quietly clamping. Handed the price and what actually changed
 * hands, on the reasoning that the site doing the paying has already worked both out and should
 * not have to work out the difference twice.
 *
 * Nobody can owe himself anything. A man who sets his own arm is not in debt to a doctor, he is
 * the doctor, and a self-claim would sit on the books for ever being paid from one pocket into
 * the same pocket.
 */
export function whatWasNotPaid(who: Owner, to: Owner, price: number, paid: number): Debt | null {
  const much = Math.round((price - paid) * 100) / 100;
  if (much <= 0 || who === to) return null;
  return { who, to, much };
}

/**
 * What everybody in a village can pay back this morning, and what is left owing afterwards.
 *
 * Pure: it reads purses and writes none. The map it hands back is in the shape `pay` takes — a
 * debit against the debtor and a credit to the creditor, adding to nought across the village —
 * because the whole point of a claim is that the day it turns into money it turns into an ordinary
 * movement of money, audited like every other one.
 *
 * **Read off one morning's purses.** Every debtor is measured against the purse he woke up with,
 * so a chain — A owes B and B owes C — comes out the same whichever order the list happens to be
 * in. Settled one at a time, what B could pay would depend on whether A had paid him yet, which is
 * a morning two machines could live differently while both being right.
 *
 * **Nobody is stripped.** A debtor pays out of what he can spare above `PROSPER.KEEPS_BACK`, the
 * same reserve `spentOnLiving` will not spend below and `pitchFor` will not take a market pitch
 * out of. A man who went hungry to clear an arrear would be a man this world kills with a kindness,
 * and a debt that empties a purse every morning is a debt nobody ever gets out from under.
 *
 * **A claim needs two people who are both here.** One whose debtor or whose creditor has been
 * buried, or has walked over the hill, is struck — there is nobody to press it and nobody to press
 * it against, and this world has no court that could do either. Striking it destroys nothing,
 * which is the whole reason a claim rather than a loan: no coin was ever moved to make it.
 */
export function whatIsPaidBack(
  debts: readonly Debt[], people: readonly Person[],
): { owed: Map<Owner, number>; left: Debt[] } {
  const owed = new Map<Owner, number>();
  const left: Debt[] = [];
  if (debts.length === 0) return { owed, left };

  // every purse as it stood at first light, and what each debtor has already promised out of it
  const purses = new Map<Owner, number>(people.map((person) => [ownedBy(person), person.purse]));
  const spent = new Map<Owner, number>();

  for (const debt of debts) {
    const purse = purses.get(debt.who);
    if (purse === undefined || !purses.has(debt.to)) continue;    // one end of it is not here
    const spare = purse - PROSPER.KEEPS_BACK - (spent.get(debt.who) ?? 0);
    const much = Math.round(Math.max(0, Math.min(debt.much, spare)) * 100) / 100;
    if (much > 0) {
      spent.set(debt.who, (spent.get(debt.who) ?? 0) + much);
      owed.set(debt.who, Math.round(((owed.get(debt.who) ?? 0) - much) * 100) / 100);
      owed.set(debt.to, Math.round(((owed.get(debt.to) ?? 0) + much) * 100) / 100);
    }
    const rest = Math.round((debt.much - much) * 100) / 100;
    if (rest > 0) left.push({ ...debt, much: rest });
  }
  return { owed, left };
}

/**
 * What a dead man's estate settles before his heir sees any of it, and what is left of the estate.
 *
 * The question `inheritance.ts` could not answer and said so: it hands on what somebody held and
 * had nothing to say about what they owed. A man's debts are paid out of what he left, in the
 * order they were incurred, and whatever the estate will not stretch to dies with him. That is
 * both the rule anybody would guess and the only one a world without courts can enforce — there
 * is nobody to pursue, and an heir who inherited a stranger's arrears would be inheriting a
 * punishment rather than an estate.
 *
 * Nothing is destroyed by the part that goes unpaid, for the reason at the head of this file: the
 * coin was never moved, so there is no coin to lose. What the creditor loses is a claim, which is
 * exactly what a creditor loses when a debtor dies.
 *
 * `left` is every other claim in the village, untouched, so the caller can write the whole list
 * back in one line rather than splicing.
 */
export function whatTheEstateSettles(
  debts: readonly Debt[], who: Owner, estate: number, people: readonly Person[],
): { owed: Map<Owner, number>; left: Debt[]; over: number } {
  const owed = new Map<Owner, number>();
  const left: Debt[] = [];
  let over = Math.max(0, Math.round(estate * 100) / 100);

  const here = new Set<Owner>(people.map(ownedBy));
  for (const debt of debts) {
    if (debt.who !== who) { left.push(debt); continue; }
    if (!here.has(debt.to)) continue;                  // nobody left to pay: the claim goes with him
    const much = Math.round(Math.min(debt.much, over) * 100) / 100;
    if (much <= 0) continue;
    over = Math.round((over - much) * 100) / 100;
    owed.set(debt.to, Math.round(((owed.get(debt.to) ?? 0) + much) * 100) / 100);
  }
  return { owed, left, over };
}
