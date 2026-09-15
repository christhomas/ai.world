/**
 * Why a name nothing but its own tests reaches is allowed to stay.
 *
 * `reachable.test.ts` counts exported work the game never calls. Some of that is the fault the
 * bench exists for — a whole feature with a guard on it and nothing behind it, which is how an
 * injury system once sat in this repository unreachable with its tests passing. Some of it is not:
 * a constant a test imports to check a table against, a guard whose entire job is to be called by
 * the suite, a seam deliberately held open while the thing on the other side is built.
 *
 * A single number that mixes those is a number nobody can act on, and the pressure it creates is to
 * make it smaller rather than to make it true. So an excuse is written down here, and the count of
 * the unexcused is reported beside the total.
 *
 * ## The obvious way this goes wrong
 *
 * An excuse is cheaper to write than a fix. Two things keep it honest, and both are why this is a
 * module of its own rather than a constant inside a test file:
 *
 * - **An excuse has a shape.** It names the test that owns the export, or the issue its caller
 *   waits on. `reachable.test.ts` refuses one that names neither, so "this is fine" cannot be an
 *   excuse.
 * - **An excuse naming an issue expires with it.** `tools/staleexcuses.ts` asks GitHub whether each
 *   named issue is still open and fails when one has closed with the name still unreached. Written
 *   as a tool rather than a unit test because it needs the network, and the suite must not.
 *
 * The bench also refuses an excuse for an export that no longer exists, so a deletion cannot leave
 * a suppression behind — and, since #177, one for an export the program has since *reached*, so
 * finishing the work an excuse was waiting on cannot leave the excuse behind either.
 *
 * ## Why it lives in `tools` rather than beside the bench
 *
 * The bench decides "reached" by looking for the name anywhere under `src` and `server` outside its
 * own file. Every excuse in this list *contains* the name it excuses, so a copy of this list under
 * `src` would make all of them look reached and the bench would report two. It did, for about a
 * minute. The list has to sit outside the ground the bench walks.
 *
 * There is a second reason, learned the expensive way. #134 landed a branch cut before the list
 * moved out here, and its squash restored the bench's own inline copy — so for a day there were two
 * lists, the bench read one and `chore excuses` watched the other, and nothing failed because a
 * list nobody updates agrees with itself perfectly. The nineteen exports #134 deleted stayed
 * excused here, and two themes wired by #188 stayed excused against the issue that wiring closed.
 * **This is the list. The bench imports it.**
 */
export const EXCUSED = new Map<string, string>([
  ['src/dungeon/castlerooms.ts: HANGS_ON_WALLS', 'castle.test checks that file-driven hangings occupy walls'],
  ['src/entities/monsters.ts: MONSTER_KINDS', 'monster tests inspect the curated monster kinds'],
  ['src/entities/motion.ts: FLINCH_LASTS', 'motion tests use the exported duration as their timing boundary'],
  ['src/entities/shapes.ts: partPoints', 'sites tests measure a prop\'s corners with it: the one door onto placedPieces'],
  ['src/entities/spawns.ts: DUNGEON_MONSTERS', 'danger tests exercise every shallow-dungeon spawn kind'],
  ['src/entities/villain.ts: VILLAIN_KINDS', 'villain tests inspect the curated villain kinds'],
  ['src/game/brewing.ts: RECIPE', 'brewing tests verify the recipe table consumers must satisfy'],
  ['src/game/predicted.ts: inTheHand', 'prediction tests guard held-item state across replay'],
  ['src/render/footprint.ts: measureFootprint', 'footprint tests hold the built mesh against the catalogue box with it'],
  ['src/world/catalogue.ts: GROUPS', 'catalogue tests verify the complete item grouping'],
  ['src/world/civics.ts: worksNobodyPlaced', 'civics tests fail when a public work has no placement path'],
  ['src/world/food.ts: grownInADay', 'food and fishing tests own the aggregate-yield invariant; runtime totals broughtIn directly'],
  ['src/world/vocabulary.ts: DEEDS', 'vocabulary tests verify every deed has words'],
  ['src/world/vocabulary.ts: HOLDINGS', 'vocabulary tests verify every holding has words'],
]);

/** The issue an excuse defers to, or nothing where it names a test instead. */
export function issueIn(reason: string): number | null {
  const named = reason.match(/issue #(\d+)/);
  return named ? Number(named[1]) : null;
}

/**
 * Whether an excuse is in a form somebody can check.
 *
 * It must name the issue its caller waits on, or a test — and a test is named by saying so, because
 * the file a test lives in is not always the file the export is in. Anything else is an opinion,
 * and an opinion is what this list must never fill up with.
 */
export function isCheckable(reason: string): boolean {
  return issueIn(reason) !== null || namesATest(reason);
}

/**
 * Words that can stand before "tests" without naming any.
 *
 * The whole difference between an excuse and a shrug. *"Not covered by tests"* satisfied the old
 * check — it contains the word — while naming nothing anybody could go and read, and
 * `staleexcuses.ts` had no issue to watch either, so an unreached export could sit behind it for
 * ever. Every real excuse in this file names its suite: *"monster tests"*, *"brewing tests"*,
 * *"food and fishing tests"*.
 */
const NAMES_NOTHING = new Set([
  'by', 'the', 'a', 'an', 'any', 'no', 'not', 'in', 'with', 'without', 'and', 'or', 'of', 'for',
  'these', 'those', 'some', 'its', 'our', 'their', 'more', 'other', 'unit', 'existing',
  'are', 'is', 'were', 'was', 'have', 'has', 'had', 'be', 'been', 'only', 'just', 'all', 'few',
]);

/**
 * Whether this reason names the tests that own the export, rather than mentioning tests at all.
 *
 * Two forms count. A file said outright — `castle.test` — is a thing somebody can open. And a word
 * standing immediately before "test" or "tests" is the name of a suite, unless it is one of the
 * words above, which are the ways of saying "tests" while naming none.
 */
export function namesATest(reason: string): boolean {
  if (/\b[\w-]+\.test\b/.test(reason)) return true;
  for (const said of reason.matchAll(/(\w+)\s+tests?\b/gi)) {
    if (!NAMES_NOTHING.has(said[1].toLowerCase())) return true;
  }
  return false;
}
