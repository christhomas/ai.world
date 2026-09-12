import { describe, expect, it } from 'vitest';
import creatures from '../../behaviours/creatures.json';
import villagers from '../../behaviours/villagers.json';
import { Memory } from '../core/behaviour';
import { BehaviourError, compile, compileAll, type BehaviourFile, type Spec } from '../core/behaviourFile';
import { CREATURE_VERBS, rollSeconds, type Mind } from './verbs';
import { allTrees, tradeTree, treeFor } from './behaviours';
import { TRADES } from './trades';

/**
 * The files are data, so nothing stops somebody writing nonsense in one. What stops it reaching a
 * player is this: every file the game ships is compiled here, and a bad name or a broken node is
 * a failed build with the path to the node that is wrong.
 */
describe('the behaviour files', () => {
  it('all compile against the verbs the game declares', () => {
    const trees = compileAll(creatures as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);
    expect(Object.keys(trees).length).toBeGreaterThan(0);
    for (const tree of Object.values(trees)) expect(typeof tree).toBe('function');
  });

  it('cover every kind of creature the game has', () => {
    for (const behaviour of ['graze', 'wander', 'travel', 'hop', 'swim', 'prowl', 'hunt', 'fly', 'circle'] as const) {
      expect(treeFor({ kind: { behaviour } }), `nothing decides for a ${behaviour} creature`).not.toBeNull();
    }
  });

  it('cover every trade a villager can have', () => {
    // asked of the trades themselves rather than of a list written out here, because a list beside
    // a list is a list that falls out of step: a trade added to `TRADES` with no day written for it
    // is a villager who potters about the square, which is what a logger did the night he arrived
    for (const trade of TRADES) {
      expect(tradeTree(trade.id), `nobody knows how to be a ${trade.label}`).not.toBeNull();
    }
  });

  it('send a logger out to the trees and keep him there all day', () => {
    /*
     * The one trade whose day had to be written after the trade was. What is worth pinning is the
     * shape rather than the hours: he walks to the wood, he works it, and he brings nothing back —
     * because what he cut is landed in the village's yard once a day by `builderDay`, exactly as a
     * miner's gold is minted by `mines.ts` rather than carried home in his hands. A `take` or a
     * `sell` anywhere in here would stack the same wood twice.
     */
    const day = JSON.stringify(villagers.logger);
    expect(day).toContain('"woods"');
    expect(day, 'a logger who walks to the trees and does not cut them').toContain('"dig"');
    expect(day, 'he is carrying timber as well as having cut it').not.toContain('"take"');
    expect(day, 'he is selling the same wood the yard already counted').not.toContain('"sell"');
    // and a day with no way home ends with a man walking the street until sunrise, which is how
    // the miner's own missing branch was found
    expect(day).toContain('"home"');
  });

  it('let a trade outrank a species: a hunter is a hunter before they are a villager', () => {
    const villager = { kind: { behaviour: 'wander' as const } };
    expect(treeFor(villager)).toBe(tradeTree('wanderer'));
    expect(treeFor({ ...villager, trade: 'hunter' })).toBe(tradeTree('hunter'));
    // and a trade nobody has written a day for falls back to the species
    expect(treeFor({ ...villager, trade: 'astronaut' })).toBe(tradeTree('wanderer'));
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
