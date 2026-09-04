/**
 * A small algebra for writing down decisions.
 *
 * Everything in this game that chooses something — a shark deciding whether to circle or charge,
 * a villager deciding whether to be at work or at home, the Enter key deciding which of a dozen
 * things is in front of you — is the same shape of problem: try things in an order, keep doing
 * one until it finishes, do a few in sequence, wait a while, do it again.
 *
 * So a behaviour is a value you compose rather than a function you write. It is one line to read
 * a creature's whole mind, and a new kind of creature is a new composition rather than six edits
 * scattered through an update loop.
 *
 * Deliberately not included: anything that needs to allocate per tick, and any randomness of its
 * own. A world that must look identical on two machines cannot have its behaviours rolling dice
 * the caller does not control, so the seeded generator comes in through the context.
 */

/**
 * What a node reports when it runs.
 * - `success` — it did its thing, and the parent may move on
 * - `failure` — it could not, and the parent should try something else
 * - `running` — it is part way through and wants the next tick as well
 */
export type Status = 'success' | 'failure' | 'running';

/** Somewhere for a node to keep what it knows between ticks, without touching the agent itself. */
export class Memory {
  private readonly slots = new Map<symbol, unknown>();

  get<T>(key: symbol, fallback: T): T {
    const held = this.slots.get(key);
    return held === undefined ? fallback : held as T;
  }

  set<T>(key: symbol, value: T): void {
    this.slots.set(key, value);
  }

  clear(key: symbol): void {
    this.slots.delete(key);
  }

  /** Forget everything: the agent has been put away, or has changed its mind entirely. */
  wipe(): void {
    this.slots.clear();
  }
}

/** What every node is handed: who is deciding, what they know, how long since the last tick. */
export interface Tick<W> {
  world: W;
  dt: number;
  memory: Memory;
}

/** A decision. Give it a tick, it tells you how it went. */
export type Node<W> = (tick: Tick<W>) => Status;

// --- leaves ---

/**
 * Do something. Returning nothing means it is done; returning a status says otherwise, which is
 * how a leaf says "I am not finished, come back next tick".
 */
export function act<W>(what: (tick: Tick<W>) => Status | void): Node<W> {
  return (tick) => what(tick) ?? 'success';
}

/** Ask a question. True is success, false is failure, and nothing is done either way. */
export function check<W>(question: (tick: Tick<W>) => boolean): Node<W> {
  return (tick) => (question(tick) ? 'success' : 'failure');
}

/** Never finishes. Useful as the last word in a selector: "and otherwise, keep doing this". */
export function forever<W>(what: (tick: Tick<W>) => void): Node<W> {
  return (tick) => { what(tick); return 'running'; };
}

export function succeed<W>(): Node<W> {
  return () => 'success';
}

export function fail<W>(): Node<W> {
  return () => 'failure';
}

// --- composites ---

/**
 * Try each in turn until one succeeds or is still going: the first thing that works, wins.
 * This is the shape of nearly every decision — "if you can do this, do it, otherwise try that".
 */
export function selector<W>(...children: Array<Node<W>>): Node<W> {
  return (tick) => {
    for (const child of children) {
      const status = child(tick);
      if (status !== 'failure') return status;
    }
    return 'failure';
  };
}

/** Do all of them in order, stopping at the first that fails or is still going. */
export function sequence<W>(...children: Array<Node<W>>): Node<W> {
  return (tick) => {
    for (const child of children) {
      const status = child(tick);
      if (status !== 'success') return status;
    }
    return 'success';
  };
}

/**
 * A sequence that remembers where it got to. Where `sequence` re-runs every step from the first
 * each tick, this resumes at the step that was still going.
 *
 * The difference matters wherever a step is a question: `sequence(check(close), charge)` asks
 * "am I close?" again on every tick of the charge, and abandons it the moment the answer changes.
 * `steps(check(close), charge)` asks once, and then gets on with it.
 */
export function steps<W>(...children: Array<Node<W>>): Node<W> {
  const key = Symbol('steps');
  return (tick) => {
    let from = tick.memory.get(key, 0);
    for (let i = from; i < children.length; i++) {
      const status = children[i](tick);
      if (status === 'running') { tick.memory.set(key, i); return 'running'; }
      if (status === 'failure') { tick.memory.clear(key); return 'failure'; }
      from = i + 1;
    }
    tick.memory.clear(key);
    return 'success';
  };
}

/** A guard: only reach the node if the question holds. */
export function when<W>(question: (tick: Tick<W>) => boolean, then: Node<W>): Node<W> {
  return sequence(check(question), then);
}

/** Success becomes failure and failure success; running is left alone. */
export function not<W>(child: Node<W>): Node<W> {
  return (tick) => {
    const status = child(tick);
    if (status === 'success') return 'failure';
    if (status === 'failure') return 'success';
    return status;
  };
}

/** Whatever happened, call it success. For a branch whose failure should not fall through. */
export function always<W>(child: Node<W>): Node<W> {
  return (tick) => (child(tick) === 'running' ? 'running' : 'success');
}

// --- time ---

/**
 * Hold here for a while. Running until the seconds are up, then success — and it forgets, so the
 * next time the branch is reached it waits again.
 */
export function wait<W>(seconds: number | ((tick: Tick<W>) => number)): Node<W> {
  const key = Symbol('wait');
  return (tick) => {
    const left = tick.memory.get(key, typeof seconds === 'function' ? seconds(tick) : seconds) - tick.dt;
    if (left > 0) { tick.memory.set(key, left); return 'running'; }
    tick.memory.clear(key);
    return 'success';
  };
}

/**
 * Let the child through now and then, and fail in between. The gap may be rolled fresh each time,
 * which is how "every five to eleven seconds, one of them breaks off" is written down.
 */
export function every<W>(seconds: number | ((tick: Tick<W>) => number), child: Node<W>): Node<W> {
  const key = Symbol('every');
  const gap = (tick: Tick<W>) => (typeof seconds === 'function' ? seconds(tick) : seconds);
  return (tick) => {
    const left = tick.memory.get(key, gap(tick)) - tick.dt;
    if (left > 0) { tick.memory.set(key, left); return 'failure'; }
    const status = child(tick);
    if (status !== 'running') tick.memory.set(key, gap(tick));
    return status;
  };
}

/**
 * A selector that remembers. Where `selector` reconsiders everything from the top each tick, this
 * one goes back to whichever child was still running and lets it finish first.
 *
 * That difference is the whole of committed behaviour. A shark that has begun its run does not
 * call it off because the boat drifted a yard further away and some earlier branch became true
 * again; it finishes, and then the tree reconsiders. Reach for `selector` when a creature should
 * change its mind the instant the world changes, and `latch` when it should see something out.
 */
export function latch<W>(...children: Array<Node<W>>): Node<W> {
  const key = Symbol('latch');
  return (tick) => {
    const held = tick.memory.get(key, -1);
    if (held >= 0) {
      const status = children[held](tick);
      if (status === 'running') return 'running';
      tick.memory.clear(key);
      if (status === 'success') return 'success';
      // it failed: fall through and reconsider from the top
    }
    for (let i = 0; i < children.length; i++) {
      const status = children[i](tick);
      if (status === 'running') { tick.memory.set(key, i); return 'running'; }
      if (status === 'success') return 'success';
    }
    return 'failure';
  };
}
