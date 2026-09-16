import { describe, expect, it } from 'vitest';
import { AILMENT, fallIll, wellEnough } from './ailments';
import { Register } from './register';
import type { Person } from './people';

/**
 * People fall ill, which until now nobody in this world ever did.
 *
 * `Person` had `hurt` and `wounds.ts` mended it, and nothing in the running game ever set it: the
 * only writer was `Register.hurt`, and its only callers were its own tests. Violence went straight
 * to `bury`. So a villager had two conditions, alive and buried, and the doctor — who draws a
 * trader's wage every day in `PROSPER.TRADERS` — had no patients at all.
 *
 * Hunger was the economy's one way to hurt a village. Illness is the second, and it is a different
 * shape: hunger is the village's books going wrong, and this is a person's own week going wrong
 * while the books are fine.
 *
 * ## The stream
 *
 * Off `${village}:ill` rather than the village's own daily stream, which is the same thing
 * `raiseWhoIsDue` does with `${village}:shrine`. A village's life is drawn off one stream and every
 * draw added to it re-rolls every village in every world from that morning on. A named side stream
 * costs nothing and moves nothing.
 *
 * ## Why there is no `Register.ail`
 *
 * `hurt` needs a door because violence is *told*: a wolf on somebody's screen is not something a
 * re-lived village can work out for itself. A daily roll is not told, it is lived, so a village
 * re-founded from its seed falls ill on exactly the same mornings. Adding a door would be inventing
 * a fact that needs preserving when there is not one.
 */

let next = 0;
const soul = (over: Partial<Person> = {}): Person => {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Ashford', sex: 'woman', trade: 'farmer',
    born: -30, lives: 70, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse: 20, hungry: 0, ...over,
  };
};

/** A stream that says exactly these things, so a chance is a decision. */
const rolls = (...some: number[]) => {
  let at = 0;
  return () => some[at++ % some.length];
};
/** Caught it, as badly as it comes. */
const always = (n: number) => rolls(n, 1);

describe('falling ill', () => {
  it('lays somebody up for days, not for a moment', () => {
    const people = [soul()];
    fallIll(people, always(0), { baths: false, day: 10 });
    expect(people[0].ill ?? 0).toBeGreaterThan(0);
  });

  it('leaves a village alone on an ordinary morning', () => {
    const people = [soul(), soul(), soul()];
    fallIll(people, always(0.99), { baths: false, day: 10 });
    expect(people.every((p) => (p.ill ?? 0) === 0)).toBe(true);
  });

  it('does not make somebody who is already ill iller', () => {
    const people = [soul({ ill: 3 })];
    fallIll(people, always(0), { baths: false, day: 10 });
    expect(people[0].ill).toBe(3);
  });

  it('leaves the wounded to their wound rather than piling one on the other', () => {
    const people = [soul({ hurt: 4 })];
    fallIll(people, always(0), { baths: false, day: 10 });
    expect(people[0].ill ?? 0).toBe(0);
  });

  it('is rarer where the village built a bath house, which is what one is for', () => {
    const roll = AILMENT.A_DAY * (1 - AILMENT.BATHS_SAVE) + 0.0001;   // under the plain chance, over the bathed one
    const plain = [soul()];
    const bathed = [soul()];
    fallIll(plain, always(roll), { baths: false, day: 10 });
    fallIll(bathed, always(roll), { baths: true, day: 10 });
    expect(plain[0].ill ?? 0).toBeGreaterThan(0);
    expect(bathed[0].ill ?? 0).toBe(0);
  });

  it('is shorter where somebody can treat it, and charges them for it', () => {
    const sick = soul();
    const doctor = soul({ trade: 'doctor' });
    const alone = [soul()];
    fallIll(alone, always(0), { baths: false, day: 10 });
    const fees = fallIll([sick, doctor], rolls(0, 1), { baths: false, day: 10 });
    expect(sick.ill!).toBeLessThan(alone[0].ill!);
    expect([...fees.values()].reduce((a, b) => a + b, 0), 'a fee is a coin moved, not minted').toBe(0);
    expect([...fees.values()].some((v) => v > 0), 'somebody was paid').toBe(true);
  });

  it('never bills somebody who has not got it', () => {
    const pauper = soul({ purse: 0 });
    const doctor = soul({ trade: 'doctor' });
    const fees = fallIll([pauper, doctor], always(0), { baths: false, day: 10 });
    expect([...fees.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(pauper.purse).toBe(0);
  });

  it('never bills the doctor for his own illness', () => {
    const doctor = soul({ trade: 'doctor' });
    fallIll([doctor], always(0), { baths: false, day: 10 });
    expect(doctor.purse).toBe(20);
  });
});

describe('who can work today', () => {
  it('says no to somebody laid up ill, the same as somebody laid up hurt', () => {
    expect(wellEnough(soul({ ill: 2 }))).toBe(false);
    expect(wellEnough(soul({ hurt: 2 }))).toBe(false);
    expect(wellEnough(soul())).toBe(true);
  });
});

/*
 * And the part that is not arithmetic: that a village lived forward actually gets ill, gets better,
 * and gets ill the same way twice.
 */
describe('a village that lives with illness in it', () => {
  const live = (): Register => {
    const book = new Register(11, 1);
    book.settle('Ashford', 8, ['farmer', 'doctor']);
    for (let day = 2; day <= 120; day++) book.advance(day);
    return book;
  };

  it('has somebody take to their bed at some point in four months', () => {
    const book = new Register(11, 1);
    book.settle('Ashford', 8, ['farmer', 'doctor']);
    let ever = false;
    for (let day = 2; day <= 120; day++) {
      book.advance(day);
      if (book.living('Ashford').some((p) => (p.ill ?? 0) > 0)) ever = true;
    }
    expect(ever, 'a hundred and twenty days and nobody caught anything').toBe(true);
  });

  it('lets them get better rather than keeping them in bed for good', () => {
    const book = live();
    const stuck = book.living('Ashford').filter((p) => (p.ill ?? 0) > AILMENT.WORST);
    expect(stuck).toEqual([]);
  });

  it('falls ill on the same mornings when the same village is lived again', () => {
    const one = live();
    const two = live();
    const shape = (book: Register) =>
      book.living('Ashford').map((p) => `${p.name}:${p.ill ?? 0}`).sort().join('|');
    expect(shape(one)).toBe(shape(two));
  });
});
