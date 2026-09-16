import { describe, expect, it } from 'vitest';
import { parentsFrom, type Person } from './people';

/**
 * Who a child's parents are when the village has nobody of one sex left in it.
 *
 * `parentsFrom` picks a woman and a man, and fell back to *any* adult when it could not find one of
 * either — so a village that had buried its last man named a woman as somebody's father. The
 * register's own guard reads it as a man written down as a mother, which is how this was found:
 * `chore test economy` walked a village into that state the day what a meal costs stopped being a
 * constant, because a different set of people survived a hard season.
 *
 * It was never about prices. The fallback has been there the whole time and was waiting for a
 * village lopsided enough to reach it, which is the shape of the faults this codebase keeps finding
 * in benches rather than in tests: always reachable, rarely reached.
 *
 * A village with no man in it has no father to name. That is not a gap to paper over with the
 * nearest adult — it is the truth about the place, and `births.ts` already writes it down properly,
 * naming no father when both parents come back the same person.
 */

let next = 0;
const soul = (sex: 'woman' | 'man'): Person => {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Lastwomen', sex, trade: 'farmer',
    born: -30, lives: 70, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse: 10, hungry: 0,
  };
};

const roll = (...rolls: number[]): (() => number) => {
  let at = 0;
  return () => rolls[at++ % rolls.length];
};

describe('parents in a village missing a sex', () => {
  it('never names somebody of the wrong sex as a parent', () => {
    const women = [soul('woman'), soul('woman'), soul('woman')];
    const [mother, father] = parentsFrom(women, roll(0.1, 0.9));
    // the father slot may hold the mother — that is how "no father" is said — but it must never
    // hold a *different* woman, which is what the old fallback did
    expect(mother.sex).toBe('woman');
    expect(father === mother || father.sex === 'man', 'a second woman was named as the father')
      .toBe(true);
  });

  it('says so by handing back the one parent twice, which is how births.ts writes it down', () => {
    const women = [soul('woman'), soul('woman')];
    const [mother, father] = parentsFrom(women, roll(0.1, 0.9));
    expect(father).toBe(mother);
  });

  it('names no mother where there is no woman either', () => {
    const men = [soul('man'), soul('man')];
    const [mother, father] = parentsFrom(men, roll(0.1, 0.9));
    expect(mother).toBe(father);
    expect(mother.sex).toBe('man');
  });

  it('still pairs a woman with a man where the village has both', () => {
    const folk = [soul('woman'), soul('man'), soul('woman'), soul('man')];
    const [mother, father] = parentsFrom(folk, roll(0.1, 0.9));
    expect(mother.sex).toBe('woman');
    expect(father.sex).toBe('man');
    expect(father).not.toBe(mother);
  });
});
