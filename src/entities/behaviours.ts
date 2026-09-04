import creatures from '../../behaviours/creatures.json';
import villagers from '../../behaviours/villagers.json';
import monsters from '../../behaviours/monsters.json';
import villain from '../../behaviours/villain.json';
import { compileAll, type BehaviourFile } from '../core/behaviourFile';
import { CREATURE_VERBS, rollSeconds, type Mind } from './verbs';
import type { Node } from '../core/behaviour';
import type { Behaviour } from './animals';

/**
 * The creature behaviours, read from `behaviours/creatures.json` and checked against the verbs
 * the game declares. A misspelt verb or a malformed node throws here, at load, naming the path to
 * the node that is wrong — and `behaviours.test.ts` loads the same files, so it lands in the
 * build rather than in somebody's game.
 *
 * Every kind of creature is driven from the file now. What is left in entity.ts is movement,
 * animation and the consequences of being hit: mechanism, not decisions.
 */
const TREES: Record<string, Node<Mind>> = {
  ...compileAll(creatures as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds),
  ...compileAll(villagers as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds),
  ...compileAll(monsters as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds),
  ...compileAll(villain as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds),
};

/** Which behaviour kind is driven by which tree. Every kind of creature has one. */
const DRIVEN_BY: Record<Behaviour, string> = {
  graze: 'grazer',
  wander: 'wanderer',
  travel: 'traveller',
  hop: 'hopper',
  swim: 'swimmer',
  prowl: 'prowler',
  hunt: 'monster',
  fly: 'flier',
  circle: 'seaHunter',
};

/**
 * What decides for this creature. A villager with a trade follows their trade's day; everything
 * else follows the tree for its kind. A person's job outranks their species, which is as it
 * should be — a hunter is a hunter before they are a villager.
 */
export function treeFor(e: { trade?: string; kind: { id?: string; behaviour: Behaviour } }): Node<Mind> | null {
  if (e.trade) {
    const trade = TREES[e.trade];
    if (trade) return trade;
  }
  // a creature with a tree under its own name is driven by that: the trade rule, one step down.
  // It is how an ogre stops being a generic prowler without a new kind of lookup.
  const own = e.kind.id ? TREES[e.kind.id] : undefined;
  if (own) return own;
  return TREES[DRIVEN_BY[e.kind.behaviour]] ?? null;
}

/** The tree for one named trade, for anything that wants to ask directly. */
export function tradeTree(name: string): Node<Mind> | null {
  return TREES[name] ?? null;
}

/** Every tree the game ships, for the test that checks they all compile. */
export function allTrees(): Record<string, Node<Mind>> {
  return TREES;
}
