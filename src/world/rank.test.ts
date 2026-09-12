import { describe, expect, it } from 'vitest';
import { SQUARE } from './civic';
import { WORKS, nextWork } from './hall';
import { rankOfVillage } from './growth';
import { RANKS, atLeast, rankOfRoofs, untilTheNextRank } from './rank';
import { Register } from './register';

/**
 * What a place is, counted rather than declared.
 *
 * This falls out of the growth loop for nothing, which is the argument for having it: if the roofs
 * a place has are what cap its population, the roofs are also what the place *is*. Nothing anywhere
 * says "this seed puts a city here" — a valley grows into a town because its people built the
 * houses, and the player sees it without being told.
 */

describe('what a place is called', () => {
  it('counts nothing itself, which is how it stays out of a cycle', () => {
    /*
     * Worth a test because the cycle was real and expensive. `growth.ts` counts a village's roofs
     * and asks this file what the count means; when this file asked back, a constant was undefined
     * at module-init time, a roof's price came out `NaN`, and `purse < NaN` being false meant every
     * village raised a longhouse it could not pay for and sent its treasury to `NaN`.
     */
    expect(rankOfRoofs(24)).toBe('town');
  });

  it('is a hamlet until it is big enough for a hall', () => {
    expect(rankOfRoofs(0)).toBe('hamlet');
    expect(rankOfRoofs(SQUARE.CIVIC_HOUSES - 1)).toBe('hamlet');
    expect(rankOfRoofs(SQUARE.CIVIC_HOUSES)).toBe('village');
  });

  it('hangs every rank off the number that already earns a hall', () => {
    // rather than off a second set of numbers for the same question, which is how two parts of a
    // world start disagreeing about what a place is
    expect(RANKS.map((step) => step.roofs))
      .toEqual([0, SQUARE.CIVIC_HOUSES, SQUARE.CIVIC_HOUSES * 2, SQUARE.CIVIC_HOUSES * 4]);
  });

  it('counts what was laid out and what has been raised since, together', () => {
    const built = Array.from({ length: SQUARE.CIVIC_HOUSES }, () => 'house:house');
    expect(rankOfVillage(SQUARE.CIVIC_HOUSES, [])).toBe('village');
    expect(rankOfVillage(SQUARE.CIVIC_HOUSES, built)).toBe('town');
  });

  it('says how many more roofs before it is called something else', () => {
    expect(untilTheNextRank(SQUARE.CIVIC_HOUSES)).toBe(SQUARE.CIVIC_HOUSES);
    expect(untilTheNextRank(SQUARE.CIVIC_HOUSES * 4), 'a city has nowhere further to go').toBeNull();
  });

  it('compares ranks by their place on the ladder, not by their names', () => {
    expect(atLeast('town', 'village')).toBe(true);
    expect(atLeast('village', 'town')).toBe(false);
    expect(atLeast('city', 'city')).toBe(true);
  });
});

describe('what a rank is allowed to do', () => {
  const rich = 1e9;

  it('unlocks a building a smaller place cannot have, however rich it is', () => {
    // never a multiplier: a town that simply earned more per head than a village would be a noun
    // doing arithmetic, and the economy would stop being something you can reason about
    const everything = WORKS.filter((work) => !work.needs).map((work) => work.id);
    expect(nextWork(rich, everything, 'village'), 'a village bought a town\'s building').toBeNull();
    expect(nextWork(rich, everything, 'town')?.id).toBe('markethall');
  });

  it('skips what a place is too small for rather than saving for it', () => {
    // a village saving for a market hall it cannot have would never buy its bath house, and would
    // sit on the money until it had grown — which is the one exception to buying cheapest-first
    const started = ['well', 'storey', 'watchtower'];
    expect(nextWork(rich, started, 'village')?.id).toBe('bathhouse');
  });

  it('keeps the city’s building out of reach of a town, which is the point of a ladder', () => {
    const townsWorth = WORKS.filter((work) => work.needs !== 'city').map((work) => work.id);
    expect(nextWork(rich, townsWorth, 'town')).toBeNull();
    expect(nextWork(rich, townsWorth, 'city')?.id).toBe('aqueduct');
  });
});

describe('a village that has been growing for a year', () => {
  it('is called something bigger than it was founded as', () => {
    const register = new Register(17, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter', 'soldier']);
    const wasFounded = register.rankOf('Testing');
    register.advance(900);
    expect(register.rankOf('Testing'), `it was a ${wasFounded} and stayed one`).not.toBe(wasFounded);
  });
});
