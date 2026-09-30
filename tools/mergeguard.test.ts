import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { allowances, regressions, usesExpectedBase, exception } = require('./mergeguard.cjs') as {
  allowances: (source: string) => Map<string, number | null>;
  regressions: (base: string, merged: string) => string[];
  usesExpectedBase: (baseSha: string, mergeParentSha: string, mergeParentParents: string[]) => boolean;
  exception: (pulls: { labels?: { name: string }[]; body?: string | null }[]) => string | null;
};

const current = `
import { EXCUSED, isCheckable } from '../../tools/excused';
const ALREADY_LIKE_THIS = 15;
const ALREADY_UNEXPLAINED = 0;
const NAMED_NOWHERE_ALREADY = 0;
expect([...EXCUSED].filter(([, why]) => !isCheckable(why)).map(([name]) => name)).toEqual([]);
expect(orphans.length).toBeLessThanOrEqual(ALREADY_LIKE_THIS);
expect(unexplained.length).toBeLessThanOrEqual(ALREADY_UNEXPLAINED);
expect(never.length).toBeLessThanOrEqual(NAMED_NOWHERE_ALREADY);
`;

describe('the PR merge result, rather than a stale branch alone', () => {
  it('accepts the event base directly or as a parent of a synthetic queue merge', () => {
    expect(usesExpectedBase('base', 'base', ['base', 'older'])).toBe(true);
    expect(usesExpectedBase('base', 'queue', ['queue', 'other', 'base'])).toBe(true);
    expect(usesExpectedBase('base', 'queue', ['queue', 'base', 'other'])).toBe(true);
    expect(usesExpectedBase('base', 'queue', ['queue', 'older', 'other'])).toBe(false);
    expect(usesExpectedBase('base', 'descendant', ['descendant', 'base'])).toBe(false);
  });

  it('accepts the current guard unchanged', () => {
    expect(regressions(current, current)).toEqual([]);
  });

  it('catches #221 restoring the inline excuse list after main removed it', () => {
    const staleMerge = current
      .replace("import { EXCUSED, isCheckable } from '../../tools/excused';", '')
      .concat('\nconst EXPLAINED = new Map();\n');
    expect(regressions(current, staleMerge)).toEqual([
      'reachability bench no longer imports the shared excuse list and its reason guard',
      'inline EXPLAINED excuse list returned',
    ]);
  });

  it('catches a stale merge that raises an allowance or removes its assertion', () => {
    const staleMerge = current.replace('ALREADY_LIKE_THIS = 15', 'ALREADY_LIKE_THIS = 21')
      .replace('expect(never.length).toBeLessThanOrEqual(NAMED_NOWHERE_ALREADY);', '');
    expect(regressions(current, staleMerge)).toEqual([
      'ALREADY_LIKE_THIS rose from 15 to 21',
      'NAMED_NOWHERE_ALREADY is no longer asserted',
    ]);
  });

  it('reads active declarations rather than commented copies', () => {
    const source = `// const ALREADY_LIKE_THIS = 15;\nconst ALREADY_LIKE_THIS = 21;`;
    expect(allowances(source).get('ALREADY_LIKE_THIS')).toBe(21);
  });

  it('requires each ratchet to measure its corresponding count', () => {
    const weakened = current.replace(
      'expect(orphans.length).toBeLessThanOrEqual(ALREADY_LIKE_THIS);',
      'expect(0).toBeLessThanOrEqual(ALREADY_LIKE_THIS);',
    );
    expect(regressions(current, weakened)).toContain('ALREADY_LIKE_THIS is no longer asserted');
  });

  it('requires an active assertion that every excuse is checkable', () => {
    const weakened = current.replace(
      'expect([...EXCUSED].filter(([, why]) => !isCheckable(why)).map(([name]) => name)).toEqual([]);',
      '// expect([...EXCUSED].filter(([, why]) => !isCheckable(why)).map(([name]) => name)).toEqual([]);',
    );
    expect(regressions(current, weakened)).toContain(
      'reachability bench no longer imports the shared excuse list and its reason guard',
    );
  });
});

// A throwaway repository standing in for a push run's checkout: branches, and `origin/main` as the
// remote-tracking ref `actions/checkout` fetches with `fetch-depth: 0`.
const script = fileURLToPath(new URL('./mergeguard.cjs', import.meta.url));
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function quiet(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Never ask GitHub from a test, and never let an outer git (a hook, say) choose the repository.
  for (const name of ['GITHUB_REPOSITORY', 'GH_TOKEN', 'GITHUB_TOKEN', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
    delete env[name];
  }
  return env;
}

function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'mergeguard-'));
  scratch.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: quiet(), encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Guard');
  git('config', 'user.email', 'guard@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const commit = (message: string, files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const guard = () => {
    const event = join(dir, '.git', 'push-event.json');
    writeFileSync(event, JSON.stringify({ ref: 'refs/heads/branch' }));
    const result = spawnSync(process.execPath, [script], {
      cwd: dir, env: { ...quiet(), GITHUB_EVENT_PATH: event }, encoding: 'utf8',
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  return { git, commit, guard };
}

const bench = 'src/world/reachable.test.ts';

describe('a push or dispatch run, which has no pull request to read a base from', () => {
  it('guards a stacked head against origin/main and fails when the stack loosens a ratchet', () => {
    const { git, commit, guard } = repository();
    commit('main', { [bench]: current });
    git('checkout', '-q', '-b', 'bottom');
    commit('bottom of the stack', { 'other.txt': 'bottom\n' });
    git('checkout', '-q', '-b', 'top');
    commit('top loosens', { [bench]: current.replace('ALREADY_LIKE_THIS = 15', 'ALREADY_LIKE_THIS = 21') });
    git('checkout', '-q', 'main');
    const tip = commit('main moves on', { 'elsewhere.txt': 'main\n' });
    git('update-ref', 'refs/remotes/origin/main', tip);
    git('checkout', '-q', 'top');

    const { status, output } = guard();
    expect(output).toContain(`origin/main ${tip}`);
    expect(output).toContain('ALREADY_LIKE_THIS rose from 15 to 21');
    expect(status).toBe(1);
  });

  it('judges the tree that would land, so a branch behind a tightened main is not blamed', () => {
    const { git, commit, guard } = repository();
    commit('main', { [bench]: current });
    git('checkout', '-q', '-b', 'branch');
    commit('unrelated work', { 'other.txt': 'branch\n' });
    git('checkout', '-q', 'main');
    const tip = commit('main tightens', { [bench]: current.replace('ALREADY_LIKE_THIS = 15', 'ALREADY_LIKE_THIS = 12') });
    git('update-ref', 'refs/remotes/origin/main', tip);
    git('checkout', '-q', 'branch');

    // The branch's own file still says 15; comparing it with main's tip alone would call that a rise.
    const { status, output } = guard();
    expect(output).toContain('Merge result keeps the reachability guards and their ratchets.');
    expect(status).toBe(0);
  });

  it('has nothing to guard when the commit is already on main', () => {
    const { git, commit, guard } = repository();
    const tip = commit('main', { [bench]: current });
    git('update-ref', 'refs/remotes/origin/main', tip);

    const { status, output } = guard();
    expect(output).toContain('already on origin/main');
    expect(status).toBe(0);
  });

  it('refuses to pass when origin/main was not fetched', () => {
    const { commit, guard } = repository();
    commit('main', { [bench]: current });

    const { status, output } = guard();
    expect(output).toContain('origin/main');
    expect(status).toBe(1);
  });
});

describe('the maintainer exception', () => {
  const reason = 'Merge guard exception: the bench now counts re-exports it used to miss';

  it('needs both the label and a stated reason on the same request', () => {
    const label = [{ name: 'merge-guard-exception' }];
    expect(exception([{ labels: label, body: reason }])).toBe('the bench now counts re-exports it used to miss');
    expect(exception([{ labels: label, body: 'Merge guard exception: because' }])).toBeNull();
    expect(exception([{ labels: [], body: reason }])).toBeNull();
    expect(exception([{ labels: [], body: reason }, { labels: label, body: null }])).toBeNull();
    expect(exception([])).toBeNull();
  });
});
