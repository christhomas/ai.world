import { describe, expect, it } from 'vitest';
import { PROWESS, costOf, learnedFrom, levelFor, saidOf, towardsNext } from './prowess';

/**
 * Kit improved and the hero never did, so a fight in the second week was the first week's fight
 * with a better sword in it. These pin the shape of the answer: practice is earned by doing the
 * dangerous thing, it is worth little against a weapon, and it runs out.
 */
describe('getting better at fighting', () => {
  it('starts nobody as anything', () => {
    expect(levelFor(0)).toBe(0);
    expect(saidOf(0)).toBe('');
  });

  it('pays more for hitting something that could kill you', () => {
    expect(learnedFrom(4, false)).toBeGreaterThan(learnedFrom(0, false));
  });

  it('pays most for finishing it, so hitting a chicken all day is not the way', () => {
    expect(learnedFrom(0, true)).toBeGreaterThan(learnedFrom(3, false));
  });

  it('costs more for every level than the one before', () => {
    for (let n = 1; n < PROWESS.MOST; n++) {
      expect(costOf(n + 1) - costOf(n), `level ${n + 1}`).toBeGreaterThan(costOf(n) - costOf(n - 1));
    }
  });

  it('takes a real run of fights to gain the first one', () => {
    // a dozen easy kills should not do it; this is not a bar that fills while you look at it
    expect(levelFor(learnedFrom(0, true) * 6)).toBe(0);
  });

  it('runs out rather than growing for ever', () => {
    expect(levelFor(costOf(PROWESS.MOST) * 100)).toBe(PROWESS.MOST);
    expect(towardsNext(costOf(PROWESS.MOST) * 100)).toBe(1);
  });

  it('reports progress through a level between nought and one', () => {
    for (const p of [0, 50, 200, 1000, 9000]) {
      expect(towardsNext(p)).toBeGreaterThanOrEqual(0);
      expect(towardsNext(p)).toBeLessThanOrEqual(1);
    }
  });

  it('has something to say at every level it can reach', () => {
    for (let n = 1; n <= PROWESS.MOST; n++) expect(saidOf(n).length).toBeGreaterThan(0);
  });
});
