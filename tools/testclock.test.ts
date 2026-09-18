import { afterEach, describe, expect, it } from 'vitest';
import config, { longerClock } from '../vite.config';

/**
 * How long a test is allowed to take, and why it can be lengthened from outside — #362.
 *
 * `testTimeout` is a budget for *work*, and the work is not the same size on every machine. Growing
 * a patch of the endless country is *"about six hundred milliseconds"* on the desk
 * `country.worker.ts` was written for, and **fourteen seconds** on a four-core ARM box — measured
 * over two hundred seeds through `growPatch`, 2794.9s for the lot. So a test that grows a handful of
 * patches is budgeted at two minutes against work that takes twenty times what the budget assumed.
 *
 * It does not fail. It runs out of clock, which looks exactly like failing: 125s welcoming a player
 * to a world, 285s clearing what was growing inside a paddock's rails, on a tree CI had already
 * passed green. `vite.config.ts` says the same thing about starvation one paragraph down —
 * *"a starved measurement does not look starved, it looks broken."*
 *
 * And it cost a release, which is what makes it worth a test rather than a comment. `chore release`
 * runs the whole suite as its first act, on the honest argument that a release is the wrong place to
 * find out — so a machine that cannot finish the suite cannot ship, however green CI is on the very
 * same commit.
 */

/** The config as vitest actually asks for it: a function of the command it was invoked with. */
const made = () => (config as unknown as (env: { command: string; mode: string }) =>
  { test: { testTimeout: number } })({ command: 'serve', mode: 'test' });

const DEFAULT = 120_000;

afterEach(() => { delete process.env.TEST_TIMEOUT; });

describe('how long a test is allowed to take', () => {
  it('is two minutes for anybody who has not asked for longer', () => {
    expect(made().test.testTimeout).toBe(DEFAULT);
  });

  it('is longer on a machine slow enough to need it', () => {
    process.env.TEST_TIMEOUT = '600000';
    expect(made().test.testTimeout).toBe(600_000);
  });

  /*
   * Only ever longer, and only ever a number of milliseconds.
   *
   * The first version of this held the rule *"never shortens it"* and asserted `>= DEFAULT`, which
   * is true of `Infinity` — so `TEST_TIMEOUT=Infinity` went straight through to vitest, which
   * documents nought as the way to switch a timeout off and has no contract for infinity at all.
   * The rule was right and the assertion was the wrong shape for it: the fault with infinity is not
   * that it is short.
   *
   * #353 made the same call for `PATIENCE` in `shots.cjs`. A knob for a clock takes a finite number
   * or it is not an answer.
   */
  it('takes nothing but a finite number of milliseconds', () => {
    for (const asked of ['1000', '0', '-5', 'oops', '', 'Infinity', '-Infinity', 'NaN', '1e400']) {
      expect(longerClock(asked), `TEST_TIMEOUT=${asked}`).toBe(DEFAULT);
    }
    expect(longerClock(undefined)).toBe(DEFAULT);
  });

  it('is longer only when the answer is both a number and longer', () => {
    expect(longerClock('600000')).toBe(600_000);
    expect(longerClock('120001')).toBe(120_001);
    expect(longerClock('119999'), 'shorter than the floor is the floor').toBe(DEFAULT);
  });

  it('is the one the config hands vitest', () => {
    process.env.TEST_TIMEOUT = 'Infinity';
    expect(made().test.testTimeout, 'infinity reached vitest').toBe(DEFAULT);
    process.env.TEST_TIMEOUT = '600000';
    expect(made().test.testTimeout).toBe(600_000);
  });
});
