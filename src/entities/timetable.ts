import type { Params, Spec } from '../core/behaviourFile';
import type { Post } from './entity';

/**
 * Asking a behaviour file what it says, rather than running it to find out.
 *
 * A compiled tree is a closure. You can tick it and learn nothing else about it — not how far a
 * wanderer wanders, not what hours an innkeeper keeps — which is exactly right while ticking is all
 * anybody wants and no use at all to `unwatched.ts`, whose whole job is to answer what a long
 * stretch of a behaviour comes to without ticking any of it.
 *
 * The answer to both of those questions is already written down, in `behaviours/`. `wander: {
 * tiles: 4 }` is how far a wanderer wanders. `hourBetween: { from: 0.24, to: 0.95 }` over `goTo:
 * { post: 'inn' }` is the innkeeper's day. So this reads them back out of the same file the game
 * compiles, and the alternative — a second table in TypeScript saying how far a wanderer wanders —
 * is the exact shape of thing that is right the day it is written and wrong the first time somebody
 * changes a number in the JSON and does not know there was a copy of it.
 *
 * What it does *not* try to do is evaluate a tree. It answers about the branches whose conditions
 * are facts of the calendar — an hour is an hour whether or not anybody is there for it — and steps
 * over every branch that turns on somebody being present: a wound, a purse, prey within seven
 * tiles, the law wanting the hero. That is a real limitation and it is the coarse tier's premise
 * stated out loud: with nobody about, those branches do not fire, so what a tree does with nobody
 * about is what is left when they are taken away.
 */

const number = (params: Params | undefined, key: string, fallback: number): number =>
  (params && typeof params[key] === 'number' ? params[key] : fallback);

/** The children of a node that is a list of branches, or the node itself if it is one branch. */
function branches(spec: Spec): Spec[] {
  if ('first' in spec) return spec.first;
  if ('latch' in spec) return spec.latch;
  if ('steps' in spec) return spec.steps;
  if ('all' in spec) return spec.all;
  return [spec];
}

/**
 * How far this tree lets something range about its anchor, in tiles.
 *
 * Depth-first for the first `wander` or `roam` in the tree, because in every tree that has one it
 * is the branch reached when there is nobody about — which is the only branch anybody asking this
 * question cares about.
 */
export function rangeIn(spec: Spec): number | null {
  if ('do' in spec) {
    if (spec.do === 'wander' || spec.do === 'roam') return number(spec.with, 'tiles', 5);
    return null;
  }
  if ('when' in spec) return rangeIn(spec.then);
  if ('every' in spec) return rangeIn(spec.then);
  if ('not' in spec) return rangeIn(spec.not);
  if ('anyway' in spec) return rangeIn(spec.anyway);
  if ('wait' in spec || 'ask' in spec) return null;
  for (const child of branches(spec)) {
    const found = rangeIn(child);
    if (found !== null) return found;
  }
  return null;
}

/** The `tiles` of the first `patrol` in a tree: the ring a flier keeps to. NaN if it never circles. */
export function ringIn(spec: Spec): number {
  if ('do' in spec) return spec.do === 'patrol' ? number(spec.with, 'tiles', 4) : Number.NaN;
  if ('when' in spec || 'every' in spec) return ringIn(spec.then);
  if ('anyway' in spec) return ringIn(spec.anyway);
  if ('wait' in spec || 'ask' in spec || 'not' in spec) return Number.NaN;
  for (const child of branches(spec)) {
    const found = ringIn(child);
    if (!Number.isNaN(found)) return found;
  }
  return Number.NaN;
}

/** Where an hour puts somebody: at a post, ranging about the anchor, or nowhere in particular. */
export interface Duty {
  /** The post the hour sends them to, if it sends them anywhere. */
  post: Post | null;
  /** Through their own front door, so they are not on the street at all. */
  enter: boolean;
  /** How far they range about it. Nought is standing at the post itself. */
  ranges: number;
}

/**
 * The first thing in a branch that decides where somebody is.
 *
 * Two different rules, and the difference is the whole of what makes this honest. Descending into a
 * `first`, it takes the **last** child: the guards inside one are about purses, wounds and who is
 * carrying what, none of which can be known from outside, and the last child of a selector is the
 * one that fires when the others do not. Descending into a `steps` or a `latch`, it takes the
 * **first** child that says anything, because those run in order and the first `goTo` in one is
 * where the branch begins — a hunter's day starts by walking to the woods whatever it does after.
 */
function whereIn(spec: Spec): Duty | null {
  if ('do' in spec) {
    if (spec.do === 'goTo') {
      return { post: String(spec.with?.post ?? 'square') as Post, enter: spec.with?.enter === true, ranges: 0 };
    }
    if (spec.do === 'wander' || spec.do === 'roam') {
      return { post: null, enter: false, ranges: number(spec.with, 'tiles', 5) };
    }
    return null;
  }
  if ('when' in spec) return whereIn(spec.then);
  if ('every' in spec) return whereIn(spec.then);
  if ('anyway' in spec) return whereIn(spec.anyway);
  if ('first' in spec) return whereIn(spec.first[spec.first.length - 1]);
  if ('latch' in spec || 'steps' in spec || 'all' in spec) {
    for (const child of branches(spec)) {
      const found = whereIn(child);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Is this the window `hourBetween` would say yes to? Wraps round midnight, exactly as the verb does. */
function withinHours(params: Params | undefined, time: number): boolean {
  const from = number(params, 'from', 0), to = number(params, 'to', 1);
  return from <= to ? time >= from && time < to : time >= from || time < to;
}

/**
 * What this tree's day says about this hour.
 *
 * The top-level branches are walked in the order the file writes them, which is the order the
 * selector tries them, and the first one whose hour matches decides — even if what it decides is
 * "something that is not a posting", in which case this returns null and the caller falls back to
 * ranging. That last clause is the one that matters: an explorer's daytime branch is `roam`, not a
 * post, and a reader who skipped it and fell through to the unguarded `goTo home` at the bottom
 * would have every explorer in the world asleep at noon.
 *
 * Branches guarded by anything else — a wound, a purse, somebody being savaged, the law wanting the
 * hero — are stepped over, for the reason at the head of this file.
 */
export function dutyAt(spec: Spec, time: number): Duty | null {
  for (const child of branches(spec)) {
    if ('when' in child) {
      const guard = child.when;
      if (!('ask' in guard) || guard.ask !== 'hourBetween') continue;
      if (!withinHours(guard.with, time)) continue;
      return whereIn(child.then);
    }
    // an unguarded `goTo` at the bottom of a day: where somebody is when no hour has claimed them
    if ('do' in child && child.do === 'goTo') return whereIn(child);
  }
  return null;
}
