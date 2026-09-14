import { describe, expect, it } from 'vitest';
import { EXCUSED, isCheckable, issueIn, namesATest } from './excused';
import { issuesNamed, whichHaveExpired, type IssueState } from './staleexcuses';

/**
 * The half of "an excuse has to stay true" that can be decided without asking anybody.
 *
 * `staleexcuses.ts` asks GitHub whether the issues are still open, which a unit test must never do
 * — a test that needs the network is a test that fails on a train. So the decision is separated
 * from the asking: this holds the decision, and the tool only supplies the answers.
 */
describe('an excuse that has outlived its issue', () => {
  const excuses = new Map([
    ['a.ts: one', 'caller is pending in issue #10'],
    ['b.ts: two', 'caller is pending in issue #11'],
    ['c.ts: three', 'the suite fails when this answers non-empty'],
  ]);

  it('is the one whose issue has closed', () => {
    const states = new Map<number, IssueState>([[10, 'OPEN'], [11, 'CLOSED']]);
    expect(whichHaveExpired(excuses, states).map((one) => one.name)).toEqual(['b.ts: two']);
  });

  it('leaves an excuse that names a test alone, because no issue is going to close under it', () => {
    const states = new Map<number, IssueState>([[10, 'CLOSED'], [11, 'CLOSED']]);
    expect(whichHaveExpired(excuses, states).map((one) => one.name))
      .toEqual(['a.ts: one', 'b.ts: two']);
  });

  /*
   * An issue nobody can find is worth exactly as much as a closed one: both are a promise pointing
   * at nothing, and both are something somebody has to go and look at.
   */
  it('counts an issue nobody could find as expired rather than as fine', () => {
    expect(whichHaveExpired(excuses, new Map([[10, 'UNKNOWN'], [11, 'OPEN']])).map((one) => one.issue))
      .toEqual([10]);
  });

  it('asks about each issue once however many names cite it', () => {
    expect(issuesNamed(new Map([
      ['a', 'pending in issue #88'], ['b', 'pending in issue #88'], ['c', 'pending in issue #36'],
    ]))).toEqual([36, 88]);
  });
});

/**
 * And reading an issue number back out of an excuse, which both halves depend on.
 *
 * The shape of an excuse is held to by `reachable.test.ts`, which is where the list is used.
 */
describe('what an excuse defers to', () => {
  it('reads its issue number back out of what it says', () => {
    expect(issueIn('wire-or-delete decision tracked by issue #88')).toBe(88);
    expect(issueIn('brewing tests verify the recipe table')).toBeNull();
  });
});

/**
 * And the half of an excuse that names a test rather than an issue.
 *
 * `/\btests?\b/` accepted anything containing the word, so *"not covered by tests"* passed while
 * naming nothing anybody could go and read — and with no issue in it, `staleexcuses.ts` had
 * nothing to watch either. An unreached export could sit behind that for ever, which is exactly
 * what the excuse list is supposed to make impossible.
 */
describe('an excuse that names a test', () => {
  it('names which tests, the way every real one in this file does', () => {
    for (const said of ['monster tests inspect the curated kinds', 'brewing tests verify the table',
                        'food and fishing tests own the aggregate-yield invariant',
                        'castle.test checks that hangings occupy walls']) {
      expect(namesATest(said), said).toBe(true);
    }
  });

  it('is not satisfied by the word on its own', () => {
    for (const shrug of ['not covered by tests', 'no tests reach it', 'covered in tests',
                         'kept for the tests', 'unit tests only', 'there are tests']) {
      expect(namesATest(shrug), shrug).toBe(false);
      expect(isCheckable(shrug), `${shrug} — and so it is not an excuse`).toBe(false);
    }
  });

  it('still takes an issue number instead, which is the other half', () => {
    expect(isCheckable('wire-or-delete decision tracked by issue #88')).toBe(true);
  });

  /* Run against the real list, because the real list is the thing that rots. */
  it('is true of every excuse this repository actually holds', () => {
    expect([...EXCUSED].filter(([, why]) => !isCheckable(why)).map(([name]) => name)).toEqual([]);
  });
});
