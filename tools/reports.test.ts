import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPORTS, reportAt } from './reports';

/**
 * Every report a bench writes lands in one place, and that place is not in the repository.
 *
 * Eleven benches and tools in this project each write an account of their run — the collisions, the
 * wire, the halves, the economy, the population, the sanity pass, the unreached exports, the shop
 * walk, the ticks, the playtest. Ten of them were scattered across the repository root, eight of
 * those were gitignored one line at a time, and **two were tracked**: `population-report.txt` and
 * `sanity-report.txt`.
 *
 * Those two were the problem, and they were a problem in three separate ways over one night:
 *
 * - **They conflicted on every rebase.** A generated file changes on every run, so every branch
 *   that had run a bench disagreed with every other one about it — about a dozen times in an
 *   evening, each needing a resolution that decided nothing.
 * - **The committed copy went stale and was believed.** `main` carried a population report reading
 *   589 couples at 1.3 children; a clean checkout of that same commit regenerates 601 at 1.26. A
 *   pull request quoted the committed figures as its baseline and had to be corrected. A committed
 *   artefact that disagrees with what the code produces is worse than no artefact, because people
 *   trust it.
 * - **They blocked the release.** `chore release` refuses a dirty tree, and any local test run
 *   dirties these two.
 *
 * `tools/sharedtree.ts` had already half-noticed, carrying a `WRITTEN_BY_A_BENCH` list whose only
 * entry was `sanity-report.txt` — a special case excusing a file from a guard, existing solely
 * because that file should never have been tracked. It is gone with this.
 */

describe('where a report goes', () => {
  it('is one directory rather than eleven names at the root', () => {
    expect(reportAt('sanity-report.txt')).toBe(join(REPORTS, 'sanity-report.txt'));
  });

  it('is ignored by git as a directory, not file by file', () => {
    const ignore = readFileSync('.gitignore', 'utf8');
    expect(ignore, 'the point of one place is one rule').toContain(`${REPORTS}/`);
    const byName = ignore.split('\n').filter((l) => /^[a-z-]+-report\.txt$/.test(l.trim()));
    expect(byName, 'a report ignored by its own name is a report somebody has to remember').toEqual([]);
  });

  it('is not a file anybody has committed', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n').filter((f) => /-report\.txt$/.test(f));
    expect(tracked, 'a generated file in git is a file that goes stale and is believed').toEqual([]);
  });

  it('is where every writer in the repository actually writes', () => {
    /*
     * Asked of the source rather than of a list here, for the reason `behaviours.test.ts` gives
     * about the same shape of problem: a list beside a list is a list that falls out of step. A
     * twelfth bench writing `twelfth-report.txt` to the root fails here on the day it is written.
     */
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(path);
      // tests and guards *name* these paths without writing them, so a mention is not a writer
      return e.isFile() && /\.(ts|cjs|mjs|js)$/.test(e.name) && !/\.test\.[tj]s$/.test(e.name) ? [path] : [];
    });
    const loose: string[] = [];
    for (const file of [...sources('src'), ...sources('tools')]) {
      const body = readFileSync(file, 'utf8');
      // a bare '<name>-report.txt' in quotes, with nothing joining it to the reports directory
      for (const [, quoted] of body.matchAll(/['"`](\w[\w-]*-report\.txt)['"`]/g)) {
        if (!new RegExp(`REPORTS|reportAt|${REPORTS}`).test(body)) loose.push(`${file}: ${quoted}`);
      }
    }
    expect([...new Set(loose)], 'a report written straight to the root is a report nobody ignored')
      .toEqual([]);
  });
});
