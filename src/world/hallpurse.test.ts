import { describe, expect, it } from 'vitest';
import { THE_HALL_OWNER, THE_HALL, ownerFromSave } from './holdings';
import { pay, payAndSweep } from './purses';
import type { Settlement } from './settlement';

/**
 * The hall is paid the way anybody is paid.
 *
 * Item 89. A village's treasury is `Settlement.purse` — a bare number that belongs to nobody — and
 * `THE_HALL` is a string that can own a farm, fund a posting and take a share of a take. So every
 * place that moves money has to remember which of the two it is dealing with, and the ones that
 * forget do not fail: `pay` walks `village.people`, finds nothing called "the hall", and drops the
 * entry on the floor. Money that leaves a book and arrives nowhere is the one thing the deed layer
 * exists to make impossible, and this is the seam it cannot see across.
 *
 * The end of this item is a hall that is an entity with a purse, whose body happens to be a
 * building — the mayor's house at first and a voted one later (**91**). This is the first step of
 * it and the one everything else waits on: one `pay`, and it does not care which of them you name.
 */
function village(purses: number[], hall = 0): Settlement {
  return {
    people: purses.map((purse, n) => ({ id: `p${n}`, purse })),
    purse: hall,
  } as unknown as Settlement;
}

describe('paying the village itself', () => {
  it('puts money in the hall when the hall is who is owed', () => {
    const here = village([10, 10], 100);
    payAndSweep(here, new Map([[THE_HALL_OWNER, 25]]));
    expect(here.purse).toBe(125);
  });

  it('takes money out of the hall when the hall is who is paying', () => {
    const here = village([10], 100);
    payAndSweep(here, new Map([[THE_HALL_OWNER, -40]]));
    expect(here.purse).toBe(60);
  });

  /*
   * The failure this is really about. A coin that leaves one book has to arrive in another, and an
   * entry nobody recognises is a coin that left and arrived nowhere — silently, with every test
   * still green, which is how it would have gone unnoticed.
   */
  it('never drops an entry it does not recognise', () => {
    const here = village([10, 10], 100);
    const before = here.people.reduce((sum, p) => sum + p.purse, 0) + here.purse;
    payAndSweep(here, new Map([[ownerFromSave('p0'), 5], [THE_HALL_OWNER, 7]]));
    const after = here.people.reduce((sum, p) => sum + p.purse, 0) + here.purse;
    expect(after - before, 'every coin named should have landed somewhere').toBe(12);
  });

  it('says what it could not place, rather than swallowing it', () => {
    const here = village([10]);
    const { unplaced } = pay(here, new Map([[ownerFromSave('nobody-of-that-name'), 9]]));
    expect(unplaced).toBe(9);
  });
});
