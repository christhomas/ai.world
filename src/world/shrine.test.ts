import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { LIFE, ageOf } from './people';
import { Register } from './register';
import { SHRINE_FEE, whoTheShrineSent } from './shrine';
import { GROWTH } from './growth';

/**
 * The shrine that raises a villager.
 *
 * Everything else that puts a person into this world needs a village with people already in it:
 * children are born to parents, and somebody walks over the hill from the next place along. Walk
 * into a valley where everybody starved and there was nothing whatever to be done about it — and in
 * an endless country that is a question the map will keep asking.
 */

describe('who the shrine sends', () => {
  const stream = () => mulberry32(99);

  it('is the same person on every machine that knows the magic was paid for', () => {
    expect(whoTheShrineSent('Thornby', 40, stream(), [])).toEqual(whoTheShrineSent('Thornby', 40, stream(), []));
  });

  it('is somebody else on another day, and in another valley', () => {
    const here = whoTheShrineSent('Thornby', 40, stream(), []);
    expect(whoTheShrineSent('Thornby', 41, stream(), []).id).not.toBe(here.id);
    expect(whoTheShrineSent('Oakcross', 40, stream(), []).id).not.toBe(here.id);
  });

  it('arrives grown, because a valley with nobody in it cannot raise a child', () => {
    const soul = whoTheShrineSent('Thornby', 40, stream(), []);
    expect(ageOf(soul, 40)).toBeGreaterThanOrEqual(LIFE.CHILD_UNTIL);
    expect(soul.lives).toBeGreaterThanOrEqual(LIFE.SHORTEST_LIFE);
  });

  it('is the first of their family anywhere, which is what makes them new blood', () => {
    const soul = whoTheShrineSent('Thornby', 40, stream(), []);
    expect(soul.mother).toBe('');
    expect(soul.father).toBe('');
  });

  it('carries nothing: what the shrine makes is a person, not an estate', () => {
    expect(whoTheShrineSent('Thornby', 40, stream(), []).purse).toBe(0);
  });

  it('costs what a village pays to raise a roof, rather than a number somebody picked', () => {
    expect(SHRINE_FEE).toBe(GROWTH.A_HOUSE);
  });
});

describe('a valley that has been given somebody back', () => {
  const emptyOne = (): Register => {
    const register = new Register(31);
    register.settle('Thornby', 9, ['farmer', 'hunter', 'seller']);
    for (const person of [...register.living('Thornby')]) register.bury(person.id, 3);
    expect(register.living('Thornby')).toHaveLength(0);
    return register;
  };

  it('has somebody in it again', () => {
    const register = emptyOne();
    const raised = register.raiseAtShrine('Thornby', 4);
    expect(raised).toHaveLength(1);
    expect(register.living('Thornby')).toHaveLength(1);
    expect(register.emptiedOn('Thornby'), 'it is still recorded as a ruin').toBeNull();
  });

  it('keeps them when the village is lived again from its founding', () => {
    /*
     * The property the whole design turns on. A village is re-founded and lived forward whenever
     * anybody learns something new about its past, so anything that cannot be worked out from the
     * seed vanishes unless it is written down. A raising is exactly that kind of fact.
     */
    const register = emptyOne();
    const raised = register.raiseAtShrine('Thornby', 4);
    register.advance(30);
    // a death arriving late is what re-lives a village, and this one is about somebody else
    register.apply({ kind: 'died', id: 'nobody-at-all', name: '', village: 'Thornby', day: 5 });
    expect(register.find(raised[0].id), 'the magic was forgotten the moment the village was re-lived')
      .toBeDefined();
  });

  it('will not sell the same morning twice', () => {
    const register = emptyOne();
    expect(register.raiseAtShrine('Thornby', 4)).toHaveLength(1);
    expect(register.raiseAtShrine('Thornby', 4), 'one soul a day out of one shrine').toHaveLength(0);
  });

  it('does nothing at all for a village nobody has settled', () => {
    const register = new Register(31);
    expect(register.raiseAtShrine('Nowhere', 4)).toEqual([]);
  });

  it('cannot bring a valley back on one soul, which is what keeps the magic honest', () => {
    // one person has nobody to have children with and eventually dies of the years, so the fee is
    // per soul and reviving a place is several houses' worth of gold rather than one
    const register = emptyOne();
    register.raiseAtShrine('Thornby', 4);
    register.advance(240);
    expect(register.living('Thornby')).toHaveLength(0);
  });

  it('brings one back on five, and then the village does the rest itself', () => {
    /*
     * What the whole item is for. Five mornings at a shrine — a small fortune, and a decision a
     * player has to mean — and the valley is a village again: twenty-four people two hundred days
     * later, growing into the houses that were already standing there empty.
     */
    const register = emptyOne();
    for (let day = 4; day <= 8; day++) register.raiseAtShrine('Thornby', day);
    expect(register.living('Thornby')).toHaveLength(5);
    register.advance(240);
    expect(register.living('Thornby').length).toBeGreaterThan(15);
  });
});
