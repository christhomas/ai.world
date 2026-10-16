import type { HostClock } from '../../server/host-clock';

/**
 * The time an embedded engine has: none of its own. An app's JavaScript engine (QuickJS on Android,
 * JavaScriptCore on iOS) has no event loop, so nothing happens between the requests the app makes,
 * and time moves only when a request says it has (#563). Timers set through this clock run, in
 * order, when the host advances it past them.
 */
export class StepClock implements HostClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; every: number; run: () => void }>();

  now(): number { return this.time; }

  after(callback: () => void, milliseconds: number): () => void {
    return this.set(callback, milliseconds, 0);
  }

  every(callback: () => void, milliseconds: number): () => void {
    return this.set(callback, milliseconds, Math.max(1, milliseconds));
  }

  yield(): Promise<void> { return new Promise((resume) => { this.after(resume, 0); }); }

  /**
   * Move time on to `until`, running every timer that falls due on the way, including those that
   * others set while running, earliest first and in the order they were set. Bounded, so a timer
   * that keeps setting itself for now cannot hold the engine forever.
   */
  advanceTo(until: number, limit = 100_000): number {
    let ran = 0;
    for (;;) {
      let due: number | null = null;
      let soonest = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= until && timer.at < soonest) { soonest = timer.at; due = id; }
      }
      if (due === null) break;
      if (++ran > limit) throw new Error(`more than ${limit} timers fell due before ${until} ms`);
      const timer = this.timers.get(due)!;
      this.time = Math.max(this.time, timer.at);
      if (timer.every > 0) timer.at += timer.every;
      else this.timers.delete(due);
      timer.run();
    }
    this.time = Math.max(this.time, until);
    return ran;
  }

  private set(callback: () => void, milliseconds: number, every: number): () => void {
    const id = this.nextId++;
    const wait = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
    this.timers.set(id, { at: this.time + wait, every, run: callback });
    return () => { this.timers.delete(id); };
  }
}

/** The one clock the engine runs on: the world's ticks, the jobs' replies and the page-shaped timers. */
export const engineClock = new StepClock();

/** A copy as a structured clone makes one, of what the game hands the clone: data, not objects with behaviour. */
function cloned<T>(value: T, seen = new Map<unknown, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (ArrayBuffer.isView(value)) {
    const view = value as unknown as { slice(): unknown };
    if (typeof view.slice === 'function') return view.slice() as T;
    return new DataView((value as unknown as DataView).buffer.slice(0)) as T;
  }
  if (value instanceof ArrayBuffer) return value.slice(0) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(cloned(k, seen), cloned(v, seen));
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const v of value) copy.add(cloned(v, seen));
    return copy as T;
  }
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) (copy as Record<string, unknown>)[key] = cloned((value as Record<string, unknown>)[key], seen);
  return copy as T;
}

/**
 * The few page-shaped things the game asks the host for and an embedded engine does not have,
 * installed only where missing so a browser or Node keeps its own: `performance.now`, timers on the
 * step clock, `structuredClone` and a console that says nothing.
 */
function installMissing(): void {
  const host = globalThis as unknown as Record<string, unknown>;
  if (typeof host.performance !== 'object' || host.performance === null) host.performance = { now: () => engineClock.now() };
  if (typeof host.setTimeout !== 'function') {
    const cancels = new Map<number, () => void>();
    let next = 1;
    const remember = (cancel: () => void): number => { const id = next++; cancels.set(id, cancel); return id; };
    const forget = (id: unknown): void => { cancels.get(id as number)?.(); cancels.delete(id as number); };
    host.setTimeout = (run: () => void, ms?: number) => remember(engineClock.after(run, ms ?? 0));
    host.setInterval = (run: () => void, ms?: number) => remember(engineClock.every(run, ms ?? 0));
    host.clearTimeout = forget;
    host.clearInterval = forget;
  }
  if (typeof host.queueMicrotask !== 'function') {
    host.queueMicrotask = (job: () => void) => { void Promise.resolve().then(job); };
  }
  if (typeof host.structuredClone !== 'function') host.structuredClone = (value: unknown) => cloned(value);
  if (typeof host.console !== 'object' || host.console === null) {
    const quiet = () => {};
    host.console = { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet };
  }
}

installMissing();
