import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACTS, claimsFor, inTheHand, sideOf } from './predicted';

/**
 * The list item 73 asked for, and the thing that keeps it from being a paragraph.
 *
 * *"What is left is the list: a swing, a door, a trade, a hire, a build."* The division was written
 * down and never applied, so each new act on the wire was decided by whoever wrote it, from
 * precedent — which is how a rule becomes a habit and then becomes an argument.
 */
describe('what may be done before the world agrees', () => {
  it('has an answer for every one of the five the item named', () => {
    for (const act of ['swing', 'door', 'trade', 'hire', 'build']) {
      expect(sideOf(act), `${act} has no side`).not.toBeNull();
    }
  });

  it('puts the hand before the ledger where a wrong guess is private', () => {
    // a swing nobody else saw can be put back quietly; a door is jarring and recoverable
    expect(sideOf('swing')).toBe('hand');
    expect(sideOf('door')).toBe('hand');
  });

  it('makes the ledger wait where a wrong guess is somebody else\'s problem', () => {
    // money taken back, a man hired twice, a building that appeared and then did not
    expect(sideOf('trade')).toBe('ledger');
    expect(sideOf('hire')).toBe('ledger');
    expect(sideOf('build')).toBe('ledger');
  });

  it('says why, in the terms that decide it', () => {
    // "who sees it if the prediction is wrong" — not "is it important" and not "is it slow"
    for (const act of ACTS) {
      expect(act.because.length, `${act.id} has no argument`).toBeGreaterThan(40);
    }
  });

  it('refuses to hand out a claim for something the ledger owns', () => {
    // the rule and the machinery are different things, and this is where they meet
    expect(() => claimsFor('trade')).toThrow(/ledger/);
    expect(() => claimsFor('hire')).toThrow(/ledger/);
    expect(() => claimsFor('swing')).not.toThrow();
  });

  it('has nothing on the wire that nobody has decided about', () => {
    /*
     * The assertion that makes this worth having. Every file reaching for `Claims` is predicting
     * something; if what it predicts is not on the list, the list has stopped being the rule and
     * become a description of what three files happened to do.
     *
     * It used to count the files and then assert something else entirely — that `chest` and `crop`
     * are on the list — which is two true statements with nothing joining them. Greptile found it
     * on #66: a fourth file predicting `trade` would have been counted, checked against nothing,
     * and left the suite green while the rule and the code drifted apart. And `claimsFor` was the
     * guarded door nobody went through, which is this codebase's own recurring fault: written,
     * tested, documented, and reached by nothing.
     *
     * So the rule is now the one the finding asked for. Every claim is made through `claimsFor`,
     * which names the act out loud, and those names are read back here and held against the list.
     * A prediction of something the ledger owns cannot be written at all — `claimsFor` throws —
     * and a prediction of something nobody has decided about fails here.
     */
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return e.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
    });
    const elsewhere = sources('src')
      .filter((f) => !f.endsWith(join('game', 'predicted.ts')) && !f.endsWith(join('game', 'claims.ts')));

    // the machinery is reached one way, so that reaching for it is saying what for
    const raw = elsewhere.filter((f) => /new Claims</.test(readFileSync(f, 'utf8')));
    expect(raw, 'a claim made without naming its act is a prediction nobody decided on').toEqual([]);

    // and what each of them named, held against the list
    const claimed = elsewhere.flatMap((f) => [...readFileSync(f, 'utf8')
      .matchAll(/claimsFor<[^>]*>\('([^']+)'\)/g)].map((m) => m[1]));
    expect(claimed.length, 'nothing predicts anything, so this rule guards nothing').toBeGreaterThan(0);
    for (const act of claimed) {
      expect(inTheHand(), `${act} is predicted in the code and is not a hand on the list`).toContain(act);
    }
    // and the two the list is carrying for those files, named here so that quietly dropping one
    // from `ACTS` is a failure rather than a smaller set agreeing with itself
    expect([...new Set(claimed)].sort()).toEqual(['chest', 'crop']);
  });
});
