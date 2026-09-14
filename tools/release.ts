import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Cutting a release, which in this project is one act with four parts.
 *
 * A deployment is a commit somebody can point at. The chart's version, the game's version, the tag
 * and the image all name the same moment, or the history stops being a thing you can roll back to:
 * a chart pinning a version whose image was never built is a cluster that cannot start, and a tag
 * that does not match the chart is a rollback that silently installs something else.
 *
 * So they move together, here, in one command:
 *
 *   1. the chart's `version` and `appVersion`, and the pin in the HelmRelease
 *   2. the changelog entry, and the ten the README shows, written before anything is committed
 *   3. a commit on a release branch, a pull request, and a squash onto main
 *   4. a tag on what main actually became, which is what a rollback goes back to
 *   5. a GitHub release, which is what builds and publishes the image the chart names
 *   6. the version written onto every issue that shipped in it
 *
 * It refuses to start on a dirty tree or off main, and it runs the tests before it writes anything.
 * A release is the one moment where being slow is free and being wrong is expensive.
 *
 * ## Why it goes through a pull request now
 *
 * It pushed straight to main until `github-guard` was installed, and the guard refused it: a pull
 * request for every change, admins included, and linear history. The guard is right and this was
 * wrong. A release is the change most worth having a record of, and "the tool that makes releases
 * is the one thing allowed to write to main unobserved" is exactly the exception that makes a
 * protection worth nothing.
 *
 * It costs nothing, which is worth writing down before anybody is tempted to bypass it: the branch
 * requires no approving reviews and no status checks, so the request is opened and squashed in the
 * same breath. This is still one command. What changed is that every release leaves a reviewable
 * pull request behind it rather than an unexplained commit on main.
 */

const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: 'utf8' }).trim();

/**
 * The same, for a command whose exit code is an answer rather than a failure.
 *
 * `gh pr checks` exits non-zero while anything is pending or red, which is exactly the state it is
 * being asked about. What it printed is the answer either way; an empty output is only accepted
 * when the command itself succeeded, so authentication and network failures stay actionable.
 */
const ask = (cmd: string, args: string[], timeout?: number): string => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(timeout === undefined ? {} : { timeout }),
    }).trim();
  } catch (wrong) {
    const failure = wrong as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number | null;
      signal?: string | null;
    };
    const stdout = String(failure.stdout ?? '').trim();
    if (stdout) return stdout;
    if (failure.signal === 'SIGTERM' && failure.status == null) {
      throw new Error('gh pr checks did not return before the release deadline');
    }
    const stderr = String(failure.stderr ?? '').trim();
    throw new Error(stderr || `gh ${args.join(' ')} failed without output`);
  }
};

const say = (line: string): void => console.log(line);

/** What the next version is: given outright, or a step from the one in the chart. */
function nextVersion(asked: string, now: string): string {
  if (/^\d+\.\d+\.\d+$/.test(asked)) return asked;
  const [major, minor, patch] = now.split('.').map(Number);
  if (asked === 'major') return `${major + 1}.0.0`;
  if (asked === 'minor') return `${major}.${minor + 1}.0`;
  if (asked === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`say a version like 1.2.3, or major, minor or patch — not "${asked}"`);
}

/** The one place each version number is written down, and what it looks like there. */
const WRITTEN: Array<{ file: string; find: RegExp; write: (v: string) => string }> = [
  { file: 'chart/Chart.yaml', find: /^version: .+$/m, write: (v) => `version: ${v}` },
  { file: 'chart/Chart.yaml', find: /^appVersion: .+$/m, write: (v) => `appVersion: "${v}"` },
  { file: 'deploy/flux/helmrelease.yaml', find: /^      version: '.+'$/m, write: (v) => `      version: '${v}'` },
  /*
   * And the package, which the page reads to say what it is.
   *
   * It had been left behind at 0.2.0 for nine releases, because nothing looked at it: the chart is
   * what a cluster installs and the tag is what the image is called. Now the title screen and the
   * console both print the version, and the honest place for a web page to read its own version is
   * its package — so it goes in the list, and it cannot drift again without this failing.
   */
  { file: 'package.json', find: /^  "version": ".+",$/m, write: (v) => `  "version": "${v}",` },
];

/**
 * Which issues this release gets to claim.
 *
 * Not a judgement — a window. Everything closed since the previous tag went out is in this release,
 * because there was no other release for it to have gone out in. That is worth writing down on the
 * issue, because the question anybody asks of a closed issue six months later is *which version
 * fixed this*, and an issue that only says "closed" cannot answer it.
 *
 * Milestones are the other way round and do not fit this project: a milestone is a bag you fill
 * before you cut, and here a release is cut the moment one feature lands. There were twenty-one
 * releases on 13 September 2026 against four issues closed, so most milestones would hold one issue
 * or none, and several of those releases fixed something found while doing something else — nothing
 * planned them and no bag would have held them.
 */
export function whatShipped(
  closed: ReadonlyArray<{ number: number; closedAt: string }>,
  since: string | null,
  /**
   * Issues that already say which version fixed them, which are never told again.
   *
   * The window alone is honest arithmetic and it still put two versions on one issue: four fixed in
   * v0.92.3 were *closed* two hours after v0.92.3 was tagged, so the next release's window swept
   * them up. An issue claiming two versions is worse than one claiming none — a reader now has to
   * pick a line to believe — and the stamp already on it was written nearer the event than any
   * later guess, so the first one wins.
   */
  already: ReadonlySet<number> = new Set(),
): number[] {
  const after = since === null ? 0 : Date.parse(since);
  return closed
    .filter((issue) => Date.parse(issue.closedAt) > after && !already.has(issue.number))
    .map((issue) => issue.number);
}

/** Which issues have already been told, asked of the issues themselves rather than of a file. */
function alreadyTold(numbers: readonly number[]): Set<number> {
  const told = new Set<number>();
  for (const issue of numbers) {
    const said = run('gh', ['issue', 'view', String(issue), '--json', 'comments',
                            '-q', '.comments[].body']);
    if (/Shipped in \[v/.test(said)) told.add(issue);
  }
  return told;
}

/**
 * When the previous release went out, as GitHub reckons it — or nothing, for a first release.
 *
 * The tag's own commit date, rather than anything local: the issues are closed on GitHub's clock,
 * and comparing two clocks is how an issue ends up stamped twice or not at all.
 */
function whenTheLastOneWent(): string | null {
  const tags = run('git', ['tag', '--list', 'v*', '--sort=-creatordate']).split('\n').filter(Boolean);
  const previous = tags[0];
  if (!previous) return null;
  return run('git', ['log', '-1', '--format=%cI', previous]);
}

/**
 * Write the version onto every issue that shipped in it.
 *
 * A comment rather than a label, because a label is a set membership and this is a fact with a
 * date: the comment sits in the issue's own history next to the close that caused it. It is the
 * last thing a release does and the only thing it does not care about failing — the release is
 * already tagged, pushed and building, and a missing comment is worth less than a crash here.
 */
function stampTheIssues(version: string, shipped: number[]): void {
  for (const issue of shipped) {
    try {
      run('gh', ['issue', 'comment', String(issue), '--body', `Shipped in [v${version}](https://github.com/christhomas/ai.world/releases/tag/v${version}).`]);
    } catch {
      say(`could not comment on #${issue} — the release is out regardless`);
    }
  }
  if (shipped.length > 0) say(`stamped v${version} on ${shipped.map((n) => `#${n}`).join(', ')}`);
}

/**
 * The changelog, which is the one place a release says what it was.
 *
 * Written before the commit and before the tag, and that order is the whole point rather than a
 * detail. `github-guard`'s changelog hook reads the *tagged commit's* files when a version tag is
 * pushed and refuses a tag whose release nobody documented — so a changelog written afterwards is a
 * push that fails, and one written here is a release that cannot go out undescribed.
 *
 * Two files, and they are not the same file twice. `CHANGELOG.md` is every release there has ever
 * been; the README carries the ten most recent and links onward, because a reader who has just
 * found the project wants to know what happened lately and not what happened a hundred and thirty
 * releases ago.
 */
const CHANGELOG = 'CHANGELOG.md';
const README = 'README.md';

/** How many releases the README shows before the rest are only in the changelog. See the guard. */
const IN_THE_README = 10;

/**
 * Every file a release writes, which is the same list twice over.
 *
 * It is what gets committed, and it is what gets put back when the release stops after writing.
 * Those had been two lists written out separately, which is how a fifth file added to `WRITTEN`
 * would have been left dirty on `main` by a failed release.
 */
export const FILES_A_RELEASE_WRITES: readonly string[] = [
  ...new Set(WRITTEN.map((one) => one.file)), CHANGELOG, README,
];

/**
 * What GitHub's release page says, taken from the changelog rather than written twice.
 *
 * `github-guard` ships the extractor that its own hook enforces — `git-changelog.sh notes vX.Y.Z`
 * reads the same file, adds a compare link to the release before it, and is the reason the guard
 * exists in the form it does: the changelog is the single source and the release body is a view of
 * it. Falls back to the note as typed where the guard is not installed in this clone, because the
 * guards are per-clone and a release must not depend on somebody having run an installer.
 */
function notesFor(version: string, body: string): string {
  try {
    return run('bash', ['.git/hooks/pre-push.d/git-changelog.sh', 'notes', `v${version}`]) || body;
  } catch {
    return body;
  }
}

/** Wait for every check to finish, for the case where nothing will merge it for us. */
/**
 * A check that has finished and is not a complaint. A job a workflow decided to skip is not a red
 * commit, and neither is one that reports nothing either way.
 */
const IN = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

/** A check that has finished and is a complaint, in every spelling GitHub has for one. */
const RED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

/**
 * Whether a release may go out yet, read off what the checks say.
 *
 * An empty list is `waiting` rather than `passed`, and that is the case worth stating: a pull
 * request seconds old has no checks on it at all, and "none has failed and all are in" is true of
 * nothing — so reading it as passed would tag a commit before a single job had started.
 *
 * Red is decided the moment one check is red, without waiting for the rest. The playtest takes two
 * minutes and the suite nine, and waiting the slow one out to be told what the fast one already
 * said is the release standing about for no reason.
 */
export function howTheChecksStand(
  checks: ReadonlyArray<{ name: string; state: string }>,
): 'passed' | 'failed' | 'waiting' {
  if (checks.some((check) => RED.has(check.state))) return 'failed';
  if (checks.length === 0) return 'waiting';
  return checks.every((check) => IN.has(check.state)) ? 'passed' : 'waiting';
}

function waitForTheChecks(branch: string): void {
  const until = Date.now() + WAIT_FOR_CI;
  for (;;) {
    /*
     * Asked rather than watched, and the difference is the whole of item 126.
     *
     * `gh pr checks --watch` blocks until the checks finish, so the deadline around it was
     * evaluated once, before anything had happened, and never again: a stuck runner meant a release
     * that waited for ever with no message. Polling on the same rhythm as the merge wait below
     * makes one loop shape cover both, and makes the twenty minutes mean twenty minutes.
     *
     * `gh pr checks` exits non-zero while anything is pending or red — which is the state this is
     * *asking about* — so its complaint is not an error here; what matters is what it printed.
     * Each poll is bounded by the time left before the release deadline, so a hung CLI cannot bypass
     * the deadline either.
     */
    const remaining = until - Date.now();
    if (remaining <= 0) {
      throw new Error('the checks have not finished in time. Nothing is broken and nothing is tagged:'
        + ` look at what is holding them up, then run the same release again.`);
    }
    const said = ask('gh', ['pr', 'checks', branch, '--json', 'name,state'], remaining);
    const stand = howTheChecksStand(said ? JSON.parse(said) as Array<{ name: string; state: string }> : []);
    if (stand === 'passed') return;
    if (stand === 'failed') throw new Error('a check failed — the release is not going out on a red commit');
    if (Date.now() >= until) {
      throw new Error('the checks have not finished in time. Nothing is broken and nothing is tagged:'
        + ` look at what is holding them up, then run the same release again.`);
    }
    execFileSync('sleep', [String(Math.min(15, (until - Date.now()) / 1000))]);
  }
}

/**
 * Wait until the pull request is actually in, or say why it never will be.
 *
 * A release that tagged a commit main had not taken would be a version that exists on one machine,
 * which is the whole class of fault this file was written to make impossible.
 */
function waitForTheMerge(branch: string): void {
  const until = Date.now() + WAIT_FOR_CI;
  for (;;) {
    const seen = JSON.parse(run('gh', ['pr', 'view', branch, '--json', 'state,mergedAt'])) as
      { state: string; mergedAt: string | null };
    if (seen.state === 'MERGED') return;
    if (seen.state === 'CLOSED') throw new Error(`the release request was closed without merging`);
    if (Date.now() > until) {
      throw new Error('the checks have not finished. The request is open and will merge itself when'
        + ` they pass — then: git fetch origin main && git tag -a v… && git push origin v…`);
    }
    execFileSync('sleep', ['15']);
  }
}

/** How long to wait on the checks before saying so. The playtest is a browser and is the slow one. */
const WAIT_FOR_CI = 20 * 60 * 1000;

/** Today, as the changelog dates things: the day the release went out, not the day it was written. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * What actually went into this release: the pull requests merged since the last tag.
 *
 * Chris, 13 September 2026: *"having PRs means that we work on issues, and those issues are turned
 * into PRs, which means we can measure work and produce better quality releases because we can say
 * what PRs went into each release, meaning we can more accurately create CHANGELOG entries."*
 *
 * That is the argument for branch protection that is not about protection at all. A pull request is
 * a *unit of work with a name*, and a release is a set of them — so what a version contains stops
 * being a sentence somebody typed about their own work and becomes a list of what was merged. The
 * headline note stays, because a list of titles says what changed and not what it was *for*; what
 * it stops doing is standing alone.
 *
 * Empty for a release whose work went straight to main, which every release before the guard was
 * installed did. That is the honest answer rather than a missing one, and the entry falls back to
 * the note by itself.
 */
function whatWentIn(since: string | null): string[] {
  if (!since) return [];
  try {
    const merged = run('gh', ['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '100',
                              '--json', 'number,title,mergedAt,closingIssuesReferences']);
    const rows = JSON.parse(merged || '[]') as Array<{
      number: number; title: string; mergedAt: string;
      closingIssuesReferences?: Array<{ number: number }>;
    }>;
    return rows
      .filter((pr) => Date.parse(pr.mergedAt) > Date.parse(since))
      .sort((a, b) => a.number - b.number)
      .map((pr) => {
        const closed = (pr.closingIssuesReferences ?? []).map((i) => `#${i.number}`).join(', ');
        return `- ${pr.title} (#${pr.number})${closed ? ` — closes ${closed}` : ''}`;
      });
  } catch {
    return [];
  }
}

/** Put this version at the top of `CHANGELOG.md`, under the preamble and above the last one. */
function writeTheChangelog(version: string, body: string, since: string | null): void {
  const text = readFileSync(CHANGELOG, 'utf8');
  const at = text.indexOf('\n## v');
  if (at < 0) throw new Error(`${CHANGELOG} has no released versions in it to write above`);
  const went = whatWentIn(since);
  const said = went.length > 0 ? `${body.trim()}\n\n${went.join('\n')}\n` : `${body.trim()}\n`;
  const entry = `\n## v${version} — ${today()}\n\n${said}`;
  writeFileSync(CHANGELOG, text.slice(0, at) + entry + text.slice(at));
}

/**
 * What each release in the changelog said it was: its tag, its day, and its opening line.
 *
 * Pulled out of `writeTheReadme` and exported because it is the part that was wrong, silently, for
 * eleven releases. The body was matched with `(?=\n## v|$)` under the `m` flag, where `$` is the
 * end of a *line* — so the lazy body gave up at the blank line under the heading, every entry came
 * back empty, and every line on the README's front page read "No note was written for this one".
 *
 * Nothing caught it because the release runs the suite *before* it writes these files: the thing it
 * breaks is never the thing it checked. So the rule is testable on a changelog of its own now,
 * rather than only on whatever the repository happens to contain this afternoon.
 */

/**
 * Run the checks that read what this release just wrote, now that it is written.
 *
 * The suite above runs on the tree as it was. Everything after it — the chart, the pin, the
 * package, the changelog entry and the README's ten — is written afterwards, so **the thing the
 * release breaks is never the thing it checked.**
 *
 * That is not a hypothetical. `$` under the `m` flag is the end of a *line*, so a changelog entry's
 * body matched empty and every one of the README's ten read *"No note was written for this one"* —
 * for eleven releases, including ones plainly written with notes. Nothing caught it, and when
 * something finally did it was a good accident: the release had started going out through a pull
 * request, and the pull request's own checks happen to run after the write.
 *
 * `tools/release.test.ts` is the suite that knows what a changelog entry should look like, it reads
 * both files, and it takes under a second. There is no reason it should not be asked twice.
 *
 * **And the tree is put back if it refuses.** A release that stops here has already written five
 * files on `main`, and leaving them is the same fault in a different coat — a tool that leaves the
 * tree in a state its own gate never saw. See #81, which is this shape in CI.
 */
function readWhatWasWritten(): void {
  say('reading back what was just written, because the suite above ran before it existed');
  try {
    execFileSync('pnpm', ['vitest', 'run', 'tools/release.test.ts'], { stdio: 'inherit' });
  } catch {
    run('git', ['checkout', '--', ...FILES_A_RELEASE_WRITES]);
    throw new Error(
      'the release wrote its files and its own checks then refused them. The tree is put back as it '
      + `was; nothing was committed, pushed or tagged. The files it wrote were: ${FILES_A_RELEASE_WRITES.join(', ')}.`,
    );
  }
}

/**
 * And the README's ten, which are rewritten rather than appended to.
 *
 * Rebuilt from the changelog every time, so the two cannot disagree about what a version said — the
 * fault this project finds most often is two records of one fact drifting apart, and a summary
 * maintained by hand beside the thing it summarises is exactly how that starts. Only the first line
 * of each entry, because the README is a front page and not an archive.
 */
export function whatEachSaid(log: string): Array<{ tag: string; when: string; said: string }> {
  return [...log.matchAll(/^## (v\d+\.\d+\.\d+) — (\S+)\n([\s\S]*?)(?=\n## v|(?![\s\S]))/gm)]
    .map(([, tag, when, body]) => ({ tag, when, said: body.trim().split('\n')[0].trim() }));
}

function writeTheReadme(): void {
  const log = readFileSync(CHANGELOG, 'utf8');
  const entries = whatEachSaid(log)
    .slice(0, IN_THE_README)
    .map(({ tag, when, said }) =>
      `### ${tag} — ${when}\n\n${said || '_No note was written for this one._'}\n`);
  const section = ['## Changelog', '',
    `The ten most recent releases. Every one since \`v0.1.0\` is in [${CHANGELOG}](${CHANGELOG}).`,
    '', ...entries].join('\n').trimEnd();
  const text = readFileSync(README, 'utf8');
  const from = text.indexOf('## Changelog');
  if (from < 0) throw new Error(`${README} has no "## Changelog" section to rewrite`);
  const to = text.indexOf('\n## ', from + 1);
  writeFileSync(README, text.slice(0, from) + section + '\n' + (to < 0 ? '' : text.slice(to + 1)));
}


function main(): void {
  const asked = process.argv[2];
  if (!asked) throw new Error('usage: release <version|major|minor|patch> ["what is in it"]');
  const note = process.argv[3] ?? '';

  const standing = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (standing !== 'main') throw new Error(`releases are cut from main, and this is ${standing}`);
  if (run('git', ['status', '--porcelain'])) {
    throw new Error('there are uncommitted changes — a release has to name a commit that exists');
  }

  const chart = readFileSync('chart/Chart.yaml', 'utf8');
  const now = chart.match(/^version: (.+)$/m)?.[1]?.trim() ?? '0.0.0';
  const version = nextVersion(asked, now);
  if (version === now) throw new Error(`the chart is already ${now}`);
  say(`releasing ${now} → ${version}`);

  // asked before the new tag exists, or the window this release covers would be empty
  const since = whenTheLastOneWent();

  say('running the tests, because a release is the wrong place to find out');
  execFileSync('pnpm', ['test', '--run'], { stdio: 'inherit' });

  for (const { file, find, write } of WRITTEN) {
    const text = readFileSync(file, 'utf8');
    if (!find.test(text)) throw new Error(`${file} does not say what version it is in the way this expects`);
    writeFileSync(file, text.replace(find, write(version)));
  }
  say('chart, appVersion, the HelmRelease pin and the package all moved');

  const body = note || `Version ${version}.`;
  // before the commit, because the guard reads the tagged commit and refuses an undocumented tag
  writeTheChangelog(version, body, since);
  writeTheReadme();
  say(`${CHANGELOG} and the README's ten now say what ${version} was`);
  readWhatWasWritten();
  /*
   * And out through a pull request, because `main` is protected and should be.
   *
   * `github-guard` sets the branch up the way an agent-operated repository wants it — a pull
   * request for every change, admins included, and linear history — and that refused the direct
   * push this used to do. The guard is right and this was wrong: a release is the change most
   * worth having a record of, and "the tool that makes releases is the one thing allowed to write
   * to main unobserved" is exactly the exception that makes a protection worthless.
   *
   * It costs nothing, which is worth knowing before anybody is tempted to bypass it: the branch
   * requires **no approving reviews and no status checks**, so the request can be opened and
   * squashed in the same breath. `chore release` is still one command. What changed is that every
   * release now leaves a reviewable pull request behind it rather than an unexplained commit.
   */
  const branch = `release/v${version}`;
  run('git', ['switch', '-c', branch]);
  run('git', ['add', ...FILES_A_RELEASE_WRITES]);
  run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', `Release ${version}\n\n${body}`]);
  run('git', ['push', '-u', 'origin', branch]);
  run('gh', ['pr', 'create', '--base', 'main', '--head', branch,
             '--title', `Release ${version}`, '--body', body]);
  /*
   * And then it waits, which is the part worth understanding rather than working around.
   *
   * `main` requires the `playtest` check — a real browser walking through a door and looking at the
   * furniture from inside, which catches the faults a unit test cannot see. The tests have already
   * run locally by this point, so this is not the same work twice: it is the one check that cannot
   * be run on a laptop, on the exact commit that is about to become a release.
   *
   * `--auto` rather than a poll of our own: GitHub merges it the moment the checks are green, and
   * nothing here has to decide what "green" means. Then this waits for the merge to actually have
   * happened, because the tag goes on what main became and there is nothing to tag until it does.
   */
  try {
    run('gh', ['pr', 'merge', branch, '--squash', '--delete-branch', '--auto']);
  } catch {
    // auto-merge is a repository setting and not every clone's repository has it turned on. Saying
    // so and waiting is better than requiring somebody to go and find a checkbox before releasing
    say('auto-merge is off for this repository; waiting on the checks and merging by hand');
    waitForTheChecks(branch);
    run('gh', ['pr', 'merge', branch, '--squash', '--delete-branch']);
  }
  say('waiting for the checks — the playtest is a browser, and it takes a few minutes');
  waitForTheMerge(branch);
  say('released through a pull request and squashed onto main');

  /*
   * The tag goes on what main actually became, not on what was written locally.
   *
   * A squash makes a *new* commit, so the commit that exists here is not the commit that shipped.
   * Tagging the local one would put the tag on an object nobody else has — and `git-tags-on-main`
   * would refuse it, correctly, as a tag pointing off the branch.
   */
  run('git', ['switch', 'main']);
  run('git', ['fetch', 'origin', 'main']);
  run('git', ['reset', '--hard', 'origin/main']);
  run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);
  run('git', ['push', 'origin', `v${version}`]);
  say(`tagged v${version} on main as it now stands`);

  // The release is what builds the image the chart now names. Without it the cluster reconciles
  // against a version that exists in git and nowhere else.
  run('gh', ['release', 'create', `v${version}`, '--title', `v${version}`, '--notes', notesFor(version, body)]);
  say(`published the release — the image workflow is building ghcr.io/christhomas/ai-world:${version}`);
  say('watch it with: gh run watch $(gh run list --workflow=image.yml --limit 1 --json databaseId -q \'.[0].databaseId\')');

  const closed = JSON.parse(run('gh', ['issue', 'list', '--state', 'closed', '--limit', '100', '--json', 'number,closedAt'])) as
    Array<{ number: number; closedAt: string }>;
  const window = whatShipped(closed, since);
  stampTheIssues(version, whatShipped(closed, since, alreadyTold(window)));
}

// importable, so the window above can be tested without cutting a release to find out
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
