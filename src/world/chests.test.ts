import { describe, it, expect } from 'vitest';
import { whatAChestHolds, BIG_CHEST_PRIZES } from './chests';

const nothing = () => false;

describe('what a chest holds', () => {
  it('is the same on every machine that asks', () => {
    const one = whatAChestHolds(12345, 3, { big: true, key: false }, nothing);
    const two = whatAChestHolds(12345, 3, { big: true, key: false }, nothing);
    expect(two).toEqual(one);
  });

  it('is a different chest on a different floor', () => {
    // the seed handed in is the anchor's, and an anchor's seed carries the floor. Two floors rolling
    // the same gold for the same index is the bug this rule was pulled out of a page to stop
    const first = whatAChestHolds(1000, 0, { big: true, key: false }, nothing);
    const second = whatAChestHolds(2000, 0, { big: true, key: false }, nothing);
    expect(second).not.toEqual(first);
  });

  it('pays a big chest better than a small one', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const small = whatAChestHolds(seed, 0, { big: false, key: false }, nothing);
      const big = whatAChestHolds(seed, 0, { big: true, key: false }, nothing);
      expect(small.gold).toBeGreaterThanOrEqual(12);
      expect(small.gold).toBeLessThan(42);
      expect(big.gold).toBeGreaterThanOrEqual(80);
      expect(big.gold).toBeLessThan(150);
    }
  });

  it('only a big chest holds anything worth carrying', () => {
    expect(whatAChestHolds(7, 1, { big: false, key: false }, nothing).prize).toBe(null);
    expect(whatAChestHolds(7, 1, { big: true, key: false }, nothing).prize).not.toBe(null);
  });

  it('does not hand over a second of something already carried', () => {
    // everything but the two worth having twice, so the only prizes left are those two
    const carrying = new Set(BIG_CHEST_PRIZES.filter((item) => item !== 'potion' && item !== 'gem'));
    for (let index = 0; index < 40; index++) {
      const found = whatAChestHolds(99, index, { big: true, key: false }, (item) => carrying.has(item));
      expect(['potion', 'gem']).toContain(found.prize);
    }
  });

  it('says whether the treasure room key was in it, and never invents one', () => {
    expect(whatAChestHolds(5, 0, { big: false, key: true }, nothing).key).toBe(true);
    expect(whatAChestHolds(5, 0, { big: false }, nothing).key).toBe(false);
  });
});
