import { SHRINE_FEE } from './shrine';

/**
 * What the gods charge for putting the hero back on his feet.
 *
 * Every unplanned exit is one event — killed by an animal, a rage quit, a dropped connection — and
 * all three cost the same. The hero wakes in the nearest town, whole, and pays for it. There is
 * never a permanent death, and the bed at an inn is the only clean exit: that is a proper save and
 * costs only the bed.
 *
 * ## Why this is the shrine's rule rather than a new one
 *
 * `shrine.ts` is the one way a dead valley comes back, and says of itself that there is magic in
 * this economy and it is deliberately the only magic — kept from being a tap by its price, which is
 * a house rather than a meal. Three things follow rather than being invented:
 *
 * - **The fee goes to `AWAY`.** The gods are not on the register and keep no purse, and `deeds.ts`
 *   has the sanctioned sink for money that genuinely leaves the world. It is also the honest
 *   answer: the hero is not paying a villager for this.
 * - **Stripped when he cannot pay is the shrine's own rule**, not a punishment bolted on. What the
 *   shrine makes is a person, not an estate — a raised villager owns nothing, and a hero waking
 *   with empty hands is that same sentence reaching him.
 * - **A death is a told fact**, the same shape as a raising and a killing: keep the day, derive the
 *   rest. Determinism answered for free.
 *
 * ## A fairness cost, chosen rather than overlooked
 *
 * A dropped connection costs exactly what a rage quit costs. The server cannot tell them apart
 * without trusting the client, and a grace window is a thing players learn to trigger deliberately.
 */
export const GODS = {
  /**
   * What a raising costs the hero, in gold.
   *
   * A quarter of `SHRINE_FEE`, and the difference is sayable in the world rather than a balance
   * knob: the shrine conjures a whole new soul out of nothing, with a name and a life ahead of it,
   * and this is the gods putting a regular customer back together. They know him. It is cheaper.
   *
   * A full `SHRINE_FEE` per death is a legitimate choice and one line away — it is a *house* — but
   * as a per-death toll it strips a new player constantly in their first hour, and a rule whose
   * ordinary case is "you have nothing again" teaches people to avoid the rule rather than the
   * wolves.
   */
  FEE: Math.round(SHRINE_FEE / 4),
} as const;

/** What the hero is wearing, as this reckoning needs to see it: an id and what it is worth. */
export interface Kit {
  worn: Array<{ id: string; price: number }>;
}

/** What one death came to. */
export interface Bill {
  /** Gold taken out of the purse. Never more than `GODS.FEE`, never more than he had. */
  fromPurse: number;
  /** What was taken off him instead, dearest first, when the purse would not cover it. */
  taken: string[];
  /** Whether the bill was still unmet after everything he had. Broke and stripped is the floor. */
  stripped: boolean;
  /**
   * What is still owed, which is always nought.
   *
   * Said out loud rather than left out, because the obvious next thought is that an unpaid raising
   * becomes a debt — `debts.ts` exists now and would take one. It does not: the floor is the floor,
   * and a hero who owes the gods money is a hero carrying a number he can never discharge in a
   * world where they sell nothing.
   */
  owing: number;
}

/**
 * What this death costs, given what he has.
 *
 * Purse first and then the kit, dearest thing first — so one blow settles as much of the bill as
 * possible and a player loses one good sword rather than everything he was wearing. It stops the
 * moment the bill is met, which is why the order matters: taking cheapest first would strip a man
 * of five small things to raise what one would have covered.
 *
 * Pure, and takes nothing away itself. What it decides has to be applied through `deeds.ts` so that
 * the coin leaving is written down where the audit can see it.
 */
export function whatDyingCosts(purse: number, kit: Kit): Bill {
  const fromPurse = Math.max(0, Math.min(GODS.FEE, Math.floor(purse)));
  let left = GODS.FEE - fromPurse;
  const taken: string[] = [];
  if (left > 0) {
    // dearest first, and a copy, because a reckoning does not get to reorder somebody's kit
    for (const thing of [...kit.worn].sort((a, b) => b.price - a.price)) {
      if (left <= 0) break;
      taken.push(thing.id);
      left -= Math.max(0, thing.price);
    }
  }
  return { fromPurse, taken, stripped: left > 0, owing: 0 };
}
