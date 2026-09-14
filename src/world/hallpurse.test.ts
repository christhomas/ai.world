import { describe, expect, it } from 'vitest';
import { THE_HALL_OWNER, THE_HALL, ownerFromSave } from './holdings';
import { pay, payAndSweep } from './purses';
import type { Settlement } from './settlement';

/**
 * The hall is paid the way anybody is paid.
 *
 * Item 89. The treasury used to be a bare number on `Settlement`, while `THE_HALL` was a
 * separate string that could own holdings. That split let payment entries name the hall without
 * finding any purse, silently destroying the transfer. The hall is now the owner entity itself:
 * it has the same durable identity in deeds and payroll, its own uncapped purse, and a body that
 * begins at the mayor's house. It never enters the roll of living people and cannot be inherited.
 */
function village(purses: number[], hall = 0): Settlement {
  return {
    people: purses.map((purse, n) => ({ id: `p${n}`, purse })),
    hall: { id: THE_HALL_OWNER, body: 'mayor-house', purse: hall },
  } as unknown as Settlement;
}

describe('paying the village itself', () => {
  it('puts money in the hall when the hall is who is owed', () => {
    const here = village([10, 10], 100);
    payAndSweep(here, new Map([[THE_HALL_OWNER, 25]]));
    expect(here.hall.purse).toBe(125);
  });

  it('takes money out of the hall when the hall is who is paying', () => {
    const here = village([10], 100);
    payAndSweep(here, new Map([[THE_HALL_OWNER, -40]]));
    expect(here.hall.purse).toBe(60);
  });

  /*
   * The failure this is really about. A coin that leaves one book has to arrive in another, and an
   * entry nobody recognises is a coin that left and arrived nowhere — silently, with every test
   * still green, which is how it would have gone unnoticed.
   */
  it('never drops an entry it does not recognise', () => {
    const here = village([10, 10], 100);
    const before = here.people.reduce((sum, p) => sum + p.purse, 0) + here.hall.purse;
    payAndSweep(here, new Map([[ownerFromSave('p0'), 5], [THE_HALL_OWNER, 7]]));
    const after = here.people.reduce((sum, p) => sum + p.purse, 0) + here.hall.purse;
    expect(after - before, 'every coin named should have landed somewhere').toBe(12);
  });

  it('says what it could not place, rather than swallowing it', () => {
    const here = village([10]);
    const { unplaced } = pay(here, new Map([[ownerFromSave('nobody-of-that-name'), 9]]));
    expect(unplaced).toBe(9);
  });
});
