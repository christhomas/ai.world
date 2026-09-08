/**
 * What this build calls itself.
 *
 * The three values are replaced at build time by `vite.config.ts` — there is no runtime lookup and
 * nothing to fetch, so a page can say what it is even when the thing that is broken is the network.
 * That is the point of it: the first question asked of a deployment that has just gone out is
 * "which version am I actually looking at", and until now the answer was to read the image tag on
 * the cluster and hope.
 *
 * The declarations are here so that TypeScript knows about the substitution; the `??` fallbacks are
 * for the test runner, which does not go through the bundler and would otherwise crash on them.
 */

declare const __GAME_NAME__: string | undefined;
declare const __GAME_VERSION__: string | undefined;
declare const __BUILT_ON__: string | undefined;

export const GAME = {
  /** What it is called, on the title and in the console. */
  name: typeof __GAME_NAME__ === 'string' ? __GAME_NAME__ : 'AI World',
  /** The package version, which `chore release` moves in step with the chart and the image tag. */
  version: typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev',
  /** The day this bundle was built, which is not the day it is being played. */
  builtOn: typeof __BUILT_ON__ === 'string' ? __BUILT_ON__ : 'today',
} as const;

/** Today, as the machine playing it reckons it: 2026-09-08. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One line naming the game, its version and the date — what the console says when it opens. */
export function greeting(): string {
  return `${GAME.name} v${GAME.version} — built ${GAME.builtOn}, today is ${today()}`;
}
