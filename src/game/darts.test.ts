import { describe, expect, it } from 'vitest';
import { DARTS, playLeg, saidOfLeg } from './darts';

/** How often a hero of this practice wins, over enough legs to mean something. */
const winRate = (skill: number, legs = 4000): number => {
  let won = 0;
  for (let n = 0; n < legs; n++) if (playLeg(n * 2654435761, skill).won) won++;
  return won / legs;
};

/**
 * A village had a shop, an inn and somebody with an errand. A game gives the pub a reason to be
 * walked into that is not a transaction, and moves money in the direction the player has never
 * been on the losing side of.
 */
describe('a leg of darts', () => {
  it('throws three darts, each a real score', () => {
    const leg = playLeg(1, 0);
    expect(leg.throws).toHaveLength(DARTS.THROWS);
    for (const t of leg.throws) {
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(20);
    }
    expect(leg.total).toBe(leg.throws.reduce((a, b) => a + b, 0));
  });

  it('plays the same leg for the same throw of the dice', () => {
    expect(playLeg(42, 2)).toEqual(playLeg(42, 2));
  });

  it('is a losing bet for a beginner, or the house would not offer it', () => {
    expect(winRate(0)).toBeLessThan(0.5);
  });

  it('rewards a hero who has been practising', () => {
    expect(winRate(5)).toBeGreaterThan(winRate(0));
  });

  it('is never a certainty, however good you get', () => {
    const best = winRate(5);
    expect(best).toBeLessThan(0.95);
    expect(best).toBeGreaterThan(0.2);
  });

  it('pays more than the stake, or winning would not be worth the walk', () => {
    expect(DARTS.WINNINGS).toBeGreaterThan(DARTS.STAKE);
  });

  it('says what was thrown and who took it', () => {
    const leg = playLeg(7, 1);
    expect(saidOfLeg(leg)).toContain(String(leg.total));
    expect(saidOfLeg(leg)).toContain(String(leg.houseTotal));
  });
});
