import creatures from '../../behaviours/creatures.json';
import villagers from '../../behaviours/villagers.json';
import monsters from '../../behaviours/monsters.json';
import villain from '../../behaviours/villain.json';
import { compileAll, type BehaviourFile, type Spec } from '../core/behaviourFile';
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
const TREES: Record<string, Node<Mind>> = compileBehaviours({
  'behaviours/creatures.json': creatures,
  'behaviours/villagers.json': villagers,
  'behaviours/monsters.json': monsters,
  'behaviours/villain.json': villain,
});

/**
 * Every tree in a set of behaviour files, compiled against the verbs the game declares. A later file
 * wins a name an earlier one also uses. The content catalogue (#624) compiles a proposed set with
 * this before publishing it, so a misspelt verb is refused rather than shipped.
 */
export function compileBehaviours(files: Readonly<Record<string, unknown>>): Record<string, Node<Mind>> {
  return Object.assign({}, ...Object.values(files).map((file) =>
    compileAll(file as BehaviourFile, CREATURE_VERBS, rollSeconds)));
}

/**
 * The same trees before they were compiled, under the same names.
 *
 * A compiled tree is a closure: you can run it and you can learn nothing else about it. That was
 * fine while running it was the only thing anybody wanted, and it stopped being fine when
 * `unwatched.ts` had to answer what a week of one *does* — because the honest answer is written in
 * the file already. How far a wanderer ranges is `wander: { tiles: 4 }`; what hours an innkeeper
 * keeps is the `hourBetween` on his first branch. Reading those back out of the file means the
 * long-run form cannot drift away from the behaviour: change the number in the JSON and both
 * halves change together, because there is only one number.
 *
 * The alternative was a second table in TypeScript saying how far a wanderer wanders, which is the
 * exact shape of thing that is right the day it is written and wrong a month later.
 */
const SPECS: Record<string, Spec> = {
  ...(creatures as unknown as BehaviourFile),
  ...(villagers as unknown as BehaviourFile),
  ...(monsters as unknown as BehaviourFile),
  ...(villain as unknown as BehaviourFile),
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

/** Enough of a creature to work out what decides for it. */
export type Decider = { trade?: string; kind: { id?: string; behaviour: Behaviour } };

/**
 * Which tree decides for this creature, by name.
 *
 * A villager with a trade follows their trade's day; everything else follows the tree for its kind.
 * A person's job outranks their species, which is as it should be — a hunter is a hunter before
 * they are a villager.
 *
 * The rule lives here, as a name, and everything else is written in terms of it: two lookups that
 * have to agree about which tree a creature follows are two lookups that will one day disagree.
 * Anything that wants to say something about a behaviour rather than run it — what a week of it
 * does, most of all — needs the name, since a compiled tree cannot be asked what it is.
 */
export function treeNameFor(e: Decider): string | null {
  return treeNameIn(TREES, e);
}

/** The same question asked of a set of trees that is not the game's own, such as a proposed one. */
export function treeNameIn(trees: Readonly<Record<string, unknown>>, e: Decider): string | null {
  // a villager with a trade follows their trade's day: a hunter is a hunter before they are a
  // villager
  if (e.trade && trees[e.trade]) return e.trade;
  // a creature with a tree under its own name is driven by that: the trade rule, one step down.
  // It is how an ogre stops being a generic prowler without a new kind of lookup.
  if (e.kind.id && trees[e.kind.id]) return e.kind.id;
  const byKind = DRIVEN_BY[e.kind.behaviour];
  return byKind && trees[byKind] ? byKind : null;
}

/** What decides for this creature, compiled and ready to tick. */
export function treeFor(e: Decider): Node<Mind> | null {
  const name = treeNameFor(e);
  return name === null ? null : TREES[name];
}

/** What the file says this creature does, unrun. Null when nothing decides for it. */
export function specFor(e: Decider): Spec | null {
  const name = treeNameFor(e);
  return name === null ? null : SPECS[name] ?? null;
}

/** One named tree as it was written down. */
export function specNamed(name: string): Spec | null {
  return SPECS[name] ?? null;
}

/** Every tree the game ships, for the test that checks they all compile. */
export function allTrees(): Record<string, Node<Mind>> {
  return TREES;
}
