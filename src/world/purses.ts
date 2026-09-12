import { PROSPER } from './prosperity';
import type { Settlement } from './settlement';

/**
 * Where a village's money is actually written down.
 *
 * One function, and it is the only place in the game that touches a villager's purse. That was
 * already true inside `register.ts`; what it is out here for is that the rule it enforces is not
 * about the register of who is alive at all. It is about the one thing the whole economy is checked
 * against — a coin leaving one purse arrives in another — and a rule that the audit reads belongs
 * somewhere the audit can see it.
 */

/**
 * Move money into and out of the purses of a village, by id.
 *
 * The one place a purse is written, so the cap and the floor are applied once. Both are
 * deliberately kept: a purse that could go negative would be somebody in debt, which this world
 * has no idea what to do with, and the cap is what stops one long-lived shopkeeper in a quiet
 * corner ending the century with everything.
 *
 * What was new on the 13th is that neither of them is allowed to *destroy* money any more. The
 * deed layer has one rule — a coin leaving one purse arrives in another — and this was the single
 * place in the game that broke it: whatever went over the top of a full purse simply stopped
 * existing, quietly, in the one direction an audit reads as "the world is poorer than its
 * transactions say". Every discrepancy in the hundred-day run was negative, which is how it was
 * found.
 *
 * So the two ends are handed back rather than swallowed. A man who cannot hold any more has his
 * surplus taken by the hall, which turns the cap into a tax on the very rich and gives it
 * somewhere to be — and the hall is the right place, because it is the one purse in a village
 * that is not anybody's. What the floor stops is reported separately and is *not* made good: a
 * man who owes more than he has has simply not paid it, and that is a hole in the day's books
 * rather than a coin the hall can find. It should be nought, and the audit says so.
 */
export function pay(village: Settlement, owed: ReadonlyMap<string, number>): { over: number; short: number } {
  let over = 0, short = 0;
  for (const person of village.people) {
    const much = owed.get(person.id);
    if (much === undefined || much === 0) continue;
    const meant = person.purse + much;
    if (meant > PROSPER.MOST) over += meant - PROSPER.MOST;
    if (meant < 0) short -= meant;
    person.purse = Math.min(PROSPER.MOST, Math.max(0, meant));
  }
  return { over: Math.round(over * 100) / 100, short: Math.round(short * 100) / 100 };
}

/**
 * The same, with the overflow put where it belongs: in the hall.
 *
 * Every caller wants this one. `pay` is the half that touches purses, and this is the half that
 * keeps the books straight, which is a different job and worth being able to read separately.
 */
export function payAndSweep(village: Settlement, owed: ReadonlyMap<string, number>): void {
  const { over } = pay(village, owed);
  if (over > 0) village.purse = Math.round((village.purse + over) * 100) / 100;
}
