import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { allowances, regressions } = require('./mergeguard.cjs') as {
  allowances: (source: string) => Map<string, number | null>;
  regressions: (base: string, merged: string) => string[];
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
