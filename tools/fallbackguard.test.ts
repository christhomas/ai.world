import { describe, expect, it } from 'vitest';
import { theTidyUp, whatIsDirty } from './fallbackguard';

/**
 * The two rules that stand between a codemod and somebody's afternoon.
 *
 * `chore fallbacks` rewrites every file in the repository and puts them back with `git checkout`,
 * which is a destructive command aimed at a whole tree. Everything about when it may fire and what
 * it is told is dirty therefore has to be tested, and none of it was: the sweep's own recovery was
 * three reviewers' worth of P1 findings, all of the same shape — *this can delete work that was
 * never ours*.
 */

describe('what git says is dirty', () => {
  it('keeps a path with a space in it whole', () => {
    expect(whatIsDirty(' M src/world/a file.ts\0M  server/b.ts\0')).toEqual([
      { status: ' M', path: 'src/world/a file.ts' },
      { status: 'M ', path: 'server/b.ts' },
    ]);
  });

  it('reads the path past a status column of either width', () => {
    // ' M' and 'MM' and '??' are all two columns and a space; a fixed offset ate the first letter
    // of some paths and not others, which is how a real path became an unreadable one
    expect(whatIsDirty('?? src/new.ts\0MM src/both.ts\0')).toEqual([
      { status: '??', path: 'src/new.ts' },
      { status: 'MM', path: 'src/both.ts' },
    ]);
  });

  it('takes both ends of a rename, because both of them have to go back', () => {
    // and the far end carries the rename's own status rather than an empty one: it has no record of
    // its own in the porcelain, and a caller asking "how is this dirty" about it would otherwise be
    // told nothing at all
    expect(whatIsDirty('R  src/to.ts\0src/from.ts\0')).toEqual([
      { status: 'R ', path: 'src/to.ts' },
      { status: 'R ', path: 'src/from.ts' },
    ]);
  });

  it('is nothing at all for a clean tree', () => {
    expect(whatIsDirty('')).toEqual([]);
  });
});

describe('when the sweep is allowed to put files back', () => {
  it('does nothing for a signal that arrives before it has touched anything', () => {
    let put = 0;
    const tidy = theTidyUp(() => { put++; });
    expect(tidy.signalled()).toBe(false);
    expect(put).toBe(0);
  });

  it('puts them back for a signal once it owns the tree', () => {
    let put = 0;
    const tidy = theTidyUp(() => { put++; });
    tidy.own();
    expect(tidy.signalled()).toBe(true);
    expect(put).toBe(1);
  });

  it('does nothing once it has already finished and let go', () => {
    let put = 0;
    const tidy = theTidyUp(() => { put++; });
    tidy.own();
    tidy.finished();
    expect(tidy.signalled()).toBe(false);
    expect(put).toBe(0);
  });
});
