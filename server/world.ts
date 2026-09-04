import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deltaKey, type Clock, type WorldDelta } from './protocol';

/**
 * The little that a shared world actually needs to remember: what time it is, and the short list
 * of things players have changed. Terrain, villages and dungeons are grown from the seed on every
 * client, so none of that is ever stored here.
 *
 * State lives in one JSON file per seed. It is small, human-readable, and losing it costs nothing
 * worse than a few reopened chests.
 */

/** Real seconds in a game day, matching the client. */
export const DAY_LENGTH = 480;
/** How often the clock goes out to everyone, in milliseconds. */
export const CLOCK_INTERVAL = 5_000;
/** Deltas are written to disk no more often than this. */
const SAVE_DEBOUNCE = 2_000;
/** Old sowings are forgotten after this many days, so a long-running world does not grow forever. */
const DELTA_LIMIT = 4_000;

export interface WorldFile {
  seed: number;
  clock: Clock;
  deltas: WorldDelta[];
}

export class SharedWorld {
  clock: Clock;
  /** Latest delta per key, so a tile sown then reaped keeps only the last word. */
  private readonly deltas = new Map<string, WorldDelta>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(readonly seed: number, private readonly path: string, start: Clock) {
    const loaded = this.load();
    this.clock = loaded?.clock ?? start;
    for (const delta of loaded?.deltas ?? []) this.deltas.set(deltaKey(delta), delta);
  }

  /** Everything a joining player needs to catch up. */
  get log(): WorldDelta[] {
    return [...this.deltas.values()];
  }

  /** Move the clock on by the seconds that have actually passed. */
  tick(seconds: number): void {
    this.clock.time += seconds / DAY_LENGTH;
    while (this.clock.time >= 1) { this.clock.time -= 1; this.clock.day += 1; }
    this.dirty = true;
  }

  /** Record something a player changed. Returns false when it was already known. */
  apply(delta: WorldDelta): boolean {
    const key = deltaKey(delta);
    const existing = this.deltas.get(key);
    if (existing && sameDelta(existing, delta)) return false;
    // a reaped tile is simply no longer sown, so it needs no row of its own
    if (delta.kind === 'reap') {
      if (!existing) return false;
      this.deltas.delete(key);
    } else {
      this.deltas.set(key, delta);
    }
    if (this.deltas.size > DELTA_LIMIT) this.forgetOldest();
    this.scheduleSave();
    return true;
  }

  /** Drop the oldest sowings first: they matter least and there are most of them. */
  private forgetOldest(): void {
    const sowings = [...this.deltas.entries()].filter(([, d]) => d.kind === 'sow');
    sowings.sort((a, b) => (a[1] as { day: number }).day - (b[1] as { day: number }).day);
    for (const [key] of sowings.slice(0, Math.ceil(sowings.length * 0.2))) this.deltas.delete(key);
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, SAVE_DEBOUNCE);
  }

  save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const file: WorldFile = { seed: this.seed, clock: this.clock, deltas: this.log };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(file, null, 2));
    } catch (error) {
      console.error(`could not save world ${this.seed}:`, error);
    }
  }

  private load(): WorldFile | null {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as WorldFile;
      if (raw?.seed !== this.seed || !raw.clock) return null;
      return raw;
    } catch {
      return null;   // no file yet, or an unreadable one: start fresh
    }
  }
}

function sameDelta(a: WorldDelta, b: WorldDelta): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Where a world's file lives. */
export function worldPath(dataDir: string, seed: number): string {
  return join(dataDir, `${seed}.json`);
}
