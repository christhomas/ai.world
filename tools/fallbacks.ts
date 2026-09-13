import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

/**
 * Which way every fallback in the world actually goes.
 *
 * A default that is taken *every* time it is reached is not a default. It is a feature that is not
 * happening, and it is invisible: the code reads as though it handles two cases, the tests pass,
 * and the thing simply never occurs. Four of the worst faults found on the night of 12–13 September
 * 2026 were that exact shape, and none of them was visible to two and a half thousand passing
 * tests — a mesh-face fallback that meant no mountain in the game had a size, a `today` standing in
 * for the day being lived, a field set to something other than what its own comment said it meant,
 * and a wound system with no caller at all.
 *
 * **Reading them finds nothing.** There are nearly three hundred `??` in this codebase and the
 * dangerous ones look exactly like the safe ones — `map.get(id) ?? 0` while building a fresh map is
 * correct and always takes the default; `person.hurt ?? 0` is a bug and always takes the default.
 * What tells them apart is not the shape, it is what the codebase *is for*, and no amount of
 * squinting gets you there.
 *
 * **Counting them finds everything.** So this rewrites
 *
 *     somebody.hurt ?? 0
 *
 * as
 *
 *     sawAValue(41, somebody.hurt) ?? usedTheDefault(41, 0)
 *
 * runs whatever you point it at, and reports the sites where the two counts are equal — every visit
 * took the default, so the left-hand side never once had anything in it. `??` only evaluates its
 * right side when the left is nullish, so the two counters are exactly "how often we came here" and
 * "how often there was nothing here", which is the whole question.
 *
 * ## It edits your files and puts them back
 *
 * There is no way to do this without touching the source: the counters have to be *in* the
 * expressions. So it refuses to start on a dirty tree — it has to be able to `git checkout` its way
 * home — and it restores every file it wrote before it prints anything, including when the run
 * throws. Nothing it writes is ever meant to be committed, and `chore fallbacks` is the only thing
 * that should ever write it.
 *
 *     chore fallbacks                      # the whole suite, which is the widest net there is
 *     chore fallbacks -- src/world         # or narrow it to whatever you are chasing
 */

/** Where the counters live while a sweep is running. Deleted with everything else afterwards. */
const COUNTER_MODULE = 'src/core/fallbacksweep.ts';

/** What the sweep rewrites. Test and bench files are left alone: their defaults are scaffolding. */
const ROOTS = ['src/world', 'src/game', 'src/entities', 'src/render', 'src/ui', 'server'];

/**
 * The left-hand side of a `??`, as far as this is willing to recognise one.
 *
 * A name, then any run of property accesses, calls and subscripts — `village.holdings`,
 * `this.killed.get(id)`, `rows[at].purse`. Deliberately not a full expression parser: anything with
 * an operator in it is skipped rather than guessed at, because a codemod that rewrites what it does
 * not understand is a codemod that breaks a build at four in the morning.
 */
const LEFT = String.raw`[A-Za-z_$][\w$]*(?:\??\.[\w$]+|\([^()]*\)|\[[^\[\]]*\])*`;

/**
 * And the right-hand side: only the simple constants.
 *
 * An object or array literal is excluded on purpose — passing `{}` through a generic function loses
 * the inference that `?? {}` keeps, and the build stops. They are also the least interesting: an
 * empty list usually means "nothing yet" rather than "this never arrived".
 */
const RIGHT = String.raw`(?:0|1|-1|''|Infinity|null|true|false|[A-Z][A-Z_0-9]+|[A-Z][A-Za-z0-9]*\.[A-Za-z_0-9]+)`;

const FALLBACK = new RegExp(String.raw`(?<![\w.$])(${LEFT})\s*\?\?\s*(${RIGHT})(?![\w.$])`, 'g');

interface Site { file: string; line: number; source: string }

function everyFileUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'dist' && name !== 'node_modules') walk(path); continue; }
      if (!name.endsWith('.ts') || name.includes('.test.') || name.includes('.bench.')) continue;
      out.push(path);
    }
  };
  walk(root);
  return out;
}

/** Rewrite every fallback this understands, and hand back what was rewritten where. */
function instrument(): { sites: Site[]; touched: string[] } {
  const sites: Site[] = [];
  const touched: string[] = [];

  for (const root of ROOTS) {
    for (const file of everyFileUnder(root)) {
      const text = readFileSync(file, 'utf8');
      let out = '', last = 0, found = 0;
      for (const match of text.matchAll(FALLBACK)) {
        const at = match.index;
        sites.push({ file, line: text.slice(0, at).split('\n').length, source: match[0].trim() });
        out += text.slice(last, at);
        out += `sawAValue(${sites.length - 1}, ${match[1]}) ?? usedTheDefault(${sites.length - 1}, ${match[2]})`;
        last = at + match[0].length;
        found++;
      }
      if (found === 0) continue;
      out += text.slice(last);
      const up = '../'.repeat(file.split(sep).length - 1);
      writeFileSync(file, `import { sawAValue, usedTheDefault } from '${up}${COUNTER_MODULE.replace(/\.ts$/, '')}';\n${out}`);
      touched.push(file);
    }
  }

  writeFileSync(COUNTER_MODULE, [
    '/* Written by `chore fallbacks` and deleted again by it. Never commit this file. */',
    '',
    '/*',
    ' * The tallies hang off `globalThis` rather than off this module, and that is not laziness.',
    ' *',
    ' * A hundred files import this, and they reach it by whatever relative path they happen to sit',
    ' * at — `../core/...` from one directory, `../../src/core/...` from another. Those are the same',
    ' * file and can still be two module instances, and then every count is split between them and',
    ' * the whole sweep reads as though nothing ever ran. One object, found by name, cannot split.',
    ' */',
    'interface Tally { visits: number[]; defaults: number[] }',
    'const tally: Tally = ((globalThis as { __sweep?: Tally }).__sweep ??= { visits: [], defaults: [] });',
    '',
    '/** We reached this fallback, and here is what the left-hand side had in it. */',
    'export function sawAValue<T>(site: number, value: T): T {',
    '  tally.visits[site] = (tally.visits[site] || 0) + 1;',
    '  return value;',
    '}',
    '',
    '/** The left-hand side had nothing, so the default is what the expression came to. */',
    'export function usedTheDefault<T>(site: number, value: T): T {',
    '  tally.defaults[site] = (tally.defaults[site] || 0) + 1;',
    '  return value;',
    '}',
    '',
    'export function sweepSoFar(): Tally { return tally; }',
    '',
  ].join('\n'));

  return { sites, touched };
}

function report(sites: Site[], visits: number[], defaults: number[]): void {
  const rows = sites.map((site, at) => ({
    site, visits: visits[at] ?? 0, defaults: defaults[at] ?? 0,
  })).filter((row) => row.visits > 0);

  const always = rows.filter((row) => row.defaults === row.visits).sort((a, b) => b.visits - a.visits);
  const never = rows.filter((row) => row.defaults === 0);

  console.log(`${sites.length} fallbacks in the source, ${rows.length} of them reached by this run.`);
  console.log(`  ${always.length} took the default every single time — the list below.`);
  console.log(`  ${never.length} never took it at all, and ${rows.length - always.length - never.length} took it sometimes.`);
  console.log('');
  console.log('A default that is the only value a thing ever has is a feature that is not happening.');
  console.log('An accumulator — `map.get(id) ?? 0` while a fresh map is filled — is the honest kind.');
  console.log('');
  /*
   * Sorted by how often, and the count is most of the finding.
   *
   * "Always" is only worth anything against a big, representative sample. `person.hurt ?? 0` taking
   * the nought 877,875 times over four hundred and fifty simulated days says the wound system has
   * no caller, and it did. `victim.kind.damage ?? 0` taking it three times says the three creatures
   * a unit test happened to hit were not predators — wolves declare a damage of ten and bears
   * thirty, and the field is fine. Both look identical in a list sorted any other way, which is how
   * a sweep like this talks somebody into a bug that is not there.
   *
   * So read from the top, and treat anything under the line as a question rather than an answer.
   */
  const TELLING = 1000;
  for (const row of always) {
    const mark = row.visits >= TELLING ? '  ' : '? ';
    console.log(`${mark}${String(row.visits).padStart(9)}x  ${relative('.', row.site.file)}:${row.site.line}  ${row.site.source}`);
  }
  if (always.length === 0) console.log('  (nothing: every fallback this run reached had a real value at least once)');
  console.log('');
  console.log(`Rows marked ? were reached fewer than ${TELLING} times: too thin a sample to mean anything on`);
  console.log('their own. Widen the run before believing one, or go and read what feeds that value.');
}

/**
 * Put every file back, and take the generated ones away.
 *
 * Its own function because `finally` is not the only way out of this program. A `finally` unwinds
 * an exception and does not run for a signal: `timeout 110 chore fallbacks` sent SIGTERM, node
 * stopped where it stood, and the checkout was left with **99 files rewritten** — all of which
 * typecheck and pass, so nothing downstream objects and somebody commits an instrumented tree.
 *
 * Safe to call twice: `git checkout` on an unmodified path does nothing and `rmSync` is told the
 * files may already be gone.
 */
function putItBack(): void {
  execFileSync('git', ['checkout', '--', 'src', 'server']);
  rmSync(COUNTER_MODULE, { force: true });
  rmSync('src/world/fallbacksweep.test.ts', { force: true });
}

/**
 * And the same on the way out that a `finally` cannot reach.
 *
 * Ctrl-C and a timeout are the two ordinary ways a long sweep ends early, and both of them kill
 * node without unwinding. A tool that edits every file in a repository has to put them back
 * however it exits, not only when it is allowed to finish.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    console.error(`\n${signal} — putting every file back before going`);
    try { putItBack(); } catch { /* nothing left to do about it, and saying so is the point */ }
    process.exit(130);
  });
}

/**
 * Is this mess ours? Asked before refusing to start, so a killed run heals itself.
 *
 * The signal handlers above cannot be relied on and it is worth writing down why rather than
 * hoping: `timeout` and a shell's Ctrl-C signal the whole **process group**, so node is killed at
 * the same moment as the `git checkout` it would spawn to clean up. A handler that has to start a
 * child process cannot be trusted to survive the thing that triggered it.
 *
 * So the honest recovery is on the way in rather than on the way out. An instrumented tree is
 * recognisable — every rewritten file imports `fallbacksweep`, and nothing else in this repository
 * ever would — so a run that finds one knows it is looking at the wreck of an earlier run and not
 * at somebody's work. That is the whole test: it must never mistake real edits for its own.
 */
function ourOwnWreck(dirty: string): boolean {
  // the last field, not `slice(3)`: a porcelain line's status column is one or two characters and
  // the padding varies, so a fixed offset eats the first letter of some paths and not others
  const files = dirty.split('\n').map((line) => line.trim().split(/\s+/).pop() ?? '').filter(Boolean);
  if (files.length === 0) return false;
  // every single one, not most: one file of somebody's real work in the list and this is their tree
  return files.every((file) => {
    try {
      // the depth of the relative path varies — `../../src/core/...` from `src/world`, `../src/…`
      // from `server` — so match the module rather than one spelling of the way to it
      return readFileSync(file, 'utf8').includes('core/fallbacksweep')
        || file.endsWith('fallbacksweep.ts') || file.endsWith('fallbacksweep.test.ts');
    } catch {
      return false;
    }
  });
}

function main(): void {
  let dirty = execFileSync('git', ['status', '--porcelain', 'src', 'server'], { encoding: 'utf8' }).trim();
  if (dirty && ourOwnWreck(dirty)) {
    console.error('an earlier run was killed before it could put things back — undoing that first\n');
    putItBack();
    dirty = execFileSync('git', ['status', '--porcelain', 'src', 'server'], { encoding: 'utf8' }).trim();
  }
  if (dirty) {
    console.error('This rewrites your source and puts it back with `git checkout`, so it will not');
    console.error('start on a dirty tree — it could not tell its own edits from yours. Commit or');
    console.error('stash first. Uncommitted:\n' + dirty);
    process.exitCode = 1;
    return;
  }

  /*
   * The whole suite by default, because coverage is the entire point.
   *
   * A fallback this run never reaches tells you nothing at all, and the suite is the widest net
   * there is without driving a browser. Narrow it by naming files when you are chasing something
   * particular: `chore fallbacks -- src/world`.
   */
  const target = process.argv.slice(2);
  const scratch = mkdtempSync(join(tmpdir(), 'fallbacks-'));
  const out = join(scratch, 'counts.json');

  const { sites, touched } = instrument();
  console.log(`instrumented ${sites.length} fallbacks in ${touched.length} files; running ${target.join(' ') || 'the whole suite'}`);
  console.log(`  e.g. ${touched[0]} now starts: ${readFileSync(touched[0], 'utf8').split('\n')[0]}`);

  /*
   * The file that writes the counts out, which has to be a test because that is the only thing
   * vitest will run — and has to contain a test, because a file with only an `afterAll` in it is a
   * suite with nothing in it and vitest fails the run rather than shrugging.
   */
  writeFileSync('src/world/fallbacksweep.test.ts', [
    "import { afterAll, it } from 'vitest';",
    "import { writeFileSync } from 'node:fs';",
    "import { sweepSoFar } from '../core/fallbacksweep';",
    '',
    '/* Written by `chore fallbacks`: dumps the counts when the run is over. */',
    `afterAll(() => { writeFileSync(${JSON.stringify(out)}, JSON.stringify(sweepSoFar())); });`,
    "it('is here so the sweep has somewhere to hang its afterAll', () => {});",
    '',
  ].join('\n'));

  try {
    /*
     * One worker, no isolation, so every file shares the counters.
     *
     * Vitest runs files in parallel workers by default and each would get its own copy of the
     * module — every count divided between however many threads the machine felt like, and the
     * "always" test meaningless. These two flags are the whole reason the sweep can span more than
     * one test file.
     */
    execFileSync('pnpm', ['exec', 'vitest', 'run', '--no-isolate', '--no-file-parallelism',
      ...target], { stdio: 'inherit' });
  } catch {
    console.error('\nthe run failed; reporting on whatever it managed before it stopped');
  } finally {
    // home again before anything is printed, whatever happened, so a failed sweep still leaves a
    // tree somebody can work in
    putItBack();
  }

  try {
    const counts = JSON.parse(readFileSync(out, 'utf8')) as { visits: number[]; defaults: number[] };
    console.log('');
    report(sites, counts.visits, counts.defaults);
  } catch {
    console.error('the run left no counts behind, so there is nothing to report');
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
