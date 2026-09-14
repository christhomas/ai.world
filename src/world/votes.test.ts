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
