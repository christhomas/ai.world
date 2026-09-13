import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { whatEachSaid, whatShipped } from './release';

/**
 * Which issues a release gets to claim.
 *
 * The rule is a window, not a guess: everything closed since the previous tag went out is in this
 * release, because there was no other release for it to have gone out in. The edges are what this
 * watches — an issue closed before the previous tag already shipped and must not be stamped twice,
 * and an issue closed at the very moment of the previous tag belongs to the one after it.
 */
describe('what a release shipped', () => {
  const closed = [
    { number: 4, closedAt: '2026-09-13T10:46:26Z' },
    { number: 6, closedAt: '2026-09-13T11:21:04Z' },
    { number: 7, closedAt: '2026-09-13T11:25:27Z' },
  ];

  it('claims everything closed since the last release', () => {
    expect(whatShipped(closed, '2026-09-13T11:00:00Z')).toEqual([6, 7]);
  });

  it('claims nothing when nothing has closed since', () => {
    expect(whatShipped(closed, '2026-09-13T12:00:00Z')).toEqual([]);
  });

  it('leaves an issue closed at the moment of the last release to that release', () => {
    expect(whatShipped(closed, '2026-09-13T11:21:04Z')).toEqual([7]);
  });

  it('claims the lot when there was no previous release', () => {
    expect(whatShipped(closed, null)).toEqual([4, 6, 7]);
  });
});

/**
 * And the fault the first version shipped with.
 *
 * The window is honest arithmetic and it still put two different versions on one issue. Four issues
 * fixed in v0.92.3 were *closed* two hours after v0.92.3 was tagged, so the next release's window
 * swept them up and stamped them again — and an issue saying it shipped in two versions is worse
 * than one saying nothing, because now a reader has to decide which line to believe.
 *
 * A close timestamp is a proxy for when a fix shipped and it is a proxy that fails exactly this
 * way. What cannot be argued with is the stamp already on the issue: it was written closer to the
 * event than any later guess, so the first one wins and nothing overwrites it.
 */
describe('an issue that already says which version', () => {
  const closed = [
    { number: 4, closedAt: '2026-09-13T10:46:26Z' },
    { number: 6, closedAt: '2026-09-13T11:21:04Z' },
    { number: 9, closedAt: '2026-09-13T14:05:00Z' },
  ];

  it('is left alone, whatever the window says', () => {
    expect(whatShipped(closed, '2026-09-13T09:34:20Z', new Set([4, 6]))).toEqual([9]);
  });

  it('stamps the whole window when nothing has been stamped', () => {
    expect(whatShipped(closed, '2026-09-13T09:34:20Z', new Set())).toEqual([4, 6, 9]);
  });
});

/**
 * The changelog the release writes, and the README it keeps in step with it.
 *
 * `github-guard` refuses a version tag whose release nobody documented, and it reads the *tagged
 * commit's* files — so a changelog written after the tag is a push that fails, and one written
 * before it is a release that cannot go out undescribed. These check the shapes the guard is
 * looking for, because finding out at `git push` is finding out late.
 */
describe('what a release writes down about itself', () => {
  /*
   * Found from the repository rather than from the working directory.
   *
   * These read two files by relative path, which worked here and failed in the pipeline for three
   * and a half hours across eighteen runs — and failed *quietly*, because `indexOf` answers -1 for
   * a section that is not there and `slice(-1)` is the last character of the file rather than an
   * error. So the test reported "expected '\n' to contain (CHANGELOG.md)", which names the symptom
   * and hides the cause completely.
   *
   * Both halves are fixed: the path is worked out from this file's own location, and a missing
   * section is an error that says which file was read.
   */
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (name: string): string => readFileSync(join(root, name), 'utf8');
  const changelog = read('CHANGELOG.md');
  const readme = read('README.md');

  /** The changelog section of the README, or a failure that says what it looked in. */
  const changelogSection = (): string => {
    const at = readme.indexOf('## Changelog');
    if (at < 0) {
      // say what WAS there, because "the section is missing" is the symptom and the headings are
      // the evidence: a truncated file, a different file and a renamed section look identical
      // otherwise, and this has already cost a day of guessing from a pipeline log
      const headings = [...readme.matchAll(/^## .*$/gm)].map((m) => m[0]).join(' | ');
      throw new Error(`no "## Changelog" in ${join(root, 'README.md')}`
        + ` (${readme.length} bytes, ${readme.split('\n').length} lines)\nheadings: ${headings}`);
    }
    return readme.slice(at);
  };

  it('has a section for every version that has ever been tagged', () => {
    const tagged = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    const written = new Set([...changelog.matchAll(/^## (v\d+\.\d+\.\d+) /gm)].map((m) => m[1]));
    expect(tagged.filter((tag) => !written.has(tag)), 'a release nobody wrote down').toEqual([]);
  });

  it('keeps the README to ten, which is what the guard allows', () => {
    const section = changelogSection();
    const shown = [...section.matchAll(/^### v\d+\.\d+\.\d+ /gm)];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(10);
  });

  it('points the reader at the rest of them', () => {
    const section = changelogSection();
    expect(section, 'ten releases with no way to the other hundred and twenty-six')
      .toContain('(CHANGELOG.md)');
  });

  it('says the same thing in both places about the versions it shows twice', () => {
    // two records of one fact drifting apart is the fault this project finds most often, so the
    // README's ten are rebuilt from the changelog rather than maintained beside it
    const section = changelogSection();
    for (const [, tag, said] of section.matchAll(/^### (v[\d.]+) — \S+\n\n(.+)$/gm)) {
      const full = changelog.match(new RegExp(`^## ${tag.replace(/\./g, '\\.')} — \\S+\\n\\n(.+)$`, 'm'));
      expect(full, `${tag} is in the README and not in the changelog`).not.toBeNull();
      expect(said.trim()).toBe(full![1].trim());
    }
  });
});

/**
 * What the README's front page says a release was.
 *
 * The README carries the ten most recent entries and the changelog carries all of them, which is
 * two records of one fact — the fault this project finds most often — so the ten are *rebuilt* from
 * the changelog every release rather than maintained beside it. That was the right shape and it
 * quietly stopped working: every entry on the front page read "No note was written for this one",
 * including the ones plainly written with notes, and it had been that way for eleven releases.
 *
 * The cause is one character. The entry was matched with `([\s\S]*?)(?=\n## v|$)` under the `m`
 * flag, where `$` is the end of a *line* rather than the end of the text — so the lazy body gave up
 * at the first line ending it met, which is the blank line under the heading, and every entry came
 * back empty.
 *
 * It passed unnoticed because the release runs the suite *before* it writes these files, so the
 * thing it breaks is never the thing it checked. The test below reads a changelog rather than the
 * repository's, so it is about the rule instead of about today's release.
 */
describe('what the README says a release was', () => {
  const log = [
    '# Changelog', '', 'Some words about the file itself.', '',
    '## v0.3.0 — 2026-09-13', '', 'A villager gets round the back of his own house', '',
    '- Exhaust one side of an obstacle before trying the other (#83)', '',
    '## v0.2.0 — 2026-09-12', '', 'The shrine takes its fee by name', '',
    '## v0.1.0 — 2026-09-01', '', 'The first one', '',
  ].join('\n');

  it('is the line that release opens with, not an apology for not finding one', () => {
    expect(whatEachSaid(log).map((e) => e.said)).toEqual([
      'A villager gets round the back of his own house',
      'The shrine takes its fee by name',
      'The first one',
    ]);
  });

  it('keeps the tag and the day beside it', () => {
    expect(whatEachSaid(log)[0]).toEqual({
      tag: 'v0.3.0', when: '2026-09-13', said: 'A villager gets round the back of his own house',
    });
  });

  it('reads the last entry in the file, which is the one a line-ending rule loses', () => {
    // the oldest release sits at the end of the text with nothing after it, and it is the case
    // that tells an end-of-text rule from an end-of-line one
    expect(whatEachSaid(log).at(-1)?.tag).toBe('v0.1.0');
  });

  it('says so plainly when a release really was written with no note', () => {
    const bare = ['# Changelog', '', '## v0.4.0 — 2026-09-14', '', '- Something (#1)', ''].join('\n');
    expect(whatEachSaid(bare)[0]?.said).toBe('- Something (#1)');
  });
});
