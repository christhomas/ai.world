import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { regressions } = require('./mergeguard.cjs') as { regressions: (base: string, merged: string) => string[] };

const current = `
import { EXCUSED, isCheckable } from '../../tools/excused';
const ALREADY_LIKE_THIS = 15;
const ALREADY_UNEXPLAINED = 0;
const NAMED_NOWHERE_ALREADY = 0;
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
});
