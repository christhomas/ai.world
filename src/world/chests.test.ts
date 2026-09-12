import { describe, it, expect } from 'vitest';
import { SALVAGE, whatAChestHolds, BIG_CHEST_PRIZES } from './chests';

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

  it('only a big chest holds anything worth carrying, in a hole in the ground', () => {
    // in a hole. A crate in a wreck's hold is the one small chest with something in it, and the
    // block below is where that is held to
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

/**
 * And what came up out of a wreck, which is the reason to go down into one.
 *
 * The hold was a fight and a few chests, and the chests were a cave's chests: coin in the small
 * ones, gear in the big one at the far end. Since the way to them is a roster that does not thin
 * out with depth and a crossing over water nobody can swim, that made a dive a worse cave — and a
 * worse cave is a place you visit once to see whether it was worth it and never again.
 *
 * A wreck is where a cargo went down, so what is in the crates is the cargo. That is the whole
 * idea, and everything below is the arithmetic of it: a crate holds goods as well as coin, the
 * strongbox on the island is worth what a merchant would insure, and none of it depends on
 * anything the page says about itself.
 */
describe('what came up out of a wreck', () => {
  it('fills a crate with cargo, where the same crate in a cave holds only coin', () => {
    for (let index = 0; index < 20; index++) {
      const crate = whatAChestHolds(31, index, { big: false, salvage: true }, nothing);
      const cave = whatAChestHolds(31, index, { big: false }, nothing);
      expect(SALVAGE, `crate ${index} came up with "${crate.prize}"`).toContain(crate.prize);
      expect(cave.prize, 'a cave learned to hold cargo').toBe(null);
    }
  });

  it('pays a crate better than a cave pays a purse, without paying like a strongbox', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const crate = whatAChestHolds(seed, 0, { big: false, salvage: true }, nothing);
      const purse = whatAChestHolds(seed, 0, { big: false }, nothing);
      const strongbox = whatAChestHolds(seed, 0, { big: true }, nothing);
      expect(crate.gold).toBeGreaterThan(purse.gold);
      expect(crate.gold).toBeLessThan(strongbox.gold);
    }
  });

  it('makes the strongbox on the island worth the crossing', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const hold = whatAChestHolds(seed, 0, { big: true, salvage: true }, nothing);
      const vault = whatAChestHolds(seed, 0, { big: true }, nothing);
      expect(hold.gold).toBeGreaterThan(vault.gold);
      // and it is still a strongbox: coin and something to wear, not a bale of furs
      expect(BIG_CHEST_PRIZES).toContain(hold.prize);
    }
  });

  it('hands over the same cargo whatever the hero says he is carrying', () => {
    /*
     * The useful half of the rule rather than a convenience. What is in a chest is worked out on
     * two machines from one seed, and the one thing the world takes on trust is the page's word
     * about its own pack — so a chest whose contents do not depend on that word is a chest the two
     * halves cannot be argued into disagreeing about.
     */
    const everything = new Set([...SALVAGE, ...BIG_CHEST_PRIZES]);
    for (let index = 0; index < 20; index++) {
      const empty = whatAChestHolds(404, index, { big: false, salvage: true }, nothing);
      const laden = whatAChestHolds(404, index, { big: false, salvage: true }, (item) => everything.has(item));
      expect(laden).toEqual(empty);
    }
  });

  it('is a cargo rather than one thing found over and over', () => {
    // a hold that gave the same bale out of every crate would be a hold with one chest in it
    const found = new Set<string | null>();
    for (let index = 0; index < 60; index++) {
      found.add(whatAChestHolds(88, index, { big: false, salvage: true }, nothing).prize);
    }
    expect(found.size, 'every crate in the hold held the same thing').toBeGreaterThan(3);
  });
});
