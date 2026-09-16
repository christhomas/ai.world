import { describe, expect, it } from 'vitest';
import { Register } from '../world/register';
import { whoTheyCameFrom } from './descent';
import { paletteFor, type Face } from '../ui/portrait';

/**
 * Whether the descent anybody worked out is the descent anybody gets.
 *
 * `20f4968` built the whole of it: `HERITABLE`, `inherited`, `THROWBACK`, six generations of
 * `paletteFor`, and `whoTheyCameFrom` to walk the register. `descent.test.ts` proved the arithmetic
 * and went green, and the game went on drawing every face out of `hash(id)` alone — because
 * `whoTheyCameFrom` looked its parents up with `register.find(id)` while `Person.mother` and
 * `Person.father` hold *names*:
 *
 *     // src/world/people.ts — "Parents by name rather than id"
 *     child.mother = mother.name;      // 'Greta Vos'
 *     // src/world/register.ts
 *     find(id: string) { ... village.people.find((p) => p.id === id) }   // 'Crossroads-12-0'
 *
 * An id and a name can never match, so every lookup returned `undefined`, so every face fell back
 * to its own seed. The guard test could not see it: it asserted that the *source text* contained
 * `'register.find(id)'`, which is the bug spelled out and passing.
 *
 * So these tests ask the question that string could not: given a mother who is alive and on the
 * register, does her child come back carrying her?
 */

const village = (): { book: Register; day: number } => {
  const book = new Register(11, 1);
  book.settle('Ashford', 8, ['farmer', 'seller']);
  let day = 1;
  for (day = 2; day <= 60; day++) book.advance(day);
  return { book, day };
};

/** Somebody born here, rather than one of the founders, who by design have no line above them. */
const aChildOfThisVillage = (book: Register) =>
  book.living('Ashford').find((p) => p.mother !== '' && book.living('Ashford').some((m) => m.name === p.mother));

describe('who the register says somebody came from', () => {
  it('finds a living mother, who is held by name and not by id', () => {
    const { book, day } = village();
    const child = aChildOfThisVillage(book);
    expect(child, 'sixty days and nobody was born to a living mother').toBeDefined();
    const mother = book.living('Ashford').find((p) => p.name === child!.mother)!;
    expect(whoTheyCameFrom(child!, book, day)?.mother?.id).toBe(mother.id);
  });

  it('gives a founder nothing, because their parents were never on any register', () => {
    const { book, day } = village();
    const founder = book.living('Ashford').find((p) => p.mother === '' && p.father === '');
    if (founder) expect(whoTheyCameFrom(founder, book, day)).toBeUndefined();
  });

  it('says nothing rather than guessing when there is no register at all', () => {
    const { book, day } = village();
    const one = book.living('Ashford')[0];
    expect(whoTheyCameFrom(one, undefined, day)).toBeUndefined();
  });

  it('never hands somebody back their own self as a parent', () => {
    const { book, day } = village();
    for (const one of book.living('Ashford')) {
      const from = whoTheyCameFrom(one, book, day);
      expect(from?.mother?.id, one.name).not.toBe(one.id);
      expect(from?.father?.id, one.name).not.toBe(one.id);
    }
  });
});

/*
 * And the other half of the same break: a face that has one parent rather than two.
 *
 * `births.ts` writes `child.father = ''` whenever the drawn father and mother are the same person,
 * and a mother who is alive while the father is in the churchyard is the ordinary case for anybody
 * grown. `paletteFor` demanded *both* and fell back to the plain seed otherwise, so the commonest
 * family in the world inherited nothing.
 */
const face = (seed: number, parents: Partial<Pick<Face, 'mother' | 'father'>> = {}): Face =>
  ({ id: `f${seed}`, seed, trade: 'farmer', stage: 'adult', ...parents }) as Face;

describe('a face with one parent on the register', () => {
  it('takes after the mother when there is no father to be had', () => {
    const mother = face(4242);
    const alone = face(7, {});
    const withMother = face(7, { mother });
    expect(paletteFor(withMother)).not.toEqual(paletteFor(alone));
  });

  it('takes after the father when there is no mother to be had', () => {
    const father = face(4242);
    const alone = face(7, {});
    const withFather = face(7, { father });
    expect(paletteFor(withFather)).not.toEqual(paletteFor(alone));
  });

  it('is still their own face when neither parent is known', () => {
    expect(paletteFor(face(7, {}))).toEqual(paletteFor(face(7, {})));
  });
});
