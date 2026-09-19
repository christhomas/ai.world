import { reportAt } from '../../tools/reports';
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
 *
 * ## And two kinds of unreached, since #372
 *
 * For six months this counted only the first kind — reached by its own tests and nothing else —
 * and a name reached by *nothing whatever* scored nought, because the last question asked before
 * anything was written down was "does a test mention this?" and a name nothing mentions answers
 * no. So the worse fault was the invisible one, and a ratchet at fifteen reported health it had
 * never measured. `holdings.ts: workedBy` lived there for a month; `heroholdings.test.ts` wanted
 * exactly that filter, wrote its own copy, and said in a comment that importing the real one was
 * the only thing that would make this file notice. The bench was teaching people to duplicate
 * code to keep it quiet.
 */

const ROOTS = ['src', 'server'];
const REPORT = reportAt('unreached-report.txt');

/** Every source file, and separately every test, because being called by a test is not being used. */
function files(): { source: Map<string, string>; tests: Map<string, string> } {
  const source = new Map<string, string>();
  const tests = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'dist') walk(path); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const into = entry.name.includes('.test.') || entry.name.includes('.bench.') ? tests : source;
      into.set(path, readFileSync(path, 'utf8'));
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
 * Excuses for work the program now reaches, which are the other half of the same bookkeeping.
 *
 * `staleExplanations` catches the deletion: an excuse whose export is gone. This catches the
 * success — an excuse whose export somebody has since *wired*. Both leave a line in this list
 * saying something untrue, and the second is worse than the first, because the first is somebody
 * tidying up and the second is somebody having finished the job the excuse was promising.
 *
 * It is not a theoretical shape. #119 landed four themes with nothing applying any of them, and
 * both `themeChosen` and `wearTheme` were excused against an issue for the missing picker. #188
 * built the picker and wired both — and the excuses stayed, one of them still naming #177, the
 * very issue the picker closed. `chore excuses` fails on an excuse whose issue has closed, so the
 * leftover would have turned finishing the work into a red build. See #177.
 */
function excusesNowReached(
  found: Unreached, source: ReadonlyMap<string, string>, explanations: ReadonlyMap<string, string>,
): string[] {
  // both lists, because an export named nowhere at all is the worse half of unreached and not the
  // reached half — see the test below, and #372, which is where this was a bug
  const unreached = new Set([...found.orphans, ...found.never]);
  const gone = new Set(staleExplanations(source, explanations));
  return [...explanations.keys()].filter((one) => !unreached.has(one) && !gone.has(one));
}

/**
 * What nothing reaches, in the two kinds it comes in.
 *
 * The split is the whole of #372. `orphans` is the original measure — reached by its own tests and
 * by nothing else, which is a feature with a guard on it and nothing behind it. `never` is the
 * harder case and the one this file could not see for six months: an export named **nowhere
 * whatever**, not by the program, not by its own file, not by a single test.
 *
 * That is strictly worse than an orphan and it scored zero, because the last question the census
 * asked before writing anything down was *"does a test mention this?"* and a name nothing mentions
 * answers no. So it fell out of the loop and the total did not move. A ratchet that cannot count
 * the worst case it was built for is a ratchet reporting health it has not measured.
 *
 * It is not a hypothetical shape either. `workedBy` in `holdings.ts` was exactly this, and
 * `heroholdings.test.ts` wrote its own copy of the filter rather than importing it, with a comment
 * saying in as many words that naming the export from a test was what would have made this bench
 * notice it. The cheapest way to stay green was to leave the dead export alone and duplicate it.
 */
interface Unreached {
  /** Named by a test and by nothing else: work with assertions on it and no caller. */
  orphans: string[];
  /** Named by nothing anywhere: work with neither. */
  never: string[];
}

/**
 * The census, over whatever tree it is handed.
 *
 * Taking the files as arguments rather than reading the disk is what lets the cases below be built
 * out of four strings. A bench whose only input is the whole repository can only be checked by
 * changing the repository, which means its own faults are found the way this one was — by reading
 * it, a long time later.
 */
function unreachedIn(source: ReadonlyMap<string, string>, tests: ReadonlyMap<string, string>): Unreached {
  const found: Unreached = { orphans: [], never: [] };
  for (const [path, text] of source) {
    for (const name of exportsOf(text)) {
      // a name mentioned in any other source file is reached, whatever it is doing there
      let seen = false;
      for (const [other, body] of source) {
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
       * thing worth finding — a name nothing anywhere calls.
       */
      const here = text.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
      if (here > 1) continue;
      // not reached by the program. Is it reached by a test? That decides which list it lands in,
      // and until #372 it decided whether it was written down at all
      const tested = [...tests.values()].some((body) => new RegExp(`\\b${name}\\b`).test(body));
      (tested ? found.orphans : found.never).push(`${path}: ${name}`);
    }
  }
  found.orphans.sort();
  found.never.sort();
  return found;
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
 *
 * Fifteen rather than fourteen, and this is the one direction the line above forbids, so it is
 * argued rather than nudged. Retiring the bounded world takes the last runtime caller of
 * `polygons.ts: indexFaces` with it: `roadweb.test.fixture.ts` still builds a FaceIndex, because
 * the suite holds decades of assertions about a country with a middle and those are worth
 * keeping. So the export is genuinely test-owned now, and it is excused by name in
 * `tools/excused.ts` rather than waved through — `ALREADY_UNEXPLAINED` stays at nought.
 *
 * The stack this arrives on stood at twenty-one. Landing it leaves fifteen, so the number a
 * reader should compare against is that one: this is six fewer orphans, not one more.
 */
const ALREADY_LIKE_THIS = 15;
const ALREADY_UNEXPLAINED = 0;

/**
 * And what turned out to be worse than that, the first time anybody counted it.
 *
 * #372 opened the census up to exports named *nowhere whatever*, and nine came out. Not nine
 * tidiness questions. One of them is what a built field yields the man who farms it, and nothing
 * in the game asks it — which is the injury system again with a different hat on. Each of the nine
 * is the only occurrence of its own name anywhere in the repository, tests included.
 *
 * **They are not listed here, and that is not squeamishness.** This file is a test, and the census
 * counts a name mentioned in any test as reached-by-a-test — so writing the nine down in this
 * comment moved all nine out of this list and into the one above it, and the run said twenty-four
 * where the tree had not changed at all. That is the same edge `heroholdings.test.ts` was dodging
 * when it open-coded a filter rather than name `workedBy`, met from the other side. The report
 * names them, because the report is not read by the bench; #380 argues them one at a time.
 *
 * It is nought, and it took one afternoon rather than the one the note here used to defer.
 *
 * It stood at nine when the instrument was built — deliberately, because settling nine exports
 * inside the change that made them countable would have buried the change that made them
 * countable. #380 then gave each of the nine its own answer. Eight were leftovers and were
 * deleted, every one checked with `git log -S` first: each returned exactly one commit, the one
 * that wrote it, so none had ever had a caller and lost it. The ninth was not a leftover at all —
 * `fields.ts`'s reader for what a sown field yields the man who farms it, written, documented, and
 * called by nothing, while a village paid its farmers off a second expression of the same number.
 * Wiring it closed a fault in the dinner money (#384).
 *
 * `workedBy` was the tenth, and went in the change that made this countable, because a bench that
 * reports a fault is worth less than one that reports a fault and has had it fixed once.
 *
 * **These cannot be excused.** An excuse names the test that owns an export or the issue its
 * caller waits on, and a name nothing mentions has no test to name — so `tools/excused.ts` has no
 * honest form of words for one of these, and there is deliberately no second list here in which to
 * park them. Nought is now the only number that is not slack: the next export nothing mentions is
 * red on the commit that adds it, which is the whole of what this was built for. Never raise it.
 */
const NAMED_NOWHERE_ALREADY = 0;

/*
 * Where the reviewed exceptions live, and why they are not written down here.
 *
 * `tools/excused.ts` holds them, and the reason is the bench's own rule: it decides "reached" by
 * looking for a name anywhere under `src` and `server` outside its own file. Every excuse contains
 * the name it excuses, so a list of them under `src` makes all of them look reached and the bench
 * reports almost nothing. It did, for about a minute, which is why #137 moved the list out.
 *
 * The list went back into this file when #134 landed — that branch was cut before #137 and the
 * squash took its whole copy of this file, import and all. Nothing failed, because a second list
 * that nobody updates simply agrees with itself: `chore excuses` went on watching `tools/excused.ts`
 * while the bench read a copy that had drifted twenty entries away from it. See #177.
 */
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
    const { orphans, never } = unreachedIn(source, tests);
    const stale = staleExplanations(source, EXCUSED);
    const wired = excusesNowReached({ orphans, never }, source, EXCUSED);
    const unexplained = orphans.filter((one) => !EXCUSED.has(one));
    const explained = orphans.filter((one) => EXCUSED.has(one));
    writeFileSync(REPORT, [
      `UNREACHED — ${orphans.length} exported names reached only by their own tests`,
      `UNEXPLAINED — ${unexplained.length} have no recorded reason`,
      `NAMED NOWHERE — ${never.length} exported names nothing mentions at all, tests included`,
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
      'NAMED NOWHERE',
      '',
      '  Neither a caller nor a test. Not excusable: there is no suite to name and nothing to',
      '  defer to, so each line is a caller to find or a deletion to make. See #380.',
      '',
      ...(never.length ? never.map((one) => `  ${one}`) : ['  (none)']),
      '',
      `  Written by src/world/reachable.test.ts to ${REPORT}. Run it again with: chore reachable`,
      '',
    ].join('\n'));

    expect(stale, 'explanations for removed exports must be removed').toEqual([]);
    expect(wired, 'an excuse for work the program now reaches must be removed, not left behind').toEqual([]);
    // an excuse that names neither a test nor an issue is an opinion, and this list must not fill
    // up with those. `tools/excused.ts` says what counts as naming one.
    expect([...EXCUSED].filter(([, why]) => !isCheckable(why)).map(([name]) => name),
      'every excuse must name the test that owns the export or the issue blocking its caller').toEqual([]);
    // Two ratchets: no new orphan at all, and no new orphan without an explicit reason.
    expect(orphans.length, `work fell out of the program — see ${REPORT}`)
      .toBeLessThanOrEqual(ALREADY_LIKE_THIS);
    expect(unexplained.length, `unexplained work fell out of the program — see ${REPORT}`)
      .toBeLessThanOrEqual(ALREADY_UNEXPLAINED);
    // and the third, which is the one this bench could not count until #372
    expect(never.length, `work nothing names at all fell out of the program — see ${REPORT}`)
      .toBeLessThanOrEqual(NAMED_NOWHERE_ALREADY);
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

  /*
   * The blindness this bench had until #372, written as the case that could not fail before.
   *
   * `GHOST` is exported, named nowhere else under `src`, named nowhere in its own file beyond its
   * declaration, and named by no test. It is the *strongest* form of the fault this file exists to
   * find — not "only its tests call it" but "nothing calls it" — and the first version of the loop
   * dropped it on the floor, because the last thing it asked before recording anything was whether
   * a test mentioned the name. No test, no entry. So the count went to nought and the ratchet read
   * that as health.
   *
   * `workedBy` sat in `holdings.ts` like this for a month, and `heroholdings.test.ts` open-coded a
   * copy of it rather than importing it, precisely so that the bench would go on not seeing it.
   */
  it('sees an export that nothing names at all, which counting test-owned work cannot', () => {
    const source = new Map([
      ['src/a.ts', 'export function ghost(): number { return 1; }'],
      ['src/b.ts', 'export function seen(): number { return 2; }'],
      ['src/c.ts', 'import { seen } from \'./b\';\nseen();'],
    ]);
    const tests = new Map([['src/b.test.ts', 'import { seen } from \'./b\'; seen();']]);

    const found = unreachedIn(source, tests);
    // `seen` is called by a test *and* by c.ts, so it is reached and is neither sort of orphan
    expect(found.orphans, 'a name only its own test reaches').toEqual([]);
    expect(found.never, 'a name nothing reaches at all').toEqual(['src/a.ts: ghost']);

    // and the moment a test touches it, it becomes the weaker fault rather than disappearing
    tests.set('src/a.test.ts', 'import { ghost } from \'./a\'; ghost();');
    const now = unreachedIn(source, tests);
    expect(now.never, 'a tested orphan must not be counted twice').toEqual([]);
    expect(now.orphans).toEqual(['src/a.ts: ghost']);
  });

  it('retires an excuse when the export it excuses is finally wired', () => {
    const source = new Map([['src/a.ts', 'export const RECIPE = 1;']]);
    const explanations = new Map([['src/a.ts: RECIPE', 'test-owned invariant']]);
    const tested = (orphans: string[]) => ({ orphans, never: [] });

    // still unreached: the excuse is doing its job and stays
    expect(excusesNowReached(tested(['src/a.ts: RECIPE']), source, explanations)).toEqual([]);
    // somebody wired it, so it drops off the orphan list — and the excuse must go with it
    expect(excusesNowReached(tested([]), source, explanations)).toEqual(['src/a.ts: RECIPE']);
    // and a deletion is the *other* complaint: `staleExplanations` owns that one, and saying it
    // twice would report one line as two faults with two different fixes
    source.set('src/a.ts', 'const RECIPE = 1;');
    expect(excusesNowReached(tested([]), source, explanations)).toEqual([]);
  });

  /*
   * And the hole #372 opened in that check, which is the same blindness wearing the other hat.
   *
   * "Reached" was decided by absence from the *tested* orphan list, and losing your last test is
   * one of the ways to fall off that list. So deleting the suite that owned `RECIPE` read here as
   * somebody having wired it: the excuse would have been reported as finished and deleted, while
   * what had actually happened is that the export went from reached-by-a-test to reached-by
   * nothing at all. The excuse gone, the caller still missing, and now invisible on both counts.
   *
   * Which is why this takes both lists rather than one. An export named nowhere whatever is the
   * *worse* half of unreached, not the reached half.
   */
  it('does not call an excuse finished when its export lost its last test instead', () => {
    const source = new Map([['src/a.ts', 'export const RECIPE = 1;']]);
    const explanations = new Map([['src/a.ts: RECIPE', 'brewing tests verify the recipe table']]);

    expect(excusesNowReached({ orphans: [], never: ['src/a.ts: RECIPE'] }, source, explanations),
      'an export nothing names at all has not had its excuse earned out').toEqual([]);
  });
});
