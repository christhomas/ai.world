import { describe, expect, it } from 'vitest';
import { parentsFrom, type Person } from './people';

/**
 * Who somebody married, which nothing in this world has ever said.
 *
 * `Person` carries `mother` and `father` by name, and a household is *inferred* from a surname —
 * `familiesUnder` buckets people by `surnameOf` and says so. So people paired invisibly and stopped
 * pairing invisibly, and `inheritance.ts` had to guess: it hands an estate to "an adult of their own
 * surname first, because a household is what actually inherits".
 *
 * A spouse is that guess made into a fact. It is a name rather than an id, matching `mother` and
 * `father` and the rule this file keeps about the dead not being kept.
 *
 * ## The trap, and why these tests are mostly about it
 *
 * `parentsFrom` spends two rolls. A village's whole life is drawn off one stream, so a version that
 * spent *one* roll where a mother was already married would re-roll every village in every world
 * from that morning on — the hazard `people.ts` warns about in as many words. So the second roll is
 * always spent, whether or not its answer is used.
 */

let next = 0;
const soul = (sex: 'woman' | 'man', name: string, spouse = ''): Person => {
  next++;
  return {
    id: `p${next}`, name, village: 'Ashford', sex, trade: 'farmer', born: -30, lives: 70,
    mother: '', father: '', knows: [], memories: [], opinions: [], purse: 10, hungry: 0, spouse,
  };
};

/** A stream that records how many times it was asked, which is the thing under test. */
const counting = (...rolls: number[]): { rng: () => number; spent: () => number } => {
  let at = 0;
  return { rng: () => rolls[at++ % rolls.length], spent: () => at };
};

describe('who a child\'s parents are once people marry', () => {
  it('takes the mother\'s husband as the father, rather than drawing a stranger', () => {
    const wife = soul('woman', 'Maren Vos', 'Joris Vos');
    const husband = soul('man', 'Joris Vos', 'Maren Vos');
    const other = soul('man', 'Piet Bakker');
    // the second roll would land on `other`; the marriage must win
    const [mother, father] = parentsFrom([wife, husband, other], counting(0.1, 0.9).rng);
    expect(mother.name).toBe('Maren Vos');
    expect(father.name).toBe('Joris Vos');
  });

  it('spends the second roll anyway, so no village in the world is re-rolled', () => {
    const wife = soul('woman', 'Maren Vos', 'Joris Vos');
    const husband = soul('man', 'Joris Vos', 'Maren Vos');
    const stream = counting(0.1, 0.9);
    parentsFrom([wife, husband], stream.rng);
    expect(stream.spent(), 'a marriage must cost exactly the rolls a drawing did').toBe(2);
  });

  it('draws a father as before when the mother has nobody', () => {
    const single = soul('woman', 'Anouk Meer');
    const man = soul('man', 'Piet Bakker');
    const [mother, father] = parentsFrom([single, man], counting(0.1, 0.9).rng);
    expect(mother.name).toBe('Anouk Meer');
    expect(father.name).toBe('Piet Bakker');
  });

  it('draws a father when the husband is not in the village any more', () => {
    const widow = soul('woman', 'Maren Vos', 'Joris Vos');   // Joris is not on this roll
    const man = soul('man', 'Piet Bakker');
    const [, father] = parentsFrom([widow, man], counting(0.1, 0.9).rng);
    expect(father.name).toBe('Piet Bakker');
  });

  it('never names a woman as the husband, however the names line up', () => {
    const wife = soul('woman', 'Maren Vos', 'Griet Vos');    // a woman of the same surname
    const griet = soul('woman', 'Griet Vos');
    const man = soul('man', 'Piet Bakker');
    const [, father] = parentsFrom([wife, griet, man], counting(0.1, 0.9).rng);
    expect(father.sex).toBe('man');
  });

  it('still says no father where there is no man at all', () => {
    const women = [soul('woman', 'Maren Vos'), soul('woman', 'Anouk Meer')];
    const [mother, father] = parentsFrom(women, counting(0.1, 0.9).rng);
    expect(father).toBe(mother);
  });
});

/*
 * And the three things a stated marriage buys, which were guesses before it.
 */
describe('what a marriage is for', () => {
  it('is written down by the birth of a child, at no extra roll', async () => {
    const { Register } = await import('./register');
    const book = new Register(11, 1);
    book.settle('Ashford', 8, ['farmer', 'seller']);
    for (let day = 2; day <= 60; day++) book.advance(day);
    const married = book.living('Ashford').filter((p) => p.spouse);
    expect(married.length, 'sixty days and nobody married').toBeGreaterThan(0);
  });

  it('is agreed on both sides, so nobody is married to somebody who is not married to them', async () => {
    const { Register } = await import('./register');
    const book = new Register(11, 1);
    book.settle('Ashford', 8, ['farmer', 'seller']);
    for (let day = 2; day <= 60; day++) book.advance(day);
    const here = book.living('Ashford');
    for (const one of here.filter((p) => p.spouse)) {
      const other = here.find((p) => p.name === one.spouse);
      // the other may have died and been buried; if they are alive it must be mutual
      if (other) expect(other.spouse, `${one.name} and ${one.spouse}`).toBe(one.name);
    }
  });

  it('never marries somebody to themselves', async () => {
    const { Register } = await import('./register');
    const book = new Register(11, 1);
    book.settle('Ashford', 8, ['farmer', 'seller']);
    for (let day = 2; day <= 60; day++) book.advance(day);
    for (const one of book.living('Ashford')) expect(one.spouse ?? '').not.toBe(one.name);
  });
});
