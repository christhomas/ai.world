import { describe, expect, it } from 'vitest';
import creatures from '../../behaviours/creatures.json';
import { Memory } from '../core/behaviour';
import { BehaviourError, compile, compileAll, type BehaviourFile, type Spec } from '../core/behaviourFile';
import { CREATURE_VERBS, rollSeconds, type Mind } from './verbs';
import { allTrees, treeFor } from './behaviours';

/**
 * The files are data, so nothing stops somebody writing nonsense in one. What stops it reaching a
 * player is this: every file the game ships is compiled here, and a bad name or a broken node is
 * a failed build with the path to the node that is wrong.
 */
describe('the behaviour files', () => {
  it('all compile against the verbs the game declares', () => {
    const trees = compileAll(creatures as BehaviourFile, CREATURE_VERBS, rollSeconds);
    expect(Object.keys(trees).length).toBeGreaterThan(0);
    for (const tree of Object.values(trees)) expect(typeof tree).toBe('function');
  });

  it('are reachable from the behaviours the creatures declare', () => {
    expect(treeFor('circle')).not.toBeNull();
    expect(treeFor('graze')).toBeNull();          // still runs the older path, and that is allowed
    expect(Object.keys(allTrees())).toContain('seaHunter');
  });

  it('carry their notes, so a reader is told why rather than only what', () => {
    const noted = JSON.stringify(creatures).match(/"note"/g) ?? [];
    expect(noted.length).toBeGreaterThan(3);
  });
});

describe('a file that is wrong', () => {
  const compileIt = (spec: unknown) => () => compile(spec as Spec, CREATURE_VERBS, rollSeconds, 'test');

  it('names the verb it does not know, and what it could have said instead', () => {
    expect(compileIt({ do: 'dance' })).toThrow(BehaviourError);
    expect(compileIt({ do: 'dance' })).toThrow(/no such action "dance"/);
    expect(compileIt({ do: 'dance' })).toThrow(/circle/);        // the list of what is known
    expect(compileIt({ ask: 'happy' })).toThrow(/no such question "happy"/);
  });

  it('points at the node that is wrong, not just at the file', () => {
    const spec = { first: [{ do: 'idle' }, { latch: [{ do: 'nonsense' }] }] };
    expect(compileIt(spec)).toThrow(/test\.first\[1\]\.latch\[0\]/);
  });

  it('refuses an empty branch and a thing that is not a node at all', () => {
    expect(compileIt({ first: [] })).toThrow(/needs a list/);
    expect(compileIt({ nonsense: true })).toThrow(/not a node/);
    expect(compileIt({ wait: [1, 2, 3] })).toThrow(/a number or a pair/);
  });
});

describe('a tree read from a file', () => {
  it('does what the file says, in the order the file says it', () => {
    const log: string[] = [];
    const vocabulary = {
      questions: { yes: () => () => true, no: () => () => false },
      actions: {
        note: (params: { what?: unknown }) => () => { log.push(String(params.what)); return 'success' as const; },
      },
    };
    const tree = compile(
      { first: [{ when: { ask: 'no' }, then: { do: 'note', with: { what: 'wrong' } } }, { do: 'note', with: { what: 'right' } }] } as Spec,
      vocabulary as never,
      () => 0,
    );
    tree({ world: {} as Mind, dt: 0.1, memory: new Memory() });
    expect(log).toEqual(['right']);
  });
});
