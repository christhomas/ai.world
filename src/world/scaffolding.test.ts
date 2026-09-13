import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A check script outlives its task by exactly nothing.
 *
 * `checks/<n>.sh` exists to say whether issue *n* is finished. The moment that issue closes the
 * script has no caller — the task-runner will never ask for it again — and what is left is a file
 * that looks live, runs never, and rots quietly against code that has moved underneath it.
 *
 * That is the same fault this repository spent the 13th of September digging out of itself: an
 * injury system with no caller, a mountain radius whose fallback was the only branch, four dead
 * exports in `haunts.ts` whose prose still described what the frame loop did. `chore reachable`
 * counts forty-three of them. It would be a poor day's work to answer that by starting a fresh pile
 * of the same thing in a new directory.
 *
 * So when a task goes green there are two honest endings and this insists on one of them:
 *
 * - **the property should stay true** — then it belongs in this suite, where something runs it on
 *   every build, and the script goes;
 * - **it was a one-off** — `! grep -q maybeNum`, `test -f report.md` — then it has nothing left to
 *   say and the script goes.
 *
 * Either way the script goes. It is scaffolding, and scaffolding comes down.
 */
describe('the scaffolding under a finished task', () => {
  it('is taken down when its issue closes', () => {
    if (!existsSync('checks')) return;                    // nothing built yet, nothing to take down
    const scripts = readdirSync('checks').filter((f) => /^\d+\.sh$/.test(f));
    if (scripts.length === 0) return;

    let open: Set<string>;
    try {
      const said = execFileSync('gh',
        ['issue', 'list', '--label', 'task-runner', '--state', 'open', '--limit', '200', '--json', 'number'],
        { encoding: 'utf8', timeout: 30_000 });
      open = new Set((JSON.parse(said) as Array<{ number: number }>).map((i) => String(i.number)));
    } catch {
      return;                                             // no gh, no network: not this test's business
    }

    const orphans = scripts
      .map((f) => f.replace('.sh', ''))
      .filter((n) => !open.has(n))
      .map((n) => `checks/${n}.sh — issue #${n} is closed`);

    expect(orphans, 'promote it into this suite if the property should hold, or delete it').toEqual([]);
  });
});
