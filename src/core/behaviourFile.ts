import {
  act, always, check, every, fail, latch, not, selector, sequence, steps, succeed, wait, when,
  type Node, type Tick,
} from './behaviour';

/**
 * Behaviours as files.
 *
 * The shape of a decision is data — which is worth reading, worth arguing about, and worth seeing
 * in a diff as "the sharks now wait longer between runs" rather than as a changed number three
 * screens into a source file. So a tree lives in JSON, committed beside the code, and anybody can
 * open it and change what a creature does without touching TypeScript.
 *
 * What stays in code is the vocabulary. `charge` has to know about tiles and hit points and the
 * hero's boat; no amount of JSON will express that, and pretending otherwise only moves the real
 * work somewhere it cannot be typed. So a file may only use verbs the game has declared, and
 * asking for one that does not exist is an error with the path to the node that asked.
 *
 * JSON rather than YAML on purpose: the browser and the tests both read it without a parser, and
 * a `note` on any node carries the comment that JSON otherwise lacks.
 */

/** One node as it appears in a file. */
export type Spec =
  | { do: string; with?: Params; note?: string }
  | { ask: string; with?: Params; note?: string }
  | { all: Spec[]; note?: string }
  | { steps: Spec[]; note?: string }
  | { first: Spec[]; note?: string }
  | { latch: Spec[]; note?: string }
  | { when: Spec; then: Spec; note?: string }
  | { not: Spec; note?: string }
  | { anyway: Spec; note?: string }
  | { wait: Range; note?: string }
  | { every: Range; then: Spec; note?: string };

/** A number, or a range to be rolled between — `4` or `[4, 9]`. */
export type Range = number | [number, number];

export type Params = Record<string, number | string | boolean | [number, number]>;

/**
 * What a file may say. An action does something and may take its time; a question answers yes or
 * no. Both are given the tick and whatever parameters the file wrote beside them.
 */
export interface Vocabulary<W> {
  actions: Record<string, (params: Params) => Node<W>>;
  questions: Record<string, (params: Params) => (tick: Tick<W>) => boolean>;
}

/** Where the trees for one subject live: a name for each. */
export type BehaviourFile = Record<string, Spec>;

/** Rolling a range needs the world's own generator, so two machines roll the same. */
export type Roller<W> = (tick: Tick<W>, low: number, high: number) => number;

export class BehaviourError extends Error {
  constructor(where: string, why: string) {
    super(`${where}: ${why}`);
    this.name = 'BehaviourError';
  }
}

/**
 * Turn a file's worth of trees into behaviours.
 *
 * Every name is checked here, at load, so a misspelt verb is a clear error with the path to it
 * rather than a creature that quietly stands still. The tests load every file the game ships, so
 * that error lands in the build and not in somebody's game.
 */
export function compileAll<W>(file: BehaviourFile, vocabulary: Vocabulary<W>, roll: Roller<W>): Record<string, Node<W>> {
  const out: Record<string, Node<W>> = {};
  for (const [name, spec] of Object.entries(file)) out[name] = compile(spec, vocabulary, roll, name);
  return out;
}

export function compile<W>(spec: Spec, vocabulary: Vocabulary<W>, roll: Roller<W>, where = 'behaviour'): Node<W> {
  const kids = (list: Spec[], what: string): Array<Node<W>> => {
    if (!Array.isArray(list) || list.length === 0) throw new BehaviourError(where, `"${what}" needs a list of at least one node`);
    return list.map((child, i) => compile(child, vocabulary, roll, `${where}.${what}[${i}]`));
  };
  const seconds = (range: Range): ((tick: Tick<W>) => number) => {
    if (typeof range === 'number') return () => range;
    if (!Array.isArray(range) || range.length !== 2) throw new BehaviourError(where, 'a time is a number or a pair of numbers');
    return (tick) => roll(tick, range[0], range[1]);
  };

  if ('do' in spec && typeof spec.do === 'string') {
    const make = vocabulary.actions[spec.do];
    if (!make) throw new BehaviourError(where, `no such action "${spec.do}". Known: ${Object.keys(vocabulary.actions).sort().join(', ')}`);
    return make(spec.with ?? {});
  }
  if ('ask' in spec) {
    const make = vocabulary.questions[spec.ask];
    if (!make) throw new BehaviourError(where, `no such question "${spec.ask}". Known: ${Object.keys(vocabulary.questions).sort().join(', ')}`);
    return check(make(spec.with ?? {}));
  }
  if ('all' in spec) return sequence(...kids(spec.all, 'all'));
  if ('steps' in spec) return steps(...kids(spec.steps, 'steps'));
  if ('first' in spec) return selector(...kids(spec.first, 'first'));
  if ('latch' in spec) return latch(...kids(spec.latch, 'latch'));
  if ('when' in spec) {
    const question = compile(spec.when, vocabulary, roll, `${where}.when`);
    const then = compile(spec.then, vocabulary, roll, `${where}.then`);
    return when((tick) => question(tick) === 'success', then);
  }
  if ('not' in spec) return not(compile(spec.not, vocabulary, roll, `${where}.not`));
  if ('anyway' in spec) return always(compile(spec.anyway, vocabulary, roll, `${where}.anyway`));
  if ('wait' in spec) return wait(seconds(spec.wait));
  if ('every' in spec) return every(seconds(spec.every), compile(spec.then, vocabulary, roll, `${where}.every`));

  throw new BehaviourError(where, `not a node: ${JSON.stringify(spec).slice(0, 80)}`);
}

/** Nodes that do nothing, for a file that wants to say so plainly. */
export const NOTHING = { succeed, fail };
