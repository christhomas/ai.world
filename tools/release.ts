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
function waitForTheChecks(branch: string): void {
  const until = Date.now() + WAIT_FOR_CI;
  while (Date.now() < until) {
    try {
      run('gh', ['pr', 'checks', branch, '--watch', '--fail-fast']);
      return;
    } catch {
      throw new Error('a check failed — the release is not going out on a red commit');
    }
  }
  throw new Error('the checks have not finished in time');
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
 * And the README's ten, which are rewritten rather than appended to.
 *
 * Rebuilt from the changelog every time, so the two cannot disagree about what a version said — the
 * fault this project finds most often is two records of one fact drifting apart, and a summary
 * maintained by hand beside the thing it summarises is exactly how that starts. Only the first line
 * of each entry, because the README is a front page and not an archive.
 */
function writeTheReadme(): void {
  const log = readFileSync(CHANGELOG, 'utf8');
  const entries = [...log.matchAll(/^## (v\d+\.\d+\.\d+) — (\S+)\n([\s\S]*?)(?=\n## v|$)/gm)]
    .slice(0, IN_THE_README)
    .map(([, tag, when, said]) => {
      const first = said.trim().split('\n')[0].trim();
      return `### ${tag} — ${when}\n\n${first || '_No note was written for this one._'}\n`;
    });
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
  run('git', ['add', 'chart/Chart.yaml', 'deploy/flux/helmrelease.yaml', 'package.json',
              CHANGELOG, README]);
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
   * A squash creates a new commit. Name that exact commit through the pull request, not whichever
   * unrelated change reached main before this process fetched it. The tree check makes the target
   * prove it carries the chart version this release just wrote.
   */
  const merged: unknown = JSON.parse(run('gh', ['pr', 'view', branch, '--json', 'mergeCommit']));
  if (
    !merged || typeof merged !== 'object' || !('mergeCommit' in merged)
    || !merged.mergeCommit || typeof merged.mergeCommit !== 'object'
    || !('oid' in merged.mergeCommit) || typeof merged.mergeCommit.oid !== 'string'
  ) throw new Error(`release pull request ${branch} has no merge commit`);
  const releaseCommit = merged.mergeCommit.oid;

  run('git', ['switch', 'main']);
  run('git', ['fetch', 'origin', 'main']);
  run('git', ['merge-base', '--is-ancestor', releaseCommit, 'origin/main']);
  const taggedChart = run('git', ['show', `${releaseCommit}:chart/Chart.yaml`]);
  if (taggedChart.match(/^version: (.+)$/m)?.[1]?.trim() !== version) {
    throw new Error(`merge commit ${releaseCommit} does not carry chart version ${version}`);
  }
  run('git', ['tag', '-a', `v${version}`, releaseCommit, '-m', `v${version}`]);
  run('git', ['push', 'origin', `v${version}`]);
  say(`tagged v${version} on release commit ${releaseCommit}`);

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
