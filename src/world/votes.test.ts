import { describe, expect, it } from 'vitest';
import { RAISING_TAKES } from './roofs';
import { Register } from './register';

const trades = ['farmer', 'seller', 'hunter', 'soldier'];
const wealthOf = (register: Register, village: string): number => {
  const people = register.living(village).reduce((sum, person) => sum + person.purse, 0);
  return Math.round((people + (register.hallOf(village)?.purse ?? 0)) * 100) / 100;
};

describe('a vote to become a town', () => {
  it('spends the treasury into resident purses, keeps the hall entity, and moves its body when built', () => {
    const register = new Register(17, 30);
    register.settle('Testing', 16, trades);
    const hall = register.hallOf('Testing')!;
    hall.purse = 5000;
    const before = wealthOf(register, 'Testing');

    const vote = register.vote('Testing', 30);
    expect(vote).toEqual({ kind: 'voted', village: 'Testing', rank: 'town', day: 30 });
    expect(register.hallOf('Testing')).toBe(hall);
    expect(register.rankOf('Testing')).toBe('town');
    expect(register.worksOf('Testing')).toContain('townhall@30');
    expect(wealthOf(register, 'Testing')).toBe(before);
    expect(hall.body).toBe('mayor-house');

    register.advance(30 + RAISING_TAKES);
    expect(register.hallOf('Testing')).toBe(hall);
    expect(hall.body).toBe('town-hall');

    const after = wealthOf(register, 'Testing');
    register.apply(vote!);
    expect(wealthOf(register, 'Testing'), 'the same vote charged twice').toBe(after);
  });

  it('applies a current-day vote in place without erasing wounds or memories', () => {
    const register = new Register(17, 30);
    register.settle('Testing', 16, trades);
    register.hallOf('Testing')!.purse = 5000;
    const resident = register.living('Testing')[0];
    resident.hurt = 3;
    resident.memories = [{ what: 'given', who: 'Rowan', day: 30 }];

    expect(register.apply({ kind: 'voted', village: 'Testing', rank: 'town', day: 30 })).toBe(true);
    expect(register.find(resident.id)).toBe(resident);
    expect(resident.hurt).toBe(3);
    expect(resident.memories).toEqual([{ what: 'given', who: 'Rowan', day: 30 }]);
  });

  it('does not let a refused city motion reserve the later valid vote', () => {
    const register = new Register(17, 30);
    register.settle('Testing', 32, trades);
    const hall = register.hallOf('Testing')!;
    hall.purse = 5000;
    expect(register.apply({ kind: 'voted', village: 'Testing', rank: 'town', day: 30 })).toBe(true);

    expect(register.apply({ kind: 'voted', village: 'Testing', rank: 'city', day: 30 })).toBe(false);
    hall.purse = 15000;
    expect(register.apply({ kind: 'voted', village: 'Testing', rank: 'city', day: 30 })).toBe(true);
    expect(register.rankOf('Testing')).toBe('city');
  });

  it('crosses late and re-lives from the recorded day to the same declared rank', () => {
    const origin = new Register(17, 30);
    origin.settle('Testing', 9, trades);
    origin.advance(900);
    const vote = origin.vote('Testing', 900);
    if (!vote) throw new Error('the grown village never saved enough to call its vote');

    const late = new Register(17, 900);
    late.apply(vote);
    late.settle('Testing', 9, trades);
    expect(late.rankOf('Testing')).toBe('town');
    expect(late.worksOf('Testing')).toContain('townhall@900');
    expect(late.hallOf('Testing')?.purse).toBe(origin.hallOf('Testing')?.purse);
  });
});
