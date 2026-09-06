import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

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
 *   2. a commit saying what is in it
 *   3. a tag on that commit, which is what a rollback goes back to
 *   4. a GitHub release, which is what builds and publishes the image the chart names
 *
 * It refuses to start on a dirty tree or off main, and it runs the tests before it writes anything.
 * A release is the one moment where being slow is free and being wrong is expensive.
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
];

function main(): void {
  const asked = process.argv[2];
  if (!asked) throw new Error('usage: release <version|major|minor|patch> ["what is in it"]');
  const note = process.argv[3] ?? '';

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Error(`releases are cut from main, and this is ${branch}`);
  if (run('git', ['status', '--porcelain'])) {
    throw new Error('there are uncommitted changes — a release has to name a commit that exists');
  }

  const chart = readFileSync('chart/Chart.yaml', 'utf8');
  const now = chart.match(/^version: (.+)$/m)?.[1]?.trim() ?? '0.0.0';
  const version = nextVersion(asked, now);
  if (version === now) throw new Error(`the chart is already ${now}`);
  say(`releasing ${now} → ${version}`);

  say('running the tests, because a release is the wrong place to find out');
  execFileSync('pnpm', ['test', '--run'], { stdio: 'inherit' });

  for (const { file, find, write } of WRITTEN) {
    const text = readFileSync(file, 'utf8');
    if (!find.test(text)) throw new Error(`${file} does not say what version it is in the way this expects`);
    writeFileSync(file, text.replace(find, write(version)));
  }
  say('chart, appVersion and the HelmRelease pin all moved');

  const body = note || `Version ${version}.`;
  run('git', ['add', 'chart/Chart.yaml', 'deploy/flux/helmrelease.yaml']);
  run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', `Release ${version}\n\n${body}`]);
  run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);
  say(`committed and tagged v${version}`);

  run('git', ['push', 'origin', 'main']);
  run('git', ['push', 'origin', `v${version}`]);
  say('pushed');

  // The release is what builds the image the chart now names. Without it the cluster reconciles
  // against a version that exists in git and nowhere else.
  run('gh', ['release', 'create', `v${version}`, '--title', `v${version}`, '--notes', body]);
  say(`published the release — the image workflow is building ghcr.io/christhomas/ai-world:${version}`);
  say('watch it with: gh run watch $(gh run list --workflow=image.yml --limit 1 --json databaseId -q \'.[0].databaseId\')');
}

main();
