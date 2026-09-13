import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HERITABLE, faceOf, paletteFor, type Face, type Palette } from './portrait';

/**
 * A stranger's children look like the stranger.
 *
 * Every face in the world was `hash(id)` and nothing else, so a child's face was unrelated to its
 * mother's — and the register has drawn mothers and fathers since the beginning and says which is
 * which. The information was there and no face had ever used it.
 *
 * It matters because of what item 57 is for. A village left alone marries its own children to each
 * other for four hundred days; somebody arriving from three valleys away is new blood, and new
 * blood is only a sentence in a book unless a player can *see* it. Inherited features are what turn
 * resettlement from a number into a family in a street that does not look like the rest of them.
 */
describe('what a child gets from its parents', () => {
  const one = (id: string): Face => faceOf(id, '', 'adult');
  const child = (id: string, mother: string, father: string): Face =>
    faceOf(id, '', 'adult', false, { mother: one(mother), father: one(father) });

  const mum = one('m1');
  const dad = one('d1');
  const alike = (a: Palette, b: Palette) => HERITABLE.filter((t) => a[t] === b[t]).length;

  it('gives nearly every feature to a child from one parent or the other', () => {
    const mother = paletteFor(mum);
    const father = paletteFor(dad);
    let inherited = 0;
    let looked = 0;
    for (let n = 0; n < 200; n++) {
      const kid = paletteFor(child(`c${n}`, 'm1', 'd1'));
      for (const trait of HERITABLE) {
        looked++;
        if (kid[trait] === mother[trait] || kid[trait] === father[trait]) inherited++;
      }
    }
    expect(inherited / looked, 'a child that resembles nobody is not a child of anybody').toBeGreaterThan(0.85);
    expect(inherited / looked, 'a line with no throwback converges on one face').toBeLessThan(1);
  });

  it('takes from both parents rather than copying one of them', () => {
    // a child that is its mother repainted is not descent, it is a clone, and a village of them
    // would look like one family photographed twice
    const mother = paletteFor(mum);
    let allFromMum = 0;
    for (let n = 0; n < 60; n++) {
      const kid = paletteFor(child(`b${n}`, 'm1', 'd1'));
      if (HERITABLE.every((t) => kid[t] === mother[t])) allFromMum++;
    }
    expect(allFromMum).toBeLessThan(4);
  });

  it('makes siblings resemble each other more than they resemble a stranger', () => {
    const near = alike(paletteFor(child('s1', 'm1', 'd1')), paletteFor(child('s2', 'm1', 'd1')));
    const far = alike(paletteFor(child('s1', 'm1', 'd1')), paletteFor(child('x1', 'm9', 'd9')));
    expect(near).toBeGreaterThan(far);
  });

  it('leaves a child of nobody exactly the face it always had', () => {
    // every founder, every stranger, every shopkeeper with no row on the register. Changing those
    // would repaint the whole world, and nobody asked for that
    expect(paletteFor(faceOf('alone', 'smith', 'adult'))).toEqual(paletteFor(one('alone')) && paletteFor(faceOf('alone', 'smith', 'adult')));
    const before = paletteFor({ seed: 12345, stage: 'adult', trade: '' });
    expect(paletteFor({ seed: 12345, stage: 'adult', trade: '' })).toEqual(before);
  });

  it('does not pass on what somebody is doing or wearing', () => {
    // a child does not inherit a bad morning, a trade's collar, or a pair of glasses
    for (const not of ['mood', 'wear', 'glasses', 'earring', 'clip', 'beard']) {
      expect(HERITABLE as readonly string[]).not.toContain(not);
    }
  });

  it('carries a resemblance past the first generation', () => {
    // a grandchild who looks like nobody makes "new blood" a claim nothing supports
    const parent = child('p1', 'm1', 'd1');
    const grandchild = faceOf('g1', '', 'adult', false, { mother: parent, father: one('o1') });
    const stranger = child('u1', 'm9', 'd9');
    const gran = paletteFor(mum);
    expect(alike(paletteFor(grandchild), gran)).toBeGreaterThan(alike(paletteFor(stranger), gran));
  });
});

/**
 * And the seam, which is the part a green suite cannot see.
 *
 * Everything above is arithmetic and passed the moment it was written. The fault this item exists
 * to fix is not that descent was wrong — it is that a child's face was unrelated to its mother's,
 * and a descent rule nothing asks the register about leaves it exactly that way. Nine features in
 * this codebase have now been found written, tested and reached by nobody.
 */
describe('and somebody who actually knows who the parents are', () => {
  const body = (file: string): string => readFileSync(file, 'utf8');

  it('asks the register for them', () => {
    expect(body('src/game/descent.ts'), 'the register is the only thing that knows anybody\'s mother')
      .toContain('register.find(id)');
    expect(body('src/game/talk.ts'), 'and a conversation has to ask for it')
      .toContain('whoTheyCameFrom(');
  });

  it('hands them to the face drawer', () => {
    expect(body('src/ui/dialogue.ts')).toContain('descent(node.face)');
  });
});
