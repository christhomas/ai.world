import { describe, expect, it } from 'vitest';
import { PROSPER } from './prosperity';
import type { Settlement } from './settlement';
import { pay, payAndSweep } from './purses';

/** A village with nothing in it but purses, which is all this rule reads. */
function village(purses: number[], hall = 0): Settlement {
  return {
    people: purses.map((purse, n) => ({ id: `p${n}`, purse })),
    purse: hall,
  } as unknown as Settlement;
}

function owed(...much: number[]): Map<string, number> {
  return new Map(much.map((m, n) => [`p${n}`, m]));
}

describe('paying a village', () => {
  it('moves money into and out of purses by id', () => {
    const here = village([10, 10]);
    payAndSweep(here, owed(5, -3));
    expect(here.people.map((p) => p.purse)).toEqual([15, 7]);
  });

  /*
   * The bug this module was cut out for.
   *
   * A purse clamped at the ceiling used to lose whatever went over the top, and nothing anywhere
   * recorded it. The audit reads it as the world being poorer than its transactions say, which is
   * the one direction the deed layer's single rule can be broken in.
   */
  it('does not destroy what a full purse cannot hold', () => {
    const here = village([PROSPER.MOST - 10]);
    const { over } = pay(here, owed(60));
    expect(here.people[0].purse).toBe(PROSPER.MOST);
    expect(over).toBe(50);
  });

  it('sweeps it into the hall, so the village is worth what it was worth plus what it earned', () => {
    const here = village([PROSPER.MOST - 10], 100);
    const before = here.people[0].purse + here.purse;
    payAndSweep(here, owed(60));
    expect(here.people[0].purse + here.purse).toBe(before + 60);
    expect(here.purse).toBe(150);
  });

  it('leaves the hall alone when nobody is anywhere near the ceiling', () => {
    const here = village([10], 100);
    payAndSweep(here, owed(5));
    expect(here.purse).toBe(100);
  });

  /*
   * The other end, and it is deliberately not symmetrical. A man who owes more than he has has
   * simply not paid it: that is a hole in the day's books, not a coin the hall can find, and
   * making it good would be inventing money rather than losing it.
   */
  it('reports what a purse could not pay rather than letting it go negative', () => {
    const here = village([4]);
    const { short } = pay(here, owed(-10));
    expect(here.people[0].purse).toBe(0);
    expect(short).toBe(6);
  });

  it('adds up both ends over a whole village at once', () => {
    const here = village([PROSPER.MOST - 5, 2, 50]);
    const { over, short } = pay(here, owed(25, -9, 10));
    expect(over).toBe(20);
    expect(short).toBe(7);
    expect(here.people.map((p) => p.purse)).toEqual([PROSPER.MOST, 0, 60]);
  });

  it('says nothing about the people it was not asked about', () => {
    const here = village([10, 10]);
    payAndSweep(here, new Map([['p1', 5]]));
    expect(here.people.map((p) => p.purse)).toEqual([10, 15]);
  });
});
