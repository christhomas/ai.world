import { describe, expect, it } from 'vitest';
import villagers from '../../behaviours/villagers.json';

/**
 * Everybody has somewhere to be at midnight.
 *
 * A village at two in the morning had as many people on its street as at noon, which is the loudest
 * thing that can be wrong with a village as a picture. The cause was not the clock and not the
 * houses: it was that two of the days in `behaviours/villagers.json` simply ran out. A tree whose
 * last branch is an hour is a tree that decides nothing outside that hour — no branch claims the
 * tick, and a man who has been down a mine since dawn wanders the street until sunrise.
 *
 * So this is a shape test on the file rather than a simulation: **every day ends in a bed**. It is
 * the kind of thing that is obvious when it is written down and invisible when it is not, and it
 * will be invisible again the next time somebody adds a trade.
 */

/** The trades that are a day in a village. The others are somebody else's hours. */
const APART: Record<string, string> = {
  // bought and paid for: he is at the shoulder of whoever is paying, wherever that is at midnight
  hired: 'a hired sword keeps his employer\'s hours, not the village\'s',
  // a shift at the rock face does not know what the sky is doing, and the mine is not the street
  facework: 'a shift underground has no hour in it at all',
};

const trees = villagers as unknown as Record<string, { first?: unknown[] }>;

describe('a villager\'s day', () => {
  it('ends at their own front door', () => {
    const homeless: string[] = [];
    for (const [trade, tree] of Object.entries(trees)) {
      if (trade in APART) continue;
      const branches = tree.first ?? [];
      const last = JSON.stringify(branches[branches.length - 1] ?? {});
      // the last branch is the one that claims every hour the others did not, so it is the one
      // that has to be a bed
      if (!last.includes('"home"')) homeless.push(trade);
    }
    expect(homeless, 'these trades have nowhere to be at midnight, so they walk about all night').toEqual([]);
  });

  it('has an unconditional last branch, or the hours it does not name decide nothing', () => {
    for (const [trade, tree] of Object.entries(trees)) {
      if (trade in APART) continue;
      const branches = (tree.first ?? []) as Array<Record<string, unknown>>;
      const last = branches[branches.length - 1] ?? {};
      expect(last.when, `${trade}'s day ends on a branch with an hour on it`).toBeUndefined();
    }
  });

  it('covers everybody in a street, including the ones with no trade at all', () => {
    /*
     * The elder, whoever keeps the horses, and every face that is only a face. They had no tree of
     * their own, so they fell through to the one that drives a wandering animal — which wanders at
     * three in the morning exactly as it does at noon. `treeNameFor` finds this one by the kind's
     * own name, which is what makes it reachable without anybody being given a trade they do not
     * have.
     */
    expect(trees.villager, 'nothing decides the day of somebody with no trade').toBeDefined();
  });

  it('says why, for the two that keep somebody else\'s hours', () => {
    // a list of exceptions with no reasons beside them is a list that grows
    for (const trade of Object.keys(APART)) expect(trees[trade], `${trade} is not in the file`).toBeDefined();
  });
});
