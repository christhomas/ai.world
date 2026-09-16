import { describe, expect, it } from 'vitest';
import { GODS, whatDyingCosts, type Kit } from './reckoning';
import { SHRINE_FEE } from './shrine';

/**
 * What an unplanned exit costs, which until now was nothing.
 *
 * Killed by a wolf, rage quit, a dropped connection: one event. The hero wakes in the nearest town,
 * whole, and pays for it. There is never a permanent death, and the bed at an inn is the only clean
 * exit — that is a proper save and costs only the bed.
 *
 * ## This is not a new system
 *
 * `shrine.ts` is *"the one way a dead valley comes back"*, and says of itself that there is magic
 * and it is deliberately the only magic in the economy — kept from being a tap by its price, which
 * is a house rather than a meal. Three things fall out of that rather than being invented:
 *
 * - **The fee goes to `AWAY`.** The gods are not on the register and keep no purse. `deeds.ts` has
 *   the sanctioned sink for money that genuinely leaves, and it is the honest answer here: the hero
 *   is not paying a villager for this.
 * - **Stripped when he cannot pay is the shrine's own rule.** A raised soul owns nothing — *"what
 *   the shrine makes is a person, not an estate"* — and the hero waking with empty hands is that
 *   same rule reaching him.
 * - **A death is a told fact**, the same shape as a raising and a killing. Determinism for free.
 *
 * ## The number, which the item asked to be decided before building
 *
 * `SHRINE_FEE` is `GROWTH.A_HOUSE`, and as a per-death toll that is brutal — a player would be
 * stripped constantly in their first hour. So the hero's fee is its own constant, cheaper, and the
 * reason is sayable in the world: the gods are reviving a regular customer rather than conjuring a
 * whole new soul out of nothing. A death that genuinely costs a house is a legitimate choice and
 * one line to make; it is recorded on the issue as the alternative rather than silently dropped.
 */

const kit = (...worn: Array<{ id: string; price: number }>): Kit => ({ worn: [...worn] });

describe('what the gods charge', () => {
  it('is less than raising a villager from nothing, and says why', () => {
    expect(GODS.FEE).toBeLessThan(SHRINE_FEE);
    expect(GODS.FEE).toBeGreaterThan(0);
  });

  it('takes it out of the purse when the purse can bear it', () => {
    const bill = whatDyingCosts(GODS.FEE * 3, kit({ id: 'sword', price: 60 }));
    expect(bill.fromPurse).toBe(GODS.FEE);
    expect(bill.taken, 'nothing is taken off a man who can pay').toEqual([]);
    expect(bill.stripped).toBe(false);
  });

  it('takes the kit for what the purse could not cover', () => {
    const bill = whatDyingCosts(0, kit({ id: 'sword', price: 60 }, { id: 'cap', price: 12 }));
    expect(bill.fromPurse).toBe(0);
    expect(bill.taken.length, 'he paid in gear because he had no coin').toBeGreaterThan(0);
  });

  it('takes the dearest thing first, so one blow settles more of it', () => {
    const bill = whatDyingCosts(0, kit({ id: 'cap', price: 12 }, { id: 'sword', price: 60 }));
    expect(bill.taken[0]).toBe('sword');
  });

  it('stops taking once the bill is met, and leaves the rest of the kit alone', () => {
    const rich = kit({ id: 'sword', price: GODS.FEE * 2 }, { id: 'cap', price: 12 });
    expect(whatDyingCosts(0, rich).taken).toEqual(['sword']);
  });

  it('leaves him broke and stripped rather than in debt, which is the floor', () => {
    const bill = whatDyingCosts(1, kit({ id: 'rag', price: 1 }));
    expect(bill.stripped, 'nothing left to take and the bill not met').toBe(true);
    expect(bill.owing, 'there is no debt to the gods; the floor is the floor').toBe(0);
  });

  it('charges a man with nothing at all nothing at all, and still raises him', () => {
    const bill = whatDyingCosts(0, kit());
    expect(bill.fromPurse).toBe(0);
    expect(bill.taken).toEqual([]);
    expect(bill.stripped).toBe(true);
    expect(bill.owing).toBe(0);
  });

  it('never charges more than the fee, however rich he is', () => {
    const bill = whatDyingCosts(4000, kit({ id: 'sword', price: 900 }));
    expect(bill.fromPurse).toBe(GODS.FEE);
    expect(bill.taken).toEqual([]);
  });

  it('conserves: what leaves the purse is what the gods were paid', () => {
    for (const purse of [0, 5, GODS.FEE - 1, GODS.FEE, 4000]) {
      const bill = whatDyingCosts(purse, kit({ id: 'sword', price: 60 }));
      expect(bill.fromPurse).toBeLessThanOrEqual(purse);
      expect(bill.fromPurse).toBeLessThanOrEqual(GODS.FEE);
    }
  });
});

/*
 * And the hero it actually happens to, through the one door that takes anything away.
 */
describe('a hero the gods have put back together', () => {
  it('wakes whole, poorer, and still wearing what the fee did not cover', async () => {
    const { GameState } = await import('../game/state');
    const state = new GameState();
    state.inventory.gold = GODS.FEE * 2;
    state.give('sword', 1);
    state.equip('sword');
    state.damage(9999);
    expect(state.hp, 'dropped').toBe(0);

    const bill = state.raised();
    expect(state.hp, 'a shrine has never made a wounded person').toBe(state.maxHpTotal);
    expect(state.inventory.gold).toBe(GODS.FEE);
    expect(bill.taken, 'he could pay, so nothing was taken off him').toEqual([]);
    expect(state.worn('hand')?.id ?? '').toBe('sword');
  });

  it('is stripped of what he cannot pay for, and keeps no debt', async () => {
    const { GameState } = await import('../game/state');
    const state = new GameState();
    state.inventory.gold = 0;
    state.give('sword', 1);
    state.equip('sword');

    const bill = state.raised();
    expect(state.inventory.gold).toBe(0);
    expect(bill.owing, 'there is no owing the gods').toBe(0);
    expect(bill.taken.length + (bill.stripped ? 1 : 0), 'he paid in something').toBeGreaterThan(0);
  });
});
