import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { theTidyUp, whatIsDirty } from './fallbackguard';
import { instrumentDefaultParameters } from './defaultparams';
import { counterConfigSource, counterModuleSource, counterSetupSource } from './fallbackcounts';

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
 *     chore fallbacks --parameters         # exported parameter defaults, still evaluated at call time
 *     chore fallbacks --parameters -- src/world
 *     chore fallbacks -- --browser            # the render/UI walk from tools/shots.cjs
 *     chore fallbacks -- --browser town map interior
 */

/** Where the counters live while a sweep is running. Deleted with everything else afterwards. */
const COUNTER_SETUP = 'src/core/fallbacksweep.setup.ts';
const COUNTER_MODULE = 'src/core/fallbacksweep.ts';

/**
 * The note a running sweep leaves in the checkout, so the next one knows whose mess it is.
 *
 * This is what makes the recovery safe to do at all. It is written *after* the tree has been found
 * clean and *before* a single byte is rewritten, so its presence is not a guess about what the
 * files look like — it is a record that this program was mid-flight in a checkout that had nothing
 * of anybody's in it. Everything dirty under `src` and `server` after that is the sweep's own
 * writing, and `git checkout` on it cannot discard work that was never there.
 *
 * It replaces reading the files and deciding whether they look instrumented, which three separate
 * reviewers objected to for the same reason and all of them were right: a file of somebody's real
 * work that happens to mention this module would have been thrown away as wreckage.
 */
const IN_FLIGHT = '.fallbacks-in-flight';

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

  writeFileSync(COUNTER_MODULE, counterModuleSource('fallbacks'));

  return { sites, touched };
}
/** Rewrite exported default parameters while leaving their initializers at call time. */
function instrumentParameters(): { sites: Site[]; touched: string[] } {
  const sites: Site[] = [];
  const touched: string[] = [];
  for (const root of ROOTS) {
    for (const file of everyFileUnder(root)) {
      const text = readFileSync(file, 'utf8');
      const up = '../'.repeat(file.split(sep).length - 1);
      const transformed = instrumentDefaultParameters(
        text, file, sites.length, `${up}${COUNTER_MODULE.replace(/\.ts$/, '')}`,
      );
      if (transformed.sites.length === 0) continue;
      sites.push(...transformed.sites.map((site) => ({
        file: site.file, line: site.line,
        source: `${site.name}(${site.parameter} = ${site.source})`,
      })));
      writeFileSync(file, transformed.source);
      touched.push(file);
    }
  }
  writeFileSync(COUNTER_MODULE, counterModuleSource('parameters'));
  return { sites, touched };
}

function report(sites: Site[], visits: number[], defaults: number[], noun = 'fallbacks', browserWalk = false): void {
  const rows = sites.map((site, at) => ({
    site, visits: visits[at] ?? 0, defaults: defaults[at] ?? 0,
  })).filter((row) => row.visits > 0);

  const always = rows.filter((row) => row.defaults === row.visits).sort((a, b) => b.visits - a.visits);
  const never = rows.filter((row) => row.defaults === 0);

  console.log(`${sites.length} ${noun} in the source, ${rows.length} reached by this run.`);
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
  const TELLING = browserWalk ? 2 : 1000;
  for (const row of always) {
    const mark = row.visits >= TELLING ? '  ' : '? ';
    console.log(`${mark}${String(row.visits).padStart(9)}x  ${relative('.', row.site.file)}:${row.site.line}  ${row.site.source}`);
  }
  if (always.length === 0) console.log('  (nothing: every fallback this run reached had a real value at least once)');
  console.log('');
  if (browserWalk) {
    console.log(`Rows marked ? were reached once. Two evaluations is the repeat threshold for this walk:`);
    console.log('a once-per-session UI path still appears, while frame volume is not mistaken for wider coverage.');
  } else {
    console.log(`Rows marked ? were reached fewer than ${TELLING} times: too thin a sample to mean anything on`);
    console.log('their own. Widen the run before believing one, or go and read what feeds that value.');
  }
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
  rmSync(COUNTER_SETUP, { force: true });
  rmSync(IN_FLIGHT, { force: true });
}

/**
 * The signal handlers, and the window in which they are allowed to act.
 *
 * `theTidyUp` holds that window: nothing is put back until the sweep says it owns the tree, and
 * nothing is put back once it says it has finished. Outside those two moments a Ctrl-C leaves the
 * checkout exactly as it found it, which is the whole point — the handlers used to be installed as
 * the program loaded, so a Ctrl-C during the opening `git status`, on a tree full of somebody's
 * uncommitted work, ran `git checkout -- src server` over it.
 */
const tidy = theTidyUp(putItBack);

/**
 * And the same on the way out that a `finally` cannot reach.
 *
 * Ctrl-C and a timeout are the two ordinary ways a long sweep ends early, and both of them kill
 * node without unwinding. A tool that edits every file in a repository has to put them back
 * however it exits, not only when it is allowed to finish.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    try {
      // and it says so only when it actually did something, because "putting every file back" over
      // a tree this program never touched is a frightening thing to print and a worse thing to mean
      if (tidy.signalled()) console.error(`\n${signal} — putting every file back before going`);
    } catch { /* nothing left to do about it, and saying so is the point */ }
    process.exit(130);
  });
}

/**
 * What the working tree has in it that git did not put there, by whole path.
 *
 * `-z` rather than lines: git quotes a path with a space in it when it writes lines and does not
 * when it writes records, so the line form has to be un-quoted and getting that wrong turns a real
 * file into one that does not exist.
 */
function dirtyNow(): string[] {
  return whatIsDirty(execFileSync('git', ['status', '--porcelain', '-z', 'src', 'server'], { encoding: 'utf8' }));
}

function main(): void {
  /*
   * A sweep that was killed before it could put things back left a note saying so, and the note was
   * written on a tree that had already been found clean. So this is not a judgement about what the
   * files look like — it is the earlier run's own word that everything dirty below is its writing.
   */
  if (existsSync(IN_FLIGHT)) {
    console.error('an earlier run was killed before it could put things back — undoing that first\n');
    putItBack();
  }
  const dirty = dirtyNow();
  if (dirty.length > 0) {
    console.error('This rewrites your source and puts it back with `git checkout`, so it will not');
    console.error('start on a dirty tree — it could not tell its own edits from yours. Commit or');
    console.error('stash first. Uncommitted:\n  ' + dirty.join('\n  '));
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
  const parameters = process.argv.includes('--parameters');
  const browserWalk = process.argv.includes('--browser');
  if (parameters && browserWalk) {
    console.error('--parameters and --browser are separate sweeps; choose one');
    process.exitCode = 1;
    return;
  }
  const target = process.argv.slice(2).filter((arg) => arg !== '--parameters' && arg !== '--browser');
  const scratch = mkdtempSync(join(tmpdir(), 'fallbacks-'));
  const out = join(scratch, 'counts.json');
  const config = join(scratch, 'vitest.config.mts');

  // the note first, then the writing: a run killed between these two lines has changed nothing, and
  // a run killed after them is recognisable to the next one
  writeFileSync(IN_FLIGHT, `started ${new Date().toISOString()} by chore fallbacks\n`);
  tidy.own();
  const { sites, touched } = parameters ? instrumentParameters() : instrument();
  if (!browserWalk) {
    writeFileSync(COUNTER_SETUP, counterSetupSource(out));
    writeFileSync(config, counterConfigSource(resolve('vite.config.ts'), resolve(COUNTER_SETUP)));
  }
  const noun = parameters ? 'defaulted parameters' : 'fallbacks';
  const running = browserWalk ? `the browser walk${target.length ? ` (${target.join(', ')})` : ''}` : target.join(' ') || 'the whole suite';
  console.log(`instrumented ${sites.length} ${noun} in ${touched.length} files; running ${running}`);
  if (touched[0]) console.log(`  e.g. ${touched[0]} now starts: ${readFileSync(touched[0], 'utf8').split('\n')[0]}`);
  try {
    /*
     * One worker, no isolation, so every file shares the counters. The setup hook snapshots them
     * after every test file; whichever file finishes last therefore writes the complete tally.
     * Worker teardown does not run Node process-exit handlers, so relying on one final write loses
     * the entire report.
     *
     * Vitest runs files in parallel workers by default and each would get its own copy of the
     * module — every count divided between however many threads the machine felt like, and the
     * "always" test meaningless.
     */
    // Instrumentation necessarily adds an import and an exported counter module. The architecture
    // and reachability ratchets inspect that source shape, not runtime behavior, so a whole parameter
    // sweep excludes them rather than reporting two known self-inflicted failures.
    const exclusions = parameters && target.length === 0
      ? ['--exclude', 'src/architecture.test.ts', '--exclude', 'src/world/reachable.test.ts']
      : [];
    if (browserWalk) {
      const port = process.env.FALLBACK_PORT ?? String(20_000 + process.pid % 20_000);
      execFileSync(process.execPath, ['tools/shots.cjs', ...target], {
        stdio: 'inherit',
        env: { ...process.env, PORT: port, OUT: join(scratch, 'shots'), FALLBACK_COUNTS: out },
      });
    } else {
      execFileSync('pnpm', ['exec', 'vitest', 'run', '--config', config, '--no-isolate', '--no-file-parallelism',
        ...exclusions, ...target], { stdio: 'inherit' });
    }
  } catch {
    process.exitCode = 1;
    console.error('\nthe run failed; reporting on whatever it managed before it stopped');
  } finally {
    // home again before anything is printed, whatever happened, so a failed sweep still leaves a
    // tree somebody can work in — and the tree is somebody else's again the moment it is done
    putItBack();
    tidy.finished();
  }

  try {
    const counts = JSON.parse(readFileSync(out, 'utf8')) as { visits: number[]; defaults: number[] };
    console.log('');
    report(sites, counts.visits, counts.defaults, parameters ? 'defaulted parameters' : 'fallbacks', browserWalk);
  } catch {
    console.error('the run left no counts behind, so there is nothing to report');
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
