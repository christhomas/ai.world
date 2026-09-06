import { Forgetful, type Vault } from './vault';
import {
  DAY_LENGTH, MAIL_LIMIT, STALL_DAYS, STALL_LOTS, deltaKey,
  type Clock, type Letter, type Stall, type StallItem, type WorldDelta,
} from './protocol';

/**
 * The little that a shared world actually needs to remember: what time it is, and the short list
 * of things players have changed. Terrain, villages and dungeons are grown from the seed on every
 * client, so none of that is ever stored here.
 *
 * State lives in one JSON file per seed. It is small, human-readable, and losing it costs nothing
 * worse than a few reopened chests.
 */

export { DAY_LENGTH } from './protocol';
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
  stalls?: Stall[];
  letters?: Letter[];
  folk?: string[];
}

/** What a stall did with what it was asked, and what the asker should be told. */
export type StallReply =
  | { ok: true; kind: 'rented' | 'stocked' | 'closed' }
  | { ok: true; kind: 'bought'; item: StallItem; cost: number }
  | { ok: true; kind: 'collected'; gold: number }
  | { ok: false; reason: string };

export class SharedWorld {
  clock: Clock;
  /** Latest delta per key, so a tile sown then reaped keeps only the last word. */
  private readonly deltas = new Map<string, WorldDelta>();
  /** Rented market pitches, by pitch id. */
  private readonly pitches = new Map<string, Stall>();
  /** Parcels waiting at the inns, oldest first. */
  private letters: Letter[] = [];
  /** Every name this world has seen, so a parcel can be addressed to somebody who is away. */
  private readonly seen = new Set<string>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    readonly seed: number,
    private readonly path: string,
    start: Clock,
    /** Where this world is kept. A vault that forgets is a world that lasts as long as the process. */
    private readonly vault: Vault = new Forgetful(),
  ) {
    const loaded = this.load();
    this.clock = loaded?.clock ?? start;
    for (const delta of loaded?.deltas ?? []) this.deltas.set(deltaKey(delta), delta);
    for (const stall of loaded?.stalls ?? []) this.pitches.set(stall.id, stall);
    this.letters = loaded?.letters ?? [];
    for (const name of loaded?.folk ?? []) this.seen.add(name);
  }

  /** Everyone this world has ever seen. */
  get folk(): string[] {
    return [...this.seen].sort();
  }

  /**
   * Remember a name so parcels can be addressed to it later.
   * @returns whether this is somebody the world had not met before
   */
  meet(name: string): boolean {
    if (this.seen.has(name)) return false;
    this.seen.add(name);
    this.scheduleSave();
    return true;
  }

  /** Leave a parcel at the inns for somebody. */
  post(letter: Letter): void {
    this.letters.push(letter);
    if (this.letters.length > MAIL_LIMIT) this.letters.shift();
    this.scheduleSave();
  }

  /** How many parcels are waiting for this name. */
  waiting(name: string): number {
    return this.letters.filter((letter) => letter.to === name).length;
  }

  /** Hand over everything addressed to this name, and take it off the shelf. */
  collect(name: string): Letter[] {
    const theirs = this.letters.filter((letter) => letter.to === name);
    if (theirs.length === 0) return [];
    this.letters = this.letters.filter((letter) => letter.to !== name);
    this.scheduleSave();
    return theirs;
  }

  /** Every pitch currently rented, for a client to draw and browse. */
  get stalls(): Stall[] {
    return [...this.pitches.values()];
  }

  /** Everything a joining player needs to catch up. */
  get log(): WorldDelta[] {
    return [...this.deltas.values()];
  }

  /**
   * Wind the clock to a day and a time. For the console, and for whoever operates a world.
   *
   * The world's own, not a player's: everybody in it is told the moment it changes, because the
   * time of day is the one thing a world has to agree about.
   */
  setClock(day: number, time: number): Clock {
    this.clock.day = Math.max(1, Math.floor(day));
    this.clock.time = Math.max(0, Math.min(0.999, time));
    return this.clock;
  }

  /** Move the clock on by the seconds that have actually passed. */
  tick(seconds: number): void {
    this.clock.time += seconds / DAY_LENGTH;
    while (this.clock.time >= 1) { this.clock.time -= 1; this.clock.day += 1; }
    this.dirty = true;
  }

  /**
   * Clear pitches whose rent has run out, so a market is never held by somebody who left months
   * ago. Uncollected takings go with them, which is the trader's own lookout.
   * @returns whether anything was cleared, and so whether the market has to be described again
   */
  sweepStalls(): boolean {
    let swept = false;
    for (const [id, stall] of this.pitches) {
      if (stall.until > this.clock.day) continue;
      this.pitches.delete(id);
      swept = true;
    }
    if (swept) this.scheduleSave();
    return swept;
  }

  /**
   * Everything a market pitch can be asked, in one place: renting it, stocking it, buying from it,
   * taking the money, and giving it up. Gold and goods live in each player's own save, so the
   * answer here says what should happen there.
   */
  stall(trader: string, request:
    | { do: 'rent'; id: string; village: string }
    | { do: 'stock'; id: string; item: StallItem }
    | { do: 'buy'; id: string; index: number }
    | { do: 'collect'; id: string }
    | { do: 'close'; id: string },
  ): StallReply {
    const held = this.pitches.get(request.id);
    if (request.do === 'rent') {
      if (held) return { ok: false, reason: held.owner === trader ? 'You already hold this pitch.' : `${held.owner} holds this pitch until day ${held.until}.` };
      this.pitches.set(request.id, {
        id: request.id, village: request.village, owner: trader,
        items: [], takings: 0, until: this.clock.day + STALL_DAYS,
      });
      this.scheduleSave();
      return { ok: true, kind: 'rented' };
    }
    if (!held) return { ok: false, reason: 'Nobody holds this pitch.' };

    if (request.do === 'buy') {
      const lot = held.items[request.index];
      if (!lot) return { ok: false, reason: 'That lot has already gone.' };
      if (held.owner === trader) return { ok: false, reason: 'It is your own stall.' };
      lot.count -= 1;
      if (lot.count <= 0) held.items.splice(request.index, 1);
      held.takings += lot.price;
      this.scheduleSave();
      return { ok: true, kind: 'bought', item: { id: lot.id, price: lot.price, count: 1 }, cost: lot.price };
    }

    if (held.owner !== trader) return { ok: false, reason: 'This is not your pitch.' };
    switch (request.do) {
      case 'stock': {
        const existing = held.items.find((lot) => lot.id === request.item.id && lot.price === request.item.price);
        if (existing) existing.count = Math.min(99, existing.count + request.item.count);
        else if (held.items.length >= STALL_LOTS) return { ok: false, reason: 'The stall is full.' };
        else held.items.push({ ...request.item });
        this.scheduleSave();
        return { ok: true, kind: 'stocked' };
      }
      case 'collect': {
        const gold = held.takings;
        held.takings = 0;
        this.scheduleSave();
        return { ok: true, kind: 'collected', gold };
      }
      case 'close': {
        this.pitches.delete(request.id);
        this.scheduleSave();
        return { ok: true, kind: 'closed' };
      }
    }
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
    const file: WorldFile = {
      seed: this.seed, clock: this.clock, deltas: this.log,
      stalls: this.stalls, letters: this.letters, folk: this.folk,
    };
    try {
      this.vault.write(this.path, JSON.stringify(file, null, 2));
    } catch (error) {
      console.error(`could not save world ${this.seed}:`, error);
    }
  }

  private load(): WorldFile | null {
    try {
      const kept = this.vault.read(this.path);
      if (kept === null) return null;
      const raw = JSON.parse(kept) as WorldFile;
      if (raw?.seed !== this.seed || !raw.clock) return null;
      return raw;
    } catch {
      return null;   // nothing kept yet, or something unreadable: start fresh
    }
  }
}

function sameDelta(a: WorldDelta, b: WorldDelta): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What a world is filed under.
 *
 * A name rather than a path, because a vault might be a directory of files or might be a Map in a
 * Web Worker, and the only thing both agree on is that a world is called something.
 */
export function worldPath(dataDir: string, seed: number): string {
  return dataDir ? `${dataDir}/${seed}.json` : `${seed}.json`;
}
