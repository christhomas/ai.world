import creatures from '../../behaviours/creatures.json';
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
const TREES: Record<string, Node<Mind>> = compileAll(creatures as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);

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

/** The tree that decides for this kind of creature, if one does. */
export function treeFor(behaviour: Behaviour): Node<Mind> | null {
  const name = DRIVEN_BY[behaviour];
  return name ? TREES[name] ?? null : null;
}

/** Every tree the game ships, for the test that checks they all compile. */
export function allTrees(): Record<string, Node<Mind>> {
  return TREES;
}
