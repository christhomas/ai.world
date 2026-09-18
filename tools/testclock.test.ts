import { afterEach, describe, expect, it } from 'vitest';
import config from '../vite.config';
import { TWO_MINUTES, atTheSamePace, longerClock } from './clock';

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
  { test: { testTimeout: number; hookTimeout: number } })({ command: 'serve', mode: 'test' });

const DEFAULT = TWO_MINUTES;

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

/**
 * And the hooks, which are where the slow machine actually died.
 *
 * `TEST_TIMEOUT` lengthened the test bodies and left setup and teardown on vitest's default ten
 * seconds, which was never set here at all. Four server files stand a real HTTP and WebSocket
 * server up in a hook and close it in another, and closing two of them ran past ten seconds — so
 * the run died with `Hook timed out in 10000ms` **after 3563 of 3566 tests had passed**.
 */
describe('how long the setting up and tearing down is allowed to take', () => {
  afterEach(() => { delete process.env.TEST_TIMEOUT; });

  it('is the same clock the tests themselves are held to', () => {
    expect(made().test.hookTimeout).toBe(made().test.testTimeout);
  });

  it('lengthens with it, because opening a world in a hook is the same work', () => {
    process.env.TEST_TIMEOUT = '600000';
    expect(made().test.hookTimeout).toBe(600_000);
  });
});

/**
 * A wait of its own, scaled rather than replaced.
 *
 * The handshake waits in `serve.test.ts` and `proxy.test.ts` are not test timeouts — they are how
 * long to sit before calling a websocket upgrade dead. Handing them the test clock outright would
 * mean a genuinely broken handshake taking fifteen minutes to be called broken, and then blowing
 * the test's own budget and reporting the wrong fault entirely.
 *
 * What they want is the same machine, scaled: twenty seconds was chosen against a desk, and on a
 * box where the clock has been stretched seven and a half times it is two and a half minutes.
 */
describe('a wait that is not a test timeout', () => {
  it('is exactly what it was when nobody asked for longer', () => {
    expect(atTheSamePace(20_000, undefined)).toBe(20_000);
    expect(atTheSamePace(20_000, 'oops')).toBe(20_000);
    expect(atTheSamePace(20_000, 'Infinity')).toBe(20_000);
  });

  it('stretches by the same ratio the clock did, and no further', () => {
    // 900000 / 120000 is seven and a half, so twenty seconds becomes a hundred and fifty
    expect(atTheSamePace(20_000, '900000')).toBe(150_000);
    expect(atTheSamePace(20_000, '240000')).toBe(40_000);
  });

  it('stays well inside the budget it is spent out of', () => {
    for (const asked of ['240000', '600000', '900000']) {
      expect(atTheSamePace(20_000, asked)).toBeLessThan(longerClock(asked));
    }
  });
});
