import { execFileSync } from 'node:child_process';
import { whatIsDirty } from './fallbackguard';

/**
 * Whether it is safe to start work in this checkout.
 *
 * Several agent sessions were run against one working tree at once, and the result was not a merge
 * conflict — it was two afternoons. Every attempt to hand the repository over clean was followed
 * within a minute by a fresh set of modified files nobody in that session had touched: a day's
 * timber accounting, a deed-based `homes.ts` across ten files, twenty-two dead exports deleted, and
 * a **second** `howTheChecksStand` in `release.ts` with different rules from the one already in a
 * pull request. Two sessions had solved the same issue twice and neither knew.
 *
 * Three things go wrong, and only the first is untidiness:
 *
 * - **Work is invisible until somebody trips over it.** All of that was finished-looking work that
 *   existed only as unstaged edits. The default outcome is that the next `git checkout`, `git reset
 *   --hard` or `chore fallbacks` throws it away and nobody ever learns it existed.
 * - **A green suite is green about a tree that no longer exists.** A full run finished at 21:23 and
 *   the files under it had changed by 21:25.
 * - **Nothing can tell whose edits are whose.** That is not a thing this can fix, and it is why the
 *   answer is to stop rather than to be clever.
 *
 * Item 137 weighs two answers and prefers this one: *"a session that finds the tree dirty on entry
 * refuses to work in it until whoever owns those edits has committed them"*. It is the same rule
 * `chore fallbacks` already applies to itself, for the same reason — it could not tell its own
 * edits from yours either.
 *
 * The way out is a worktree, which costs one command and gives a session a checkout nobody else is
 * writing to. This prints it rather than describing it.
 */

/**
 * Files a bench rewrites every time it runs, which are not anybody's afternoon.
 *
 * `sanity-report.txt` is tracked on purpose — a reading somebody can diff between releases — and it
 * is rewritten by every `chore sanity`. A guard that stops a session because the bench it just ran
 * left its own report behind is a guard somebody turns off in a week, which is the failure mode
 * #81 and #98 both name.
 */
export const WRITTEN_BY_A_BENCH: readonly string[] = ['sanity-report.txt'];

/** What of the uncommitted work is somebody's, as opposed to a bench's own output. */
export function worthStopping(dirty: readonly string[]): string[] {
  return dirty.filter((path) => !WRITTEN_BY_A_BENCH.includes(path));
}

/** What is in the tree that nobody has committed, and who else might be holding it. */
export interface Standing {
  dirty: readonly string[];
  /** Other checkouts of this repository, by path, excluding the one being asked about. */
  elsewhere: readonly string[];
}

/**
 * What to do about it: carry on, or stop and say why.
 *
 * Dirty is the whole of the test, and deliberately. Knowing whether another session is *attached*
 * is unreliable — a process list is a guess about intent — but uncommitted work belonging to
 * somebody unknown is a fact, and it is the fact that gets thrown away. A clean tree with six other
 * sessions on it is fine; a dirty tree with none is still a tree whose edits nobody has claimed.
 */
export function verdictOn(standing: Standing): { stop: boolean; say: string[] } {
  if (standing.dirty.length === 0) {
    const also = standing.elsewhere.length;
    return {
      stop: false,
      say: [`the tree is clean${also > 0 ? `, and ${also} other worktree${also === 1 ? '' : 's'} of this repository exist` : ''}`],
    };
  }
  return {
    stop: true,
    say: [
      `${standing.dirty.length} uncommitted file${standing.dirty.length === 1 ? '' : 's'} in this checkout, and nothing says whose they are:`,
      ...standing.dirty.map((path) => `  ${path}`),
      '',
      'Do not start here. Whoever owns that work has not committed it, and the next checkout,',
      'reset or sweep in this tree throws it away without telling anybody.',
      '',
      'Either wait for it to be committed, or take a checkout nobody else is writing to:',
      '',
      `  ${theWorktreeToTake('my-session')}`,
      '',
      'A worktree shares the repository and has its own files, which is exactly the thing',
      'that was missing. See item 137.',
    ],
  };
}

/**
 * What to call the checkout and the branch, out of whatever somebody typed.
 *
 * No dots, which is narrower than a branch name has to be and is the point: this ends up in a
 * *path*, one directory up, and `..` in a path is the one thing that stops meaning what it looks
 * like. Git would refuse `..` in a branch name anyway; a directory would not.
 */
export function nameFor(asked: string): string {
  return asked.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

/** The command that gives a session its own files. Named after the work, not after the session. */
export function theWorktreeToTake(asked: string): string {
  const safe = nameFor(asked);
  return `git worktree add ../ai.world-${safe} -b ${safe} origin/main`;
}

/**
 * Every checkout of this repository other than the one being asked about.
 *
 * Read off `git worktree list --porcelain`, whose records begin with a `worktree <path>` line. Not
 * a process list: what matters is how many places these files exist, which git knows for certain.
 */
export function otherCheckouts(porcelain: string, here: string): string[] {
  return porcelain.split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter((path) => path !== '' && path !== here);
}

function main(): void {
  const here = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const standing: Standing = {
    dirty: worthStopping(
      whatIsDirty(execFileSync('git', ['status', '--porcelain', '-z'], { encoding: 'utf8' })),
    ),
    elsewhere: otherCheckouts(
      execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' }), here,
    ),
  };
  const { stop, say } = verdictOn(standing);
  for (const line of say) (stop ? console.error : console.log)(line);
  if (stop) process.exit(1);
}

if (process.argv[1]?.endsWith('sharedtree.ts')) main();
