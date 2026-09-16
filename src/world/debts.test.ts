import { describe, expect, it } from 'vitest';
import { whatIsPaidBack, whatTheEstateSettles, whatWasNotPaid, type Debt } from './debts';
import { aDaysIncome } from './expected';
import { ownerFromSave, type Owner } from './holdings';
import type { Person } from './people';
import { PROSPER } from './prosperity';
import { Register } from './register';
import { MENDS, WOUND, doctoredBy } from './wounds';

/**
 * A claim, and the one rule it is not allowed to break.
 *
 * `purses.ts` floors a purse at nought and says why — "a purse that could go negative would be
 * somebody in debt, which this world has no idea what to do with" — and the floor is the reason
 * these tests are mostly about arithmetic that does *not* happen. A debt writes nothing into a
 * purse. Nobody is richer for being owed and nobody is poorer for owing, right up until the
 * morning a coin actually moves, and then it moves the way every other coin in this world moves:
 * out of one purse and into another.
 */

const villager = (id: string, over: Partial<Person> = {}): Person => ({
  id, name: id, village: 'Testing', sex: 'man', trade: 'farmer',
  born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
  purse: 20, hungry: 0, ...over,
} as Person);

const owner = (id: string): Owner => ownerFromSave(id);
const owes = (who: string, to: string, much: number): Debt => ({ who: owner(who), to: owner(to), much });
const inThe = (people: readonly Person[]): number => people.reduce((all, p) => all + p.purse, 0);

describe('writing down what somebody could not pay', () => {
  it('is nothing at all when the whole of it was paid', () => {
    expect(whatWasNotPaid(owner('a'), owner('b'), 4, 4)).toBeNull();
    expect(whatWasNotPaid(owner('a'), owner('b'), 4, 5)).toBeNull();
  });

  it('is the rest of it when it was not', () => {
    expect(whatWasNotPaid(owner('a'), owner('b'), 4, 1)).toEqual(owes('a', 'b', 3));
    expect(whatWasNotPaid(owner('a'), owner('b'), 4, 0)).toEqual(owes('a', 'b', 4));
  });

  it('is nobody owing himself anything, which is what a man setting his own arm would be', () => {
    expect(whatWasNotPaid(owner('a'), owner('a'), 4, 0)).toBeNull();
  });
});

describe('paying back what is owed', () => {
  it('moves no coin the morning the debt is written: a claim is not money', () => {
    const people = [villager('a'), villager('b')];
    const before = inThe(people);
    whatIsPaidBack([owes('a', 'b', 10)], people);
    expect(inThe(people), 'a debt put coin in a purse').toBe(before);
  });

  it('takes it out of one purse and puts it in another, to the coin', () => {
    const people = [villager('a', { purse: 20 }), villager('b', { purse: 5 })];
    const { owed } = whatIsPaidBack([owes('a', 'b', 10)], people);
    expect(owed.get(owner('a'))).toBe(-10);
    expect(owed.get(owner('b'))).toBe(10);
    expect([...owed.values()].reduce((all, m) => all + m, 0), 'a coin went missing on the way').toBe(0);
  });

  it('leaves a man what he lives on, the same reserve nobody spends into', () => {
    const people = [villager('a', { purse: PROSPER.KEEPS_BACK + 2 }), villager('b')];
    const { owed, left } = whatIsPaidBack([owes('a', 'b', 10)], people);
    expect(owed.get(owner('a'))).toBe(-2);
    expect(left).toEqual([owes('a', 'b', 8)]);
  });

  it('asks nothing at all of a man who has no more than that', () => {
    const people = [villager('a', { purse: PROSPER.KEEPS_BACK }), villager('b')];
    const { owed, left } = whatIsPaidBack([owes('a', 'b', 10)], people);
    expect(owed.size).toBe(0);
    expect(left).toEqual([owes('a', 'b', 10)]);
  });

  it('drops a debt once it has been paid off, rather than carrying a nought about', () => {
    const people = [villager('a', { purse: 20 }), villager('b')];
    expect(whatIsPaidBack([owes('a', 'b', 4)], people).left).toEqual([]);
  });

  /*
   * A claim is between two people who can look each other in the eye. When one of them is not
   * here — buried, or walked over the hill to the next valley — there is nobody to press it and
   * nobody to press it against, and the world has nothing that could. Struck rather than kept,
   * and striking one destroys nothing, because no coin was ever moved to make it.
   */
  it('strikes a claim when either end of it has left the village', () => {
    const people = [villager('a')];
    expect(whatIsPaidBack([owes('a', 'gone', 10)], people).left).toEqual([]);
    expect(whatIsPaidBack([owes('gone', 'a', 10)], people).left).toEqual([]);
  });

  /*
   * Read off one morning's purses rather than settled one debt at a time, so that a chain — A owes
   * B, B owes C — comes out the same however the list happens to be ordered. A morning where what
   * B could pay depended on whether A had paid him yet is a morning two machines could disagree
   * about.
   */
  it('reads every purse as it stood at first light, so the order of the list cannot matter', () => {
    const people = [
      villager('a', { purse: PROSPER.KEEPS_BACK + 4 }),
      villager('b', { purse: PROSPER.KEEPS_BACK }),
      villager('c', { purse: PROSPER.KEEPS_BACK }),
    ];
    const chain = [owes('a', 'b', 4), owes('b', 'c', 4)];
    const forwards = whatIsPaidBack(chain, people).owed;
    const backwards = whatIsPaidBack([...chain].reverse(), people).owed;
    expect(forwards.get(owner('b'))).toBe(4);
    expect(backwards.get(owner('b'))).toBe(4);
  });
});

describe('what a dead man owed', () => {
  it('comes out of his estate before his heir sees any of it', () => {
    const people = [villager('doc')];
    const settled = whatTheEstateSettles([owes('a', 'doc', 3)], owner('a'), 10, people);
    expect(settled.owed.get(owner('doc'))).toBe(3);
    expect(settled.over, 'the heir was handed money that was not his').toBe(7);
    expect(settled.left).toEqual([]);
  });

  it('takes what there is and no more, and the rest of the claim dies with him', () => {
    const people = [villager('doc')];
    const settled = whatTheEstateSettles([owes('a', 'doc', 9)], owner('a'), 4, people);
    expect(settled.owed.get(owner('doc'))).toBe(4);
    expect(settled.over).toBe(0);
    expect(settled.left, 'a claim outlived the man it was against').toEqual([]);
  });

  it('leaves a claim against anybody else exactly where it was', () => {
    const people = [villager('doc')];
    const settled = whatTheEstateSettles([owes('b', 'doc', 3)], owner('a'), 10, people);
    expect(settled.over).toBe(10);
    expect(settled.left).toEqual([owes('b', 'doc', 3)]);
  });
});

/**
 * The same claim, lived rather than argued about.
 *
 * Everything above is arithmetic on a list. This is a village: somebody is mauled, the doctor sets
 * the bone, the man cannot pay, and the days afterwards have to do something sensible about it.
 * The forecast test below is the one that matters most — a day that moves coin in a way no book
 * mentions is exactly what `chore test economy` reads as coin appearing from nowhere, so the
 * roll has to know that a morning settles debts as well as wages.
 */
describe('a debt in a village that goes on living', () => {
  const settled = (): { register: Register; doctor: Person; patient: Person } => {
    const register = new Register(63, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter', 'doctor']);
    const people = register.living('Testing');
    const doctor = doctoredBy(people) ?? people[0];
    doctor.trade = MENDS;
    const patient = people.find((p) => p.id !== doctor.id && p.trade)!;
    patient.purse = 0;
    return { register, doctor, patient };
  };

  it('is written down when the man had nothing to pay the doctor with', () => {
    const { register, doctor, patient } = settled();
    register.hurt(patient.id, 1);
    register.advance(31);
    const claims = register.owedIn('Testing');
    expect(claims.length).toBe(1);
    expect(claims[0].who).toBe(ownerFromSave(patient.id));
    expect(claims[0].to).toBe(ownerFromSave(doctor.id));
    // what he could not find of the fee, which is most of it and not all of it: he is laid up and
    // earns nothing, but a village still pays a man his share of the dinner it ate
    expect(claims[0].much).toBeGreaterThan(0);
    expect(claims[0].much).toBeLessThanOrEqual(WOUND.FEE);
  });

  it('is gone off the books once he has something to pay it with', () => {
    const { register, patient } = settled();
    register.hurt(patient.id, 1);
    register.advance(31);
    expect(register.owedIn('Testing').length).toBe(1);
    patient.purse = 60;                               // he came into something, and can now pay
    register.advance(32);
    expect(register.owedIn('Testing'), 'the claim was never settled').toEqual([]);
  });

  /*
   * The half of this that the economy bench would find and no unit test would.
   *
   * A morning settles debts in the same book it pays its wages out of, so the roll's forecast has
   * to carry the movement or a doctor's arrears arrive in his purse with nothing in any book to
   * explain it — which is precisely the failure `chore test economy` reports, a hundred lines of
   * it. Read as a difference rather than as an absolute: the forecast is already held to the coin
   * over eighteen hundred village-days, and what is being asserted here is that a claim moves it
   * by exactly what the claim is worth and by nothing else.
   */
  it("is in the roll's forecast, to the coin, and moves nothing else in it", () => {
    const people = [villager('a', { purse: 40 }), villager('b', { purse: 40, trade: 'doctor' })];
    const quiet = aDaysIncome(people, 0, 0, 100);
    const owing = aDaysIncome(people, 0, 0, 100, undefined, [owes('a', 'b', 10)]);
    expect(owing.get(owner('a'))! - quiet.get(owner('a'))!).toBeCloseTo(-10, 6);
    expect(owing.get(owner('b'))! - quiet.get(owner('b'))!).toBeCloseTo(10, 6);
  });

  it('dies with the man who owed it, out of his estate first', () => {
    const { register, doctor, patient } = settled();
    register.hurt(patient.id, 1);
    register.advance(31);
    patient.purse = 1;
    const had = doctor.purse;
    register.bury(patient.id, 31);
    expect(doctor.purse - had, 'the estate did not reach his creditor').toBe(1);
    expect(register.owedIn('Testing'), 'a claim outlived the man it was against').toEqual([]);
  });
});
