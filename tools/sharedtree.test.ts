import { describe, expect, it } from 'vitest';
import {
  WRITTEN_BY_A_BENCH, nameFor, otherCheckouts, theWorktreeToTake, verdictOn, worthStopping,
} from './sharedtree';

/**
 * Whether it is safe to start work in this checkout.
 *
 * Item 137: several sessions wrote to one working tree at once and the result was not a merge
 * conflict but two afternoons — including two implementations of the same function, in the same
 * file, with different rules, neither of which knew about the other. The answer the item prefers is
 * the cheap one: a session that finds the tree dirty on entry stops.
 */
describe('what to do on walking into a checkout', () => {
  it('carries on where nothing is uncommitted', () => {
    expect(verdictOn({ dirty: [], elsewhere: [] }).stop).toBe(false);
  });

  /*
   * Other checkouts are not a reason to stop. A worktree each is the *answer*, so a repository with
   * six of them is a repository doing the right thing — it would be perverse to refuse over it.
   */
  it('carries on where other checkouts exist but this one is clean', () => {
    const said = verdictOn({ dirty: [], elsewhere: ['/tmp/a', '/tmp/b'] });
    expect(said.stop).toBe(false);
    expect(said.say.join(' ')).toContain('2 other worktrees');
  });

  it('stops on a dirty tree, and names what it found', () => {
    const said = verdictOn({ dirty: ['src/game/timber.ts', 'tools/release.ts'], elsewhere: [] });
    expect(said.stop).toBe(true);
    expect(said.say.join('\n')).toContain('src/game/timber.ts');
    expect(said.say.join('\n')).toContain('tools/release.ts');
  });

  /*
   * Dirty is the whole of the test. Knowing whether another session is *attached* is a guess about
   * intent; uncommitted work belonging to nobody named is a fact, and it is the fact that gets
   * thrown away by the next reset.
   */
  it('stops on a dirty tree even when it is the only checkout there is', () => {
    expect(verdictOn({ dirty: ['docs/worklist.md'], elsewhere: [] }).stop).toBe(true);
  });

  it('says how to get a checkout of your own rather than only saying no', () => {
    const said = verdictOn({ dirty: ['a.ts'], elsewhere: [] }).say.join('\n');
    expect(said).toContain('git worktree add');
  });
});

describe('the checkout to take instead', () => {
  it('is named after the work', () => {
    expect(theWorktreeToTake('deeds')).toBe('git worktree add ../ai.world-deeds -b deeds origin/main');
  });

  /*
   * The name ends up in a path one directory up, so a dot is the one character worth refusing that
   * a branch name would otherwise allow: `..` is the thing that stops meaning what it looks like.
   */
  it('will not be talked into a path out of a name', () => {
    expect(nameFor('../../etc/passwd')).toBe('etc-passwd');
    expect(theWorktreeToTake('../../etc/passwd')).toBe(
      'git worktree add ../ai.world-etc-passwd -b etc-passwd origin/main');
  });

  it('makes one word out of several', () => {
    expect(theWorktreeToTake('a name with spaces')).toBe(
      'git worktree add ../ai.world-a-name-with-spaces -b a-name-with-spaces origin/main');
  });

  it('has something to call a session that gave no name worth having', () => {
    expect(nameFor('!!!')).toBe('session');
    expect(theWorktreeToTake('!!!')).toContain('ai.world-session');
  });
});

describe('the other checkouts of this repository', () => {
  const listed = [
    'worktree /Volumes/x/ai.world',
    'HEAD abc',
    'branch refs/heads/main',
    '',
    'worktree /tmp/ai.world-deeds',
    'HEAD def',
    'branch refs/heads/deeds',
    '',
  ].join('\n');

  it('are every one but the one being asked about', () => {
    expect(otherCheckouts(listed, '/Volumes/x/ai.world')).toEqual(['/tmp/ai.world-deeds']);
  });

  it('are all of them when asked from somewhere else entirely', () => {
    expect(otherCheckouts(listed, '/nowhere')).toHaveLength(2);
  });

  it('are none when this is the only one', () => {
    expect(otherCheckouts('worktree /only\nHEAD abc\n', '/only')).toEqual([]);
  });
});

/**
 * And what is not worth stopping over.
 *
 * A guard that fires on the report the bench you just ran wrote is a guard somebody turns off in a
 * week — the same failure #81 and #98 both name, from the other end.
 *
 * `WRITTEN_BY_A_BENCH` is empty now and these tests say so rather than being deleted. Its one entry
 * was `sanity-report.txt`, excused because it was tracked; every report goes to the gitignored
 * `docs/reports/` and a report is not in `git status` at all, so there is nothing left to excuse.
 * The rule still has to work for the next tracked file a bench rewrites — and the better answer for
 * that file will usually be to stop tracking it.
 */
describe('what of the dirt is somebody\'s work', () => {
  it('excuses whatever is on the list, which is nothing today', () => {
    for (const path of WRITTEN_BY_A_BENCH) {
      expect(worthStopping([{ status: ' M', path }])).toEqual([]);
    }
  });

  it('no longer has to excuse a report, because a report is not in the tree', () => {
    expect(WRITTEN_BY_A_BENCH, 'an emptied excuse list is the fix; a re-filled one wants an argument')
      .toEqual([]);
  });

  it('is everything else, including what used to be excused', () => {
    expect(worthStopping([
      { status: ' M', path: 'sanity-report.txt' },
      { status: ' M', path: 'src/world/homes.ts' },
    ])).toEqual(['sanity-report.txt', 'src/world/homes.ts']);
  });

  it('leaves a source file with a report-ish name alone', () => {
    expect(worthStopping([{ status: ' M', path: 'tools/sanity-report.txt' }]))
      .toEqual(['tools/sanity-report.txt']);
  });

  /*
   * And the half the path on its own could not say.
   *
   * The exception is written for one thing that actually happens — `chore sanity` runs and leaves
   * its own reading in the worktree, unstaged. Every other way that file can be dirty is somebody
   * having decided something about it: staged for a commit, deleted, moved somewhere else. Waving
   * those through is the guard answering a question nobody asked it.
   */
  it('stops for a report somebody has staged, which the bench never does', () => {
    expect(worthStopping([{ status: 'M ', path: 'sanity-report.txt' }])).toEqual(['sanity-report.txt']);
  });

  it('stops for a report staged and then edited again', () => {
    expect(worthStopping([{ status: 'MM', path: 'sanity-report.txt' }])).toEqual(['sanity-report.txt']);
  });

  it('stops for a report somebody has deleted, either way round', () => {
    expect(worthStopping([{ status: ' D', path: 'sanity-report.txt' }])).toEqual(['sanity-report.txt']);
    expect(worthStopping([{ status: 'D ', path: 'sanity-report.txt' }])).toEqual(['sanity-report.txt']);
  });

  /*
   * A rename is caught today by accident rather than by rule: it dirties a second path, and the
   * second path is not on the exempt list. Retire it as a coincidence — both ends of the move carry
   * the rename's own status, and neither end is an unstaged modification.
   */
  it('stops for a report somebody has moved, at both ends of the move', () => {
    expect(worthStopping([
      { status: 'R ', path: 'docs/sanity-report.txt' },
      { status: 'R ', path: 'sanity-report.txt' },
    ])).toEqual(['docs/sanity-report.txt', 'sanity-report.txt']);
  });

  it('stops for a report that is untracked rather than modified', () => {
    expect(worthStopping([{ status: '??', path: 'sanity-report.txt' }])).toEqual(['sanity-report.txt']);
  });
});
