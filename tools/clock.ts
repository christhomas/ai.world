/**
 * How long a test is allowed to take, on a machine that may not be the one this was written on.
 *
 * Every number here is a budget for *work*, and the work is not the same size everywhere. Growing a
 * patch of the endless country is *"about six hundred milliseconds"* on the desk
 * `workers/country.worker.ts` was written for, and **fourteen seconds** on a four-core ARM box —
 * measured over two hundred seeds through `growPatch`, 2794.9s for the lot. Twenty times slower.
 *
 * A test that grows a handful of patches is then budgeted against work twenty times the size of
 * what the budget assumed. It does not fail; it runs out of clock, which looks exactly like
 * failing. `vite.config.ts` says the same thing about starvation: *"a starved measurement does not
 * look starved, it looks broken."*
 *
 * It cost a release. `chore release` runs the whole suite as its first act, on the honest argument
 * that a release is the wrong place to find out — so a machine that cannot finish the suite cannot
 * ship, however green CI is on the very same commit. See #362.
 *
 * Its own module because three different kinds of thing need it and one of them is the config
 * itself: a server test importing `vite.config.ts` to find out how patient to be is a test reaching
 * for the build to answer a question about the machine.
 */

/** What a test is given when nobody has asked for longer, and the floor nothing goes under. */
export const TWO_MINUTES = 120_000;

/**
 * The clock a test is held to: two minutes, or longer where somebody asked for longer.
 *
 * `Math.max(TWO_MINUTES, Number(asked) || 0)` was the first go and it had one hole. Every *finite*
 * wrong answer falls through it correctly — a word is `NaN`, `NaN || 0` is nought, and the floor
 * takes over — but `Number('Infinity')` is `Infinity`, which is larger than the floor and therefore
 * survives it. Vitest documents nought as the way to switch a timeout off and has no contract for
 * infinity, so that one bad input was the one that reached it.
 *
 * #353 made the same call for `PATIENCE` in `shots.cjs`: a knob for a clock takes a finite number
 * or it is not an answer.
 */
export function longerClock(asked: string | undefined): number {
  const ms = Number(asked);
  return Number.isFinite(ms) && ms > TWO_MINUTES ? ms : TWO_MINUTES;
}

/**
 * A wait of its own, lengthened by however much the test clock was — and no more.
 *
 * The handshake waits in `serve.test.ts` and `proxy.test.ts` are not test timeouts; they are how
 * long to sit before calling a websocket upgrade dead. Handing them `longerClock` outright would be
 * wrong in a way that is worth spelling out: with `TEST_TIMEOUT=900000` a genuinely broken
 * handshake would take fifteen minutes to be declared broken, and would then blow the test's own
 * budget anyway and report the wrong fault.
 *
 * What they actually want is *the same machine, scaled*. Twenty seconds was chosen against a desk;
 * on a box where the clock has been stretched seven and a half times, twenty seconds is two and a
 * half minutes. Unset, the ratio is one and every wait is exactly what it was.
 */
export function atTheSamePace(normally: number, asked = process.env.TEST_TIMEOUT): number {
  return Math.round(normally * (longerClock(asked) / TWO_MINUTES));
}
