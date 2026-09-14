import { describe, expect, it } from 'vitest';
import { SQUARE } from './civic';
import { WORKS, nextWork } from './hall';
import { housesStanding } from './growth';
import { RANKS, atLeast, promotionFor, rankOfRoofs } from './rank';
import { Register } from './register';

/**
 * Roofs permit a title; a vote declares the higher ones.
 *
 * The count stays in this small module because both growth and the ballot need the same thresholds.
 * A hamlet becomes a village by growth alone, while town and city remain facts the register was told.
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
    expect(rankOfRoofs(housesStanding(SQUARE.CIVIC_HOUSES, []))).toBe('village');
    expect(rankOfRoofs(housesStanding(SQUARE.CIVIC_HOUSES, built))).toBe('town');
  });


  it('compares ranks by their place on the ladder, not by their names', () => {
    expect(atLeast('town', 'village')).toBe(true);
    expect(atLeast('village', 'town')).toBe(false);
    expect(atLeast('city', 'city')).toBe(true);
  });

  it('makes the later city declaration dearer than the town vote', () => {
    expect(promotionFor('village', SQUARE.CIVIC_HOUSES * 2)).toMatchObject({ rank: 'town', costs: 5000 });
    expect(promotionFor('town', SQUARE.CIVIC_HOUSES * 4)).toMatchObject({ rank: 'city', costs: 15000 });
  });

  it('still recognises a hamlet as a village when its eighth roof is finished', () => {
    const register = new Register(17, 30);
    register.settle('Testing', 7, ['farmer', 'seller', 'hunter', 'soldier']);
    expect(register.rankOf('Testing')).toBe('hamlet');

    register.advance(900);
    expect(rankOfRoofs(housesStanding(7, register.worksOf('Testing')))).not.toBe('hamlet');
    expect(register.rankOf('Testing')).toBe('village');
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

describe('a village that has grown large enough to declare itself', () => {
  it('stays a village until the player joins its vote', () => {
    const register = new Register(17, 30);
    register.settle('Testing', 9, ['farmer', 'seller', 'hunter', 'soldier']);
    register.advance(900);
    expect(rankOfRoofs(housesStanding(9, register.worksOf('Testing')))).toBe('town');
    expect(register.rankOf('Testing')).toBe('village');

    const ballot = register.ballotOf('Testing');
    expect(ballot).toMatchObject({ rank: 'town', costs: 5000, ready: true });
    const vote = register.vote('Testing', 900);
    expect(vote).toEqual({ kind: 'voted', village: 'Testing', rank: 'town', day: 900 });
    expect(register.rankOf('Testing')).toBe('town');
    expect(register.worksOf('Testing')).toContain('townhall@900');
  });
});
