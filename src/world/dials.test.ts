import { describe, expect, it } from 'vitest';
import { LIFE } from './people';
import { ROOFS, STANDARD, roofLadder } from './roofs';

/**
 * The numbers a person would want to turn, made turnable.
 *
 * Item #257 wants a page with a population dial on it — move how many children a household has, or
 * how long people live, and watch twenty-four villages live or die. The loop today is *a code edit,
 * a hundred-day run, and a diff of two text files*, which is slow enough that the questions nobody
 * asks are the ones worth asking.
 *
 * Two things stand in the way, and neither is the page.
 *
 * **The roof ladder is frozen at import.** `ROOFS` is built from `LIFE.CHILDREN` when the module
 * loads, and `STANDARD` is `ROOFS[1]`. A slider that moved `LIFE.CHILDREN` would move nothing at
 * all — the houses would go on holding what they held when the tab opened. So the ladder becomes a
 * function of the number, and the constant becomes the default rather than the source.
 *
 * **`RUNS` lives three hundred days at import.** `economy.bench.ts` ends with
 * `export const RUNS = SEEDS.map((seed) => liveForward(seed))`, so *importing* the bench costs three
 * hundred-day simulations before a single line of the importing file runs. That is fine for a test
 * file that wants them and unusable from a page that wants to choose its own dials first.
 *
 * Both are the same fault in different clothes: a decision taken at module-evaluation time cannot
 * be taken again.
 */

describe('the roof ladder as a question rather than a constant', () => {
  it('still says exactly what it always said, asked with the game\'s own number', () => {
    expect(roofLadder(LIFE.CHILDREN)).toEqual(ROOFS);
  });

  it('gives a bigger household a bigger house at every rung', () => {
    const roomier = roofLadder(LIFE.CHILDREN + 2);
    for (let rung = 1; rung < ROOFS.length; rung++) {
      expect(roomier[rung].holds, ROOFS[rung].id).toBeGreaterThan(ROOFS[rung].holds);
    }
  });

  it('leaves the cottage alone, because a cottage is a couple and no children at all', () => {
    expect(roofLadder(LIFE.CHILDREN + 5)[0].holds).toBe(ROOFS[0].holds);
  });

  it('keeps the same rungs in the same order, whatever it is asked', () => {
    for (const children of [1, 2, 3, 6, 12]) {
      const ladder = roofLadder(children);
      expect(ladder.map((r) => r.id)).toEqual(ROOFS.map((r) => r.id));
      for (let rung = 1; rung < ladder.length; rung++) {
        expect(ladder[rung].holds).toBeGreaterThan(ladder[rung - 1].holds);
      }
    }
  });

  it('has the standard roof stay the middle of whatever ladder it came from', () => {
    expect(STANDARD).toEqual(ROOFS[1]);
  });
});

/*
 * And the bench, which a page has to be able to import without paying for three centuries first.
 */
describe('a bench somebody can import before deciding what to ask it', () => {
  it('does not live a single day until it is asked to', async () => {
    const before = Date.now();
    const bench = await import('../game/economy.bench');
    const cost = Date.now() - before;
    // three hundred-day runs take seconds; an import that only reads code takes milliseconds. The
    // bound is loose on purpose — what is being asserted is "nothing ran", not a speed
    expect(cost, 'importing the bench lived the world').toBeLessThan(2000);
    expect(typeof bench.runs, '`runs` is the door; `RUNS` was the doorway standing open').toBe('function');
  });
});
