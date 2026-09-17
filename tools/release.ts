import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    const comments = rest<Array<{ body: string }>>([`repos/${REPO}/issues/${issue}/comments`, '--paginate']);
    if ((comments ?? []).some((one) => /Shipped in \[v/.test(one.body ?? ''))) told.add(issue);
  }
  return told;
}

/**
 * When the previous release went out, as GitHub reckons it — or nothing, for a first release.
 *
 * The tag's own commit date, rather than anything local: the issues are closed on GitHub's clock,
 * and comparing two clocks is how an issue ends up stamped twice or not at all.
 */
function whenTheLastOneWent(notThisOne?: string): string | null {
  const tags = run('git', ['tag', '--list', 'v*', '--sort=-creatordate']).split('\n').filter(Boolean);
  /*
   * And never this release's own tag, which a resumed run may already have made.
   *
   * The window is "everything closed since the release before this one". A run killed between the
   * tag and the publish has `vX.Y.Z` sitting locally, so the newest tag is this release — and the
   * window it gives back is empty, which silently leaves every issue it shipped unstamped.
   */
  const previous = tags.find((tag) => tag !== `v${notThisOne}`);
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
      restWith([`repos/${REPO}/issues/${issue}/comments`, '-X', 'POST'],
               { body: `Shipped in [v${version}](https://github.com/${REPO}/releases/tag/v${version}).` });
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


/**
 * Every call to GitHub in this file goes through REST, and that is not a style preference.
 *
 * `gh pr` and `gh issue` are GraphQL, and GitHub counts GraphQL against a quota of its own, separate
 * from REST's. A session that has spent a day opening and merging pull requests — which is exactly
 * the session that has something to release — exhausts it, and then this file died at `gh pr
 * create` with `GraphQL: API rate limit already exceeded` while REST had five thousand of five
 * thousand requests left. It died *after* committing the version bump and pushing the branch, which
 * is the worst place to stop: four files bumped, a branch on the remote, no tag, no release, and
 * therefore no image for the chart that now names one. See #341, and v0.99.0, which had to be
 * finished by hand through these same endpoints.
 *
 * So: `gh api`, which is REST, everywhere.
 */
const REPO = 'christhomas/ai.world';

/** A REST call that returns parsed JSON, or a thrown error carrying what GitHub said. */
function rest<T>(args: string[], timeout?: number): T {
  return JSON.parse(ask('gh', ['api', ...args], timeout) || 'null') as T;
}

/**
 * A REST call whose body is JSON, written to a file rather than handed to the shell.
 *
 * `-f body=…` puts the text through a shell, and a release note with backticks in it — which is
 * every release note in this project, because they name files — runs those as command
 * substitution. It mangled a comment before anybody noticed. A file cannot be misread.
 */
function restWith<T>(args: string[], body: unknown): T {
  const to = `${tmpdir()}/ai-world-release-${process.pid}.json`;
  writeFileSync(to, JSON.stringify(body));
  try {
    return JSON.parse(run('gh', ['api', ...args, '--input', to]) || 'null') as T;
  } finally {
    rmSync(to, { force: true });
  }
}

/**
 * What the checks on a commit say, in the words `howTheChecksStand` reads.
 *
 * REST answers per *run* rather than per name, and a pull request routinely carries two runs of the
 * same required check — one triggered by the push and one by the request being opened. Both are
 * kept rather than folded together, which is the point: branch protection waits for every run, so a
 * release that looked at the first `check` and saw green would try to merge and be refused with
 * *"Required status check \"check\" is in progress"*. That happened cutting v0.99.0.
 */
export function checksAsStates(
  runs: ReadonlyArray<{ name: string; status: string; conclusion: string | null }>,
): Array<{ name: string; state: string }> {
  return runs.map((one) => ({
    name: one.name,
    // a run that has not finished is pending whatever it may be about to conclude
    state: one.status === 'completed' ? (one.conclusion ?? 'NEUTRAL').toUpperCase() : 'PENDING',
  }));
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
    const runs = rest<{ check_runs?: Array<{ name: string; status: string; conclusion: string | null }> }>(
      [`repos/${REPO}/commits/${branch}/check-runs`, '--paginate'], remaining,
    );
    const stand = howTheChecksStand(checksAsStates(runs?.check_runs ?? []));
    if (stand === 'passed') return;
    if (stand === 'failed') throw new Error('a check failed — the release is not going out on a red commit');
    if (Date.now() >= until) {
      throw new Error('the checks have not finished in time. Nothing is broken and nothing is tagged:'
        + ` look at what is holding them up, then run the same release again.`);
    }
    execFileSync('sleep', [String(Math.min(15, (until - Date.now()) / 1000))]);
  }
}

/*
 * `waitForTheMerge` used to live here, polling `gh pr view` until the request said MERGED.
 *
 * It was there because the merge was asked for with `--auto` and happened later, on GitHub's own
 * clock — so the tag had nothing to go on until something said it had. The REST merge answers with
 * the squash commit in the same call, so there is no gap to wait across and nothing left to poll.
 */

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
    const rows = rest<Array<{ number: number; title: string; merged_at: string | null; body: string | null }>>(
      [`repos/${REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`],
    ) ?? [];
    return rows
      .filter((pr) => pr.merged_at !== null && Date.parse(pr.merged_at) > Date.parse(since))
      .sort((a, b) => a.number - b.number)
      .map((pr) => {
        const closed = closesWhat(pr.body ?? '').map((n) => `#${n}`).join(', ');
        return `- ${pr.title} (#${pr.number})${closed ? ` — closes ${closed}` : ''}`;
      });
  } catch {
    return [];
  }
}

/**
 * Which issues a pull request says it closes, read out of what it wrote.
 *
 * GraphQL has `closingIssuesReferences` and REST has nothing like it, so this reads the body for the
 * keywords GitHub itself acts on. Slightly less than GraphQL knew — it also counted references made
 * in commit messages — and enough for a changelog line, which is all this feeds. A line that named
 * one issue fewer is a smaller loss than a release that cannot be cut at all; see #341.
 */
export function closesWhat(body: string): number[] {
  const found = new Set<number>();
  for (const [, n] of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) {
    found.add(Number(n));
  }
  return [...found].sort((a, b) => a - b);
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
 * The commit a squashed release actually became, named by the pull request rather than guessed at.
 *
 * A release goes out through a pull request and is squashed, so the commit that exists locally is
 * not the commit that shipped: a squash makes a new one. The old code reset to `origin/main` and
 * tagged whatever was on the end of it, which is a race with every other pull request in flight —
 * the tag lands on somebody else's change, and a version number then points at a tree that never
 * carried it.
 *
 * Every unexpected shape throws rather than falling back, and that is the whole of it: a release
 * that cannot name its own commit must stop, not guess at one. The branch goes in the message
 * because it is the thing somebody has to go and look at.
 */
export function theReleaseCommit(mergeCommitJson: string, branch: string): string {
  const merged: unknown = JSON.parse(mergeCommitJson);
  if (
    !merged || typeof merged !== 'object' || !('mergeCommit' in merged)
    || !merged.mergeCommit || typeof merged.mergeCommit !== 'object'
    || !('oid' in merged.mergeCommit) || typeof merged.mergeCommit.oid !== 'string'
  ) throw new Error(`release pull request ${branch} has no merge commit`);
  return merged.mergeCommit.oid;
}

/**
 * The version a chart declares, or nothing if it declares none.
 *
 * The proof that the commit named above is the right one. A name out of the pull request is still
 * only a name until the tree under it is the tree this release wrote, and the chart version is what
 * this release wrote. Anchored to the start of a line so `appVersion` is not mistaken for it.
 */
export function chartVersionOf(chart: string): string | null {
  return chart.match(/^version: (.+)$/m)?.[1]?.trim() ?? null;
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


/**
 * Where a release got to, which is read from the world rather than remembered.
 *
 * A release is a line of side effects and it used to keep no record of how far along it was. Each
 * step is idempotent in isolation — a tag that exists, a release that exists — but nothing asked
 * which ones were already taken, so a run killed half way through could not be finished by running
 * it again: it read `chart/Chart.yaml` off disk, saw the version that had already been written, and
 * tried to cut the *next* one over the top of an unfinished one. Both times that happened it took
 * somebody who knows this file's internals to work out where it had stopped and do the rest by
 * hand. See #344, and #341 before it.
 *
 * Nothing here is stored. Every field is a question asked of git or of GitHub, because a record
 * this tool wrote about itself is one more thing that can be killed half written.
 */
export interface Stands {
  version: string;
  /** the release commit exists somewhere — on this machine, or on the remote, or both */
  committed: boolean;
  /** and the remote has it, which is what a pull request can be opened against */
  pushed: boolean;
  /** the pull request's number, if one was ever opened for this branch */
  request: number | null;
  /** the commit the squash became, if it merged */
  merged: string | null;
  /** `vX.Y.Z` is on the remote */
  tagged: boolean;
  /** and GitHub has a release for it, which is the thing that builds the image */
  published: boolean;
}

/** The parts of a release, in the only order they can happen in. */
export type Step = 'commit' | 'push' | 'request' | 'merge' | 'tag' | 'publish' | 'stamp';

/**
 * What a release has left to do.
 *
 * A line rather than a set, and that is the point: the first step that has not been taken and
 * everything after it. Asking each step separately and skipping the ones that answer yes would let
 * a release tag a commit whose pull request never merged, because a tag can be pushed at any time
 * and only the order says it should not be.
 *
 * `stamp` is always last and always run. Writing the version onto the issues it shipped is the one
 * part that reads what it already wrote — `alreadyTold` — so a second run cannot say it twice, and
 * a release finished by hand halfway is exactly the case where the stamping was never reached.
 */
export function whatIsLeft(stands: Stands): Step[] {
  const line: Array<[Step, boolean]> = [
    ['commit', stands.committed],
    ['push', stands.pushed],
    ['request', stands.request !== null],
    ['merge', stands.merged !== null],
    ['tag', stands.tagged],
    ['publish', stands.published],
  ];
  const from = line.findIndex(([, done]) => !done);
  return [...(from < 0 ? [] : line.slice(from).map(([step]) => step)), 'stamp'];
}

/** Newest version first, by number rather than by the string, so 0.10.0 sorts above 0.9.0. */
function newestFirst(a: string, b: string): number {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]);
}

/**
 * The release that was started and never finished, if there is one.
 *
 * A release branch is never deleted here, so the branches are the whole history of what has been
 * cut and their presence alone says nothing. What says something is the newest of them having no
 * published release: a release is only ever cut from a clean `main`, so the newest branch is the
 * one this repository was last trying to ship, and everything below it went out before it.
 *
 * Deliberately the newest rather than every unpublished one. An old branch with no release behind a
 * newer one that has shipped is history, not a job — going back to finish it now would tag a
 * version the world has already moved past.
 */
export function theUnfinishedOne(
  started: readonly string[],
  published: ReadonlySet<string>,
): string | null {
  const newest = [...started].sort(newestFirst)[0];
  return newest !== undefined && !published.has(newest) ? newest : null;
}

/**
 * Whether a dirty tree is the wreckage of a killed release rather than somebody's afternoon.
 *
 * A release writes five files before it commits anything, so a run killed in that window leaves
 * `main` dirty and the next run refusing to start — with a message about uncommitted changes that
 * says nothing about what actually happened. Those exact five files and nothing else is a shape
 * only this tool makes.
 *
 * Anything else is somebody's work and is never touched: an added file, a rename, a sixth path, one
 * of the five *plus* a sixth. The test is that every dirty path is one this release writes, and the
 * porcelain line for a rename carries an arrow that no filename in the list can match, so those
 * fall out on their own rather than by being special-cased.
 */
export function isTheWreckage(porcelain: string, writes: readonly string[]): boolean {
  const paths = porcelain.split('\n').filter(Boolean).map((line) => line.slice(3).trim());
  return paths.length > 0 && paths.every((path) => writes.includes(path));
}

/** The versions GitHub has actually published a release for, which is what "finished" means here. */
function published(): Set<string> {
  const releases = rest<Array<{ tag_name: string }>>([`repos/${REPO}/releases?per_page=100`]) ?? [];
  return new Set(releases.map((one) => one.tag_name.replace(/^v/, '')));
}

/** Every version this repository has ever started cutting, read off the release branches. */
function started(): string[] {
  const heads = run('git', ['ls-remote', '--heads', 'origin', 'refs/heads/release/v*']);
  const local = run('git', ['branch', '--list', 'release/v*', '--format=%(refname:short)']);
  const names = [...heads.split('\n'), ...local.split('\n')]
    .map((line) => line.match(/release\/v(\d+\.\d+\.\d+)$/)?.[1])
    .filter((one): one is string => one !== undefined);
  return [...new Set(names)];
}

/** The pull request opened for a release branch, whether it is still open or long merged. */
function requestFor(branch: string): { number: number; merged: string | null } | null {
  const owner = REPO.split('/')[0];
  const rows = rest<Array<{ number: number; merge_commit_sha: string | null; merged_at: string | null }>>(
    [`repos/${REPO}/pulls?head=${owner}:${branch}&state=all&per_page=100`],
  ) ?? [];
  const one = rows.sort((a, b) => b.number - a.number)[0];
  if (!one) return null;
  return { number: one.number, merged: one.merged_at ? one.merge_commit_sha : null };
}

/** Everything the world knows about a release, asked in one place so the answer is one moment. */
function standsAt(version: string): Stands {
  const branch = `release/v${version}`;
  const onOrigin = run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]) !== '';
  // `git branch --list` rather than `rev-parse --verify`, which exits non-zero for a branch that
  // is simply not there — an answer, not a failure, and `run` cannot tell the two apart.
  const here = run('git', ['branch', '--list', branch, '--format=%(refname:short)']) !== '';
  const request = onOrigin ? requestFor(branch) : null;
  return {
    version,
    committed: onOrigin || here,
    pushed: onOrigin,
    request: request?.number ?? null,
    merged: request?.merged ?? null,
    tagged: run('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${version}`]) !== '',
    published: published().has(version),
  };
}

/**
 * Cutting a release, or finishing the one that was cut and killed.
 *
 * It looks before it writes. Every step names its own artefact — a branch, a request, a merge
 * commit, a tag, a published release — so the world can be asked which ones exist and the run picks
 * up from the first one that does not. A release killed at any point is finished by running the
 * same command again, which is the whole of #344.
 */
function main(): void {
  const asked = process.argv[2];
  const note = process.argv[3] ?? '';

  const standing = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (standing !== 'main') throw new Error(`releases are cut from main, and this is ${standing}`);

  /*
   * The tags and the release branches, before anything is asked about them.
   *
   * Everything below reads the remote's answer for what exists — a machine that has not fetched
   * since the killed run would otherwise be told a tag is missing that is sitting on the remote,
   * and push it again.
   */
  run('git', ['fetch', 'origin', '--tags', '--prune']);

  /*
   * A tree left dirty by a killed release is put back, and anything else is still refused.
   *
   * A release writes five files before it commits, so a run cut down in that window leaves `main`
   * dirty — and the next run refused to start, with a message about uncommitted changes that said
   * nothing about what had happened. Those five files and nothing else is a shape only this tool
   * makes; a sixth path, an added file or a rename is somebody's work and is never touched.
   */
  const dirty = run('git', ['status', '--porcelain']);
  if (dirty && isTheWreckage(dirty, FILES_A_RELEASE_WRITES)) {
    run('git', ['checkout', '--', ...FILES_A_RELEASE_WRITES]);
    say('a killed release had written its files and not committed them — put back');
  } else if (dirty) {
    throw new Error('there are uncommitted changes — a release has to name a commit that exists');
  }

  /*
   * And what this run is actually for, which is not always what was asked.
   *
   * An unfinished release is finished rather than built on. Cutting the next version over the top
   * of one whose image was never built leaves a chart pinning a version that exists in git and
   * nowhere else, which is a cluster that cannot start — and it is what the old tool did every
   * time, because it read the version off a file the killed run had already written.
   */
  const unfinished = theUnfinishedOne(started(), published());
  const chart = readFileSync('chart/Chart.yaml', 'utf8');
  const now = chart.match(/^version: (.+)$/m)?.[1]?.trim() ?? '0.0.0';
  if (unfinished !== null && asked !== undefined && /^\d+\.\d+\.\d+$/.test(asked) && asked !== unfinished) {
    throw new Error(
      `v${unfinished} was started and never finished, so ${asked} cannot be cut yet. `
      + `Run the release again with no version, or with ${unfinished}, to finish that one first.`,
    );
  }
  if (unfinished === null && !asked) {
    throw new Error('usage: release <version|major|minor|patch> ["what is in it"]');
  }
  const version = unfinished ?? nextVersion(asked as string, now);
  if (unfinished === null && version === now) throw new Error(`the chart is already ${now}`);

  const stands = standsAt(version);
  const left = whatIsLeft(stands);
  if (unfinished !== null) {
    say(`finishing v${version}, which was started and not finished — ${left.join(', ')} left to do`);
  } else {
    say(`releasing ${now} → ${version}`);
  }

  /*
   * Which release the issues belong to, asked before this one is tagged and never of this one.
   *
   * The window is "everything closed since the previous release went out". On a resumed run the
   * tag being finished may already exist locally, and reading the newest tag would then hand back
   * this release's own moment — an empty window, and every issue it shipped left unstamped.
   */
  const since = whenTheLastOneWent(version);

  const branch = `release/v${version}`;
  const body = note || `Version ${version}.`;

  if (left.includes('commit')) {
    say('running the tests, because a release is the wrong place to find out');
    execFileSync('pnpm', ['test', '--run'], { stdio: 'inherit' });

    for (const { file, find, write } of WRITTEN) {
      const text = readFileSync(file, 'utf8');
      if (!find.test(text)) throw new Error(`${file} does not say what version it is in the way this expects`);
      writeFileSync(file, text.replace(find, write(version)));
    }
    say('chart, appVersion, the HelmRelease pin and the package all moved');

    // before the commit, because the guard reads the tagged commit and refuses an undocumented tag
    writeTheChangelog(version, body, since);
    writeTheReadme();
    say(`${CHANGELOG} and the README's ten now say what ${version} was`);
    readWhatWasWritten();

    run('git', ['switch', '-c', branch]);
    run('git', ['add', ...FILES_A_RELEASE_WRITES]);
    run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', `Release ${version}\n\n${body}`]);
  }

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
  if (left.includes('push')) {
    run('git', ['switch', branch]);
    run('git', ['push', '-u', 'origin', branch]);
  }

  let request = stands.request;
  if (left.includes('request')) {
    const opened = restWith<{ number: number }>(
      [`repos/${REPO}/pulls`, '-X', 'POST'],
      { title: `Release ${version}`, head: branch, base: 'main', body, draft: false },
    );
    if (!opened?.number) throw new Error(`the release request for ${branch} was not opened`);
    request = opened.number;
  }

  let releaseCommit = stands.merged;
  if (left.includes('merge')) {
    /*
     * And then it waits, which is the part worth understanding rather than working around.
     *
     * `main` requires the `playtest` check — a real browser walking through a door and looking at
     * the furniture from inside, which catches the faults a unit test cannot see. The tests have
     * already run locally by this point, so this is not the same work twice: it is the one check
     * that cannot be run on a laptop, on the exact commit that is about to become a release.
     */
    say('waiting for the checks — the playtest is a browser, and it takes a few minutes');
    waitForTheChecks(branch);
    /*
     * The head is named on the merge, so nothing else can land on this branch between the checks
     * going green and the squash. GitHub refuses the merge rather than releasing something nobody
     * checked. Read from the remote rather than from here, because a run resumed on another machine
     * — or after the branch was thrown away — has no local copy of it.
     */
    run('git', ['fetch', 'origin', branch]);
    const head = run('git', ['rev-parse', 'FETCH_HEAD']);
    const squashed = restWith<{ merged: boolean; sha: string }>(
      [`repos/${REPO}/pulls/${request}/merge`, '-X', 'PUT'],
      { merge_method: 'squash', sha: head },
    );
    if (!squashed?.merged) throw new Error(`the release request #${request} did not merge`);
    say('released through a pull request and squashed onto main');
    /*
     * A squash creates a new commit, and the merge itself names it. That is the commit to tag,
     * rather than whichever unrelated change reached main before this process fetched it — and the
     * tree check below makes it prove it carries the chart version this release just wrote.
     */
    releaseCommit = squashed.sha;
  }
  if (releaseCommit === null) throw new Error(`the release request for ${branch} has no merge commit`);

  run('git', ['switch', 'main']);
  run('git', ['fetch', 'origin', 'main']);
  run('git', ['merge-base', '--is-ancestor', releaseCommit, 'origin/main']);
  /*
   * And the local branch catches up with what was fetched, which a fetch does not do.
   *
   * `git fetch origin main` moves `origin/main` and leaves the checked-out `main` exactly where it
   * was — which is the commit before the release, since the release went out through a pull request
   * that was squashed on the server. Everything after this reads the working tree: the next
   * release's `nextVersion` reads `chart/Chart.yaml` off disk, sees the version *before* this one,
   * and cuts the same release again from a tree that is a release behind.
   *
   * `--ff-only` rather than a reset: main has just been fast-forwarded to a commit that contains
   * our own, so a fast-forward is what this is. If it is not — somebody committed locally, or the
   * squash landed somewhere unexpected — the release stops here with git's own message rather than
   * throwing that work away, which a reset would do silently.
   */
  run('git', ['merge', '--ff-only', 'origin/main']);
  if (chartVersionOf(run('git', ['show', `${releaseCommit}:chart/Chart.yaml`])) !== version) {
    throw new Error(`merge commit ${releaseCommit} does not carry chart version ${version}`);
  }

  if (left.includes('tag')) {
    // the local tag may already be there from a run killed between making it and pushing it
    if (run('git', ['tag', '--list', `v${version}`]) === '') {
      run('git', ['tag', '-a', `v${version}`, releaseCommit, '-m', `v${version}`]);
    }
    run('git', ['push', 'origin', `v${version}`]);
    say(`tagged v${version} on release commit ${releaseCommit}`);
  }

  if (left.includes('publish')) {
    // The release is what builds the image the chart now names. Without it the cluster reconciles
    // against a version that exists in git and nowhere else.
    restWith([`repos/${REPO}/releases`, '-X', 'POST'],
             { tag_name: `v${version}`, name: `v${version}`, body: notesFor(version, body) });
    say(`published the release — the image workflow is building ghcr.io/christhomas/ai-world:${version}`);
    say('watch it with: gh run watch $(gh run list --workflow=image.yml --limit 1 --json databaseId -q \'.[0].databaseId\')');
  }

  const closed = (rest<Array<{ number: number; closed_at: string; pull_request?: unknown }>>(
    [`repos/${REPO}/issues?state=closed&per_page=100&sort=updated`],
  ) ?? []).filter((one) => !one.pull_request)
    .map((one) => ({ number: one.number, closedAt: one.closed_at }));
  const window = whatShipped(closed, since);
  stampTheIssues(version, whatShipped(closed, since, alreadyTold(window)));

  if (unfinished !== null) {
    say(`v${version} is finished. The next version is a release of its own — run this again for it.`);
  }
}

// importable, so the window above can be tested without cutting a release to find out
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
