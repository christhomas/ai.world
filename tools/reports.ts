import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where a bench leaves its account of a run.
 *
 * Eleven things in this project write one — the collisions, the wire, the halves, the economy, the
 * population, the sanity pass, the unreached exports, the shop walk, the ticks, the playtest — and
 * they all used to write it to the root of the repository. Eight were gitignored one line at a
 * time, and two were not ignored at all.
 *
 * Those two, `population-report.txt` and `sanity-report.txt`, were tracked deliberately: a reading
 * somebody could diff between releases. It is a reasonable thing to want and it did not survive
 * contact with the thing being a *generated file*:
 *
 * - **It conflicts on every rebase.** A file rewritten by every run disagrees between any two
 *   branches that have run the bench, and resolving it decides nothing.
 * - **The committed copy goes stale and is believed.** `main` carried a population report reading
 *   589 couples at 1.3 children each; a clean checkout of that same commit regenerates 601 at 1.26.
 *   A pull request quoted the committed figures as its baseline and had to be corrected afterwards.
 *   A committed artefact that disagrees with what the code produces is worse than no artefact,
 *   because people trust it.
 * - **It blocks the release.** `chore release` refuses a dirty tree, and any local test run dirties
 *   both of them.
 *
 * So: one directory, one ignore rule, nothing tracked. What a run produced is kept by the thing
 * that ran it — CI uploads them as artifacts — and what a change *did* belongs in the pull request
 * that made it, written out as a sentence by somebody who read the numbers.
 *
 * ## Why this module is in `tools/`
 *
 * Nothing the *game* does writes a report — only benches, tests and the command-line tools do. So
 * an export of this living under `src/` would be reached by nothing the program runs, which is
 * exactly what `reachable.test.ts` counts and ratchets on. It caught this on the first try.
 *
 * ## Why under `docs/` rather than a hidden directory
 *
 * They are for reading. A `.reports` next to `.scratch` says throw-away; these are the first thing
 * anybody opens when a bench goes red, and `docs/reports/economy-report.txt` is a path somebody can
 * be told over a wire without explaining it.
 */
export const REPORTS = 'docs/reports';

/**
 * The path a report of this name goes to, with the directory made if it is not there.
 *
 * Made here rather than by each caller, because the directory is gitignored and therefore absent
 * from every fresh clone and every new worktree — and a bench that fell over on `ENOENT` after
 * running for two minutes would be a bench somebody stops running.
 */
export function reportAt(name: string): string {
  mkdirSync(REPORTS, { recursive: true });
  return join(REPORTS, name);
}
