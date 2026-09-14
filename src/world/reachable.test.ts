import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXCUSED, isCheckable } from '../../tools/excused';

/**
 * Work that exists and nothing ever reaches.
 *
 * The largest class of fault this codebase has produced, and the one a passing suite is blindest
 * to. On 13 September 2026, with 2,611 tests green: an entire injury system — a villager laid up
 * for days, not working, costing the doctor's fee — whose one door had **no caller anywhere**; a
 * mountain radius that took its fallback every time, so no eagle in the game ever had a crag to
 * perch on; a pub landlord looked up by a key that never matched indoors. Each was written,
 * documented, tested, and unreachable, and nothing failed.
 *
 * A test cannot notice that something never happens. This can, because it asks a different question
 * — not "is this right" but "does anybody call it" — and that question is mechanical.
 *
 * ## Why it reads the source
 *
 * There is no runtime moment at which "nothing calls this" is observable. It is a fact about the
 * whole program, so it is answered by reading the whole program, the way `chunkpump.test.ts` reads
 * an ordering and `onepurse.test.ts` reads where an assignment lives.
 *
 * ## What counts as reached
 *
 * Named anywhere outside its own file and outside a test. A function only its own tests call is
 * exactly the shape this is looking for: something with a guard on it and nothing behind it.
 */

const ROOTS = ['src', 'server'];
const REPORT = 'unreached-report.txt';

/** Every source file, and separately every test, because being called by a test is not being used. */
function files(): { source: Map<string, string>; tests: string[] } {
  const source = new Map<string, string>();
  const tests: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'dist') walk(path); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.includes('.test.') || entry.name.includes('.bench.')) tests.push(path);
      else source.set(path, readFileSync(path, 'utf8'));
    }
  };
  for (const root of ROOTS) walk(root);
  return { source, tests };
}

/** What a file offers the rest of the program, by name. */
function exportsOf(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/^export (?:async )?function (\w+)/gm)) names.push(m[1]);
  for (const m of text.matchAll(/^export class (\w+)/gm)) names.push(m[1]);
  for (const m of text.matchAll(/^export const (\w+)\s*[:=]/gm)) names.push(m[1]);
  return names;
}

/** Explanation keys whose exported declaration no longer exists. */
function staleExplanations(source: ReadonlyMap<string, string>, explanations: ReadonlyMap<string, string>): string[] {
  const offered = new Set<string>();
  for (const [path, text] of source) {
    for (const name of exportsOf(text)) offered.add(`${path}: ${name}`);
  }
  return [...explanations.keys()].filter((one) => !offered.has(one));
}
/**
 * What was already like this when the bench was written, and the reason it is a number.
 *
 * A hundred and ninety-eight names are reached by their own tests and by nothing else. That is not
 * a hundred and ninety-eight bugs — some are constants a test imports to check a table against, and
 * that is a mild smell at worst. But some are the other thing: a whole feature with a guard on it
 * and nothing behind it, which is how an entire injury system sat in this repository unreachable
 * while its tests passed.
 *
 * Triaging that is real work and it is on the list. What must not happen meanwhile is the number
 * going *up* — so the bench is a ratchet rather than a gate. It fails when something new becomes
 * unreachable, which is the moment the cause is still obvious and somebody still remembers why.
 *
 * Lower it when you triage. Never raise it.
 */
const ALREADY_LIKE_THIS = 36;
const ALREADY_UNEXPLAINED = 0;

/*
 * It said 198 on its first run and 43 on its second, and the difference was all instrument.
 *
 * The first version asked "is this name in any *other* file", which counts an internal helper as
 * unreached even when the public function two lines below it calls it and the whole world calls
 * that. A hundred and fifty-five of the first count were that — noise, and enough of it to teach
 * somebody to stop reading the report, which is the way an instrument like this really dies.
 *
 * Caught by using it: `untilDawn` was wired into a warning and the bench went on listing it. A
 * suite that survives its own first finding is worth more than one that was right to begin with.
 */

describe('work that nothing reaches', () => {
  it('does not let any more work fall out of the program', () => {
    const { source, tests } = files();
    const elsewhere = new Map<string, string>();
    for (const [path, text] of source) elsewhere.set(path, text);

    const orphans: string[] = [];
    for (const [path, text] of source) {
      for (const name of exportsOf(text)) {
        // a name mentioned in any other source file is reached, whatever it is doing there
        let seen = false;
        for (const [other, body] of elsewhere) {
          if (other === path) continue;
          if (new RegExp(`\\b${name}\\b`).test(body)) { seen = true; break; }
        }
        if (seen) continue;
        /*
         * Used inside its own file is used.
         *
         * The first version missed this and said `untilDawn` was unreached the moment it had been
         * wired — because what wired it was `warningFor`, two functions down in the same file, and
         * `warningFor` is what `watch.ts` calls. An internal helper behind a public one is reached;
         * it is only the *export* that is unnecessary, which is a tidiness question rather than the
         * one this is asking.
         *
         * So: named anywhere in its own file beyond its own declaration counts. What is left is the
         * thing worth finding — a name nothing anywhere calls, kept alive by its tests.
         */
        const here = text.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
        if (here > 1) continue;
        // not reached by the program. Is it reached by a test? That is the shape we are hunting:
        // something with assertions on it and nothing behind it
        const tested = tests.some((t) => new RegExp(`\\b${name}\\b`).test(readFileSync(t, 'utf8')));
        if (tested) orphans.push(`${path}: ${name}`);
      }
    }
    orphans.sort();
    const stale = staleExplanations(source, EXCUSED);
    const unexplained = orphans.filter((one) => !EXCUSED.has(one));
    const explained = orphans.filter((one) => EXCUSED.has(one));
    writeFileSync(REPORT, [
      `UNREACHED — ${orphans.length} exported names reached only by their own tests`,
      `UNEXPLAINED — ${unexplained.length} have no recorded reason`,
      '',
      '  A reviewed test-owned invariant or a named blocking issue can explain an export. Everything',
      '  else stays in the first list until somebody traces, removes, or wires it.',
      '',
      'UNEXPLAINED',
      ...(unexplained.length ? unexplained.map((one) => `  ${one}`) : ['  (none)']),
      '',
      'EXPLAINED',
      ...(explained.length
        ? explained.map((one) => `  ${one} — ${EXCUSED.get(one)}`)
        : ['  (none)']),
      '',
      `  Written by src/world/reachable.test.ts to ${REPORT}. Run it again with: chore reachable`,
      '',
    ].join('\n'));

    expect(stale, 'explanations for removed exports must be removed').toEqual([]);
    /*
     * An excuse is cheaper to write than a fix, so it has to be in a form somebody can check: the
     * test that owns the export, or the issue its caller waits on. "This one is fine" is an
     * opinion, and an opinion is what this list must never fill up with. The other half — an
     * excuse whose issue has since closed — needs the network and lives in `tools/staleexcuses.ts`.
     */
    expect([...EXCUSED].filter(([, why]) => !isCheckable(why)).map(([name]) => name),
      'an excuse must name a test or an issue').toEqual([]);
    // Two ratchets: no new orphan at all, and no new orphan without an explicit reason.
    expect(orphans.length, `work fell out of the program — see ${REPORT}`)
      .toBeLessThanOrEqual(ALREADY_LIKE_THIS);
    expect(unexplained.length, `unexplained work fell out of the program — see ${REPORT}`)
      .toBeLessThanOrEqual(ALREADY_UNEXPLAINED);
  });

  it('retires explanations from declarations, not textual reachability guesses', () => {
    const source = new Map([
      ['src/a.ts', 'export const RECIPE = 1;'],
      ['src/b.ts', '// RECIPE is deliberately only mentioned in prose'],
    ]);
    const explanations = new Map([['src/a.ts: RECIPE', 'test-owned invariant']]);

    expect(staleExplanations(source, explanations)).toEqual([]);
    source.set('src/a.ts', 'const RECIPE = 1;');
    expect(staleExplanations(source, explanations)).toEqual(['src/a.ts: RECIPE']);
  });
});
