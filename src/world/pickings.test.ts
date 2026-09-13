import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WRECK, cargoLeft, howManyGather, saidOfTheWater, whatIsLeft, yearsSheHasLain } from './pickings';

/**
 * The fish-folk had a roster and not a reason.
 *
 * What is pinned here is the one sentence that turned the table into a rule — they are there for
 * the cargo and have been since she went down — and the consequence that makes it worth having:
 * danger and payout are the *same fact*, so a hull that is worth robbing is a hull that is
 * dangerous to rob, and a player can read one off the other before he gets wet.
 */
describe('what the fish-folk have had out of her', () => {
  it('gives every wreck an age, and the same one every time it is asked', () => {
    for (const seed of [1, 99, 40405, 2 ** 30, 7]) {
      const years = yearsSheHasLain(seed);
      expect(years).toBeGreaterThanOrEqual(WRECK.YOUNGEST);
      expect(years).toBeLessThanOrEqual(WRECK.OLDEST);
      expect(yearsSheHasLain(seed)).toBe(years);
    }
  });

  it('gives two different wrecks different ages', () => {
    const ages = new Set([11, 12, 13, 14, 15, 16, 17, 18].map((s) => yearsSheHasLain(s * 8191)));
    expect(ages.size).toBeGreaterThan(4);
  });

  it('leaves a fresh wreck loaded and an old one stripped', () => {
    expect(whatIsLeft(WRECK.YOUNGEST)).toBe(1);
    expect(whatIsLeft(WRECK.STRIPPED)).toBe(0);
    expect(whatIsLeft(WRECK.OLDEST)).toBe(0);
  });

  it('empties her steadily rather than all at once', () => {
    // a scale the player learns to read, not two states with a cliff between them
    const seen = [5, 15, 25, 35].map(whatIsLeft);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThan(seen[i - 1]);
    expect(whatIsLeft(23)).toBeGreaterThan(0.4);
    expect(whatIsLeft(23)).toBeLessThan(0.6);
  });

  it('puts the crowd where the cargo is, which is the whole mechanic', () => {
    const rooms = 5;
    const loaded = howManyGather(whatIsLeft(WRECK.YOUNGEST), rooms);
    const picked = howManyGather(whatIsLeft(30), rooms);
    const stripped = howManyGather(whatIsLeft(WRECK.STRIPPED), rooms);
    expect(loaded).toBeGreaterThan(picked);
    expect(picked).toBeGreaterThan(stripped);
    expect(stripped, 'nobody guards an empty hold').toBe(0);
  });

  it('never sends a player across water to an empty chest unless the wreck is stripped', () => {
    expect(cargoLeft(whatIsLeft(WRECK.YOUNGEST), 4)).toBe(4);
    expect(cargoLeft(0.05, 4), 'one hide teaches him he came to the wrong ship').toBe(1);
    expect(cargoLeft(whatIsLeft(WRECK.STRIPPED), 4)).toBe(0);
  });

  it('says what the water looks like, differently at each end of the scale', () => {
    const said = [0, 0.2, 0.5, 1].map(saidOfTheWater);
    expect(new Set(said).size, 'a line that never changes tells the player nothing').toBe(4);
    expect(said[3]).toMatch(/thick/i);
  });

  it('agrees with itself: the crowded wreck is the one worth robbing', () => {
    // the assertion this whole item exists for. Danger and payout are one fact, so a player who
    // counts shapes in the water knows what the strongbox is worth before he is wet
    for (const years of [3, 10, 20, 30, 40, 50]) {
      const left = whatIsLeft(years);
      const crowd = howManyGather(left, 5);
      const cargo = cargoLeft(left, 4);
      expect(crowd === 0 ? cargo === 0 : cargo > 0).toBe(true);
    }
  });
});

/**
 * And the part a green suite cannot see.
 *
 * Everything above passed the moment it was written, because it is arithmetic and arithmetic has no
 * wiring. The fault this item was filed for is not that the rule was wrong — it is that the
 * fish-folk had no reason, and a rule nothing calls is not a reason. Seven features in this
 * codebase have now been found written, tested and reachable by nothing, so the seam is what gets
 * guarded.
 */
describe('and something that actually asks', () => {
  const body = (file: string): string => readFileSync(file, 'utf8');

  it('has a hold that gathers them where the cargo is', () => {
    expect(body('src/dungeon/generate.ts'), 'a roster that is not consulted is still a spawn table')
      .toContain('howManyGather(');
  });

  it('has a chest that knows how much has been carried out of it', () => {
    expect(body('src/world/chests.ts')).toContain('cargoLeft(');
  });

  it('tells the player, because reading the water is the whole mechanic', () => {
    expect(body('src/game/interact/wild.ts'), 'a signal nobody is shown is not a signal')
      .toContain('saidOfTheWater(');
  });
});
