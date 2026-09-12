import { describe, expect, it } from 'vitest';
import type { Person } from './people';
import { Register } from './register';
import { WOUND, ableToWork, doctoredBy, hurtBy, laidUpFor, mendThem } from './wounds';

/**
 * A villager who can be hurt.
 *
 * Until this, a villager had exactly two conditions — alive, and buried — which made every wolf in
 * the country a coin flip and left the village doctor with nothing whatever to do in a game that has
 * had doctors since the first village was laid out.
 */

const villager = (id: string, trade: string, over: Partial<Person> = {}): Person => ({
  id, name: id, village: 'Testing', sex: 'man', trade,
  born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
  purse: 20, hungry: 0, ...over,
} as Person);

describe('how long somebody is laid up', () => {
  it('is longer the worse it was', () => {
    expect(laidUpFor(0.2, null)).toBeLessThan(laidUpFor(1, null));
    expect(laidUpFor(1, null)).toBe(WOUND.WORST);
  });

  it('is nothing at all for somebody who was not hurt', () => {
    expect(laidUpFor(0, null)).toBe(0);
    expect(laidUpFor(-1, null)).toBe(0);
  });

  it('always costs at least a day, because nobody is bitten and back at work within the hour', () => {
    expect(laidUpFor(0.01, null)).toBe(1);
    expect(laidUpFor(0.01, villager('doc', 'doctor'))).toBe(1);
  });

  it('is halved by a doctor, which is the first reason this economy has had to keep one', () => {
    const doctor = villager('doc', 'doctor');
    expect(laidUpFor(1, doctor)).toBeLessThan(laidUpFor(1, null));
    expect(laidUpFor(1, doctor)).toBe(Math.round(WOUND.WORST * (1 - WOUND.DOCTOR_SAVES)));
  });

  it('measures a bite against the only scale of harm the game has', () => {
    expect(hurtBy(0)).toBe(0);
    expect(hurtBy(1e6), 'a wound worse than dying').toBe(1);
  });
});

describe('a village with somebody laid up', () => {
  it('does not count him among the people who work', () => {
    expect(ableToWork(villager('a', 'farmer'))).toBe(true);
    expect(ableToWork(villager('a', 'farmer', { hurt: 2 }))).toBe(false);
  });

  it('mends him a day at a time, and has him back when it is done', () => {
    const hurt = villager('a', 'farmer', { hurt: 2 });
    mendThem([hurt]);
    expect(hurt.hurt).toBe(1);
    mendThem([hurt]);
    expect(hurt.hurt, 'he is still limping a week later').toBeUndefined();
    expect(ableToWork(hurt)).toBe(true);
  });

  it('pays the doctor for setting the bone, once, and not for the lying still afterwards', () => {
    const doctor = villager('doc', 'doctor');
    const hurt = villager('a', 'farmer', { hurt: laidUpFor(1, doctor) });
    const first = mendThem([doctor, hurt]);
    expect(first.get('doc')).toBe(WOUND.FEE);
    expect(first.get('a')).toBe(-WOUND.FEE);
    expect(mendThem([doctor, hurt]).size, 'billed again for lying in bed').toBe(0);
  });

  it('never charges a man for setting his own arm', () => {
    const doctor = villager('doc', 'doctor', { hurt: laidUpFor(1, villager('x', 'doctor')) });
    expect(mendThem([doctor]).size).toBe(0);
  });

  it('takes only what somebody has, because nobody in this world goes into debt', () => {
    const doctor = villager('doc', 'doctor');
    const pauper = villager('a', 'farmer', { hurt: laidUpFor(1, doctor), purse: 1 });
    expect(mendThem([doctor, pauper]).get('doc')).toBe(1);
  });

  it('knows whether anybody there can set a bone at all', () => {
    expect(doctoredBy([villager('a', 'farmer')])).toBeNull();
    expect(doctoredBy([villager('a', 'farmer'), villager('doc', 'doctor')])?.id).toBe('doc');
  });
});

describe('a wound on the register', () => {
  const settle = (): Register => {
    const register = new Register(63, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter', 'doctor']);
    return register;
  };

  it('lays somebody up, and mends them over the days that follow', () => {
    const register = settle();
    const who = register.living('Testing')[0];
    const days = register.hurt(who.id, 1);
    expect(days).toBeGreaterThan(0);
    register.advance(30 + days + 1);
    expect(register.find(who.id)?.hurt, 'he never got up again').toBeUndefined();
  });

  it('is not a way to die: what kills people here is hunger, teeth and years', () => {
    const register = settle();
    const before = register.living('Testing').length;
    for (const person of register.living('Testing')) register.hurt(person.id, 1);
    register.advance(34);
    expect(register.living('Testing').length, 'a village died of grazed knees').toBe(before);
  });

  it('does nothing at all for somebody who is not on the register', () => {
    expect(settle().hurt('nobody-at-all', 1)).toBe(0);
  });
});
