import { Forgetful, type Vault } from './vault';
import {
  DAY_LENGTH, MAIL_LIMIT, STALL_DAYS, STALL_LOTS, deltaAt, deltaKey,
  type Clock, type Letter, type Stall, type StallItem, type WorldDelta,
} from './protocol';
import {
  KEEP_READY, provinceOf, provincePath, provincesNear, type ProvinceId,
} from '../src/world/provinces';

/** One province's leavings, while somebody is near enough for them to matter. */
interface Province {
  deltas: Map<string, WorldDelta>;
  dirty: boolean;
  /**
   * How long this province had been nobody's business when it was picked up again, in seconds.
   *
   * Nought for one that has never been away — a province being touched for the first time in a
   * world, or one that was written and read back inside the same session without the clock moving.
   * It is set on the way in and never afterwards, because the question it answers is asked once:
   * "what has to be accounted for before anybody looks at this."
   */
  slept: number;
}

/**
 * A province as it is written down: what was left there, and when it stopped being anybody's.
 *
 * The stamp is the whole reason this is an object rather than the bare array it used to be. A
 * province that has been asleep cannot be caught up without knowing for how long, and nothing in
 * this world could say — `Simulation.tick` closes an empty room and drops everything in it, so the
 * elapsed time was simply gone. One number fixes that, and it costs a line in a file that is
 * already a few kilobytes.
 *
 * Files written before this exist and are read as a plain array, which is what the `Array.isArray`
 * in `province` is for. They come back with no stamp, which reads as "never away" — the safe wrong
 * answer, because it means nothing is caught up rather than something being caught up by a wildly
 * invented amount.
 */
interface ProvinceFile {
  /** The world day, fractional, that the last of them walked out of it. */
  when: number;
  deltas: WorldDelta[];
}

/**
 * The little that a shared world actually needs to remember: what time it is, and the short list
 * of things players have changed. Terrain, villages and dungeons are grown from the seed on every
 * client, so none of that is ever stored here.
 *
 * The world's own facts live in one JSON file per seed; what happened at a *place* lives in a file
 * per province, read when somebody goes there and written when the last of them leaves. That is what
 * lets a world have no edge: there used to be a cap of four thousand changes and a rule that threw
 * the oldest sowings away when it was reached, which is a world quietly destroying a player's work
 * because there was nowhere else to put it. There is somewhere else to put it now.
 *
 * The rest is small, human-readable, and losing it costs nothing
 * worse than a few reopened chests.
 */

export { DAY_LENGTH } from './protocol';
/** How often the clock goes out to everyone, in milliseconds. */
export const CLOCK_INTERVAL = 5_000;
/** Deltas are written to disk no more often than this. */
const SAVE_DEBOUNCE = 2_000;
/** Old sowings are forgotten after this many days, so a long-running world does not grow forever. */

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
  /**
   * Latest delta per key, so a tile sown then reaped keeps only the last word.
   *
   * The ones that are not about a place: a chest opened, a death, a village founded. They are few
   * and they are facts about the whole world, so they stay here and are written with it.
   */
  private readonly deltas = new Map<string, WorldDelta>();
  /**
   * And the ones that are about a place, kept province by province.
   *
   * A world with an edge can hold everything anybody has ever changed. A world without one cannot:
   * fields sown grow with every acre anybody has walked over, which is why there was a limit here
   * and a rule for throwing the oldest sowings away — a bound that quietly destroyed a player's
   * work because there was nowhere else to put it.
   *
   * A province is somewhere else to put it. What is near a player is in memory; what is not is on
   * disk, whole, for as long as the world lasts.
   */
  private readonly provinces = new Map<ProvinceId, Province>();
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
    /** Where the provinces of this world are written, beside its own file. */
    private readonly dataDir: string,
    /** Where this world is kept. A vault that forgets is a world that lasts as long as the process. */
    private readonly vault: Vault = new Forgetful(),
    /**
     * Who lives in the villages, when anybody here does.
     *
     * Null on every path today and deliberately so: villagers are still worked out on each client
     * from the seed and the register of who has died, which is C5's to move. The hook is here
     * because C4 asked for it by name — a villager's memory is bounded but it is not *small*, and
     * `Register.compact` is what turns ten slights into one opinion so that a province's file stops
     * growing with everything that has ever happened near somebody. The moment it wants calling is
     * the moment a province stops being anybody's business, which is `keepNear` below, and that
     * moment lives here rather than on a client. So it waits here, one argument wide, and C5 hands
     * it a register instead of teaching this class a second way to find one.
     */
    private readonly register: { compact(day: number): void } | null = null,
  ) {
    const loaded = this.load();
    this.clock = loaded?.clock ?? start;
    for (const delta of loaded?.deltas ?? []) this.remember(delta);
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
    // what a joining player is told: the world's own facts, and the ground anybody is standing on.
    // The provinces nobody is near are on disk and are read back when somebody goes there.
    return [...this.deltas.values(), ...[...this.provinces.values()].flatMap((p) => [...p.deltas.values()])];
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
    const changed = this.remember(delta);
    if (changed) this.scheduleSave();
    return changed;
  }

  /**
   * Put a change where it belongs, without deciding whether to write anything down.
   *
   * Used by `apply` and by loading, which is why the saving is somebody else's business: reading a
   * world back off the disk should not mark it as needing to be written to the disk.
   */
  private remember(delta: WorldDelta): boolean {
    const key = deltaKey(delta);
    const where = deltaAt(delta);
    const kept = where ? this.province(provinceOf(where.x, where.z)).deltas : this.deltas;
    const existing = kept.get(key);
    if (existing && sameDelta(existing, delta)) return false;
    // a reaped tile is simply no longer sown, so it needs no row of its own
    if (delta.kind === 'reap') {
      if (!existing) return false;
      kept.delete(key);
    } else {
      kept.set(key, delta);
    }
    if (where) this.province(provinceOf(where.x, where.z)).dirty = true;
    return true;
  }

  /**
   * How long this province had been nobody's business when it was last picked up, in seconds.
   *
   * The other half of `catchUp` in `src/entities/unwatched.ts`, which wants a herd and a stretch of
   * time and asks for neither a clock nor a province. `homelandsOf` says which herds are this
   * province's; this says how long nobody was looking at them. Whoever wires up the tiers puts the
   * two together and nothing here has to know that they did.
   *
   * Nought for a province nobody has ever left, and nought for one whose file predates the stamp.
   */
  asleep(id: ProvinceId): number {
    return this.province(id).slept;
  }

  /** A province, read off the disk the first time anybody changes or asks about anything in it. */
  private province(id: ProvinceId): Province {
    const held = this.provinces.get(id);
    if (held) return held;
    const fresh: Province = { deltas: new Map(), dirty: false, slept: 0 };
    try {
      const kept = this.vault.read(provincePath(this.dataDir, this.seed, id));
      if (kept !== null) {
        const raw = JSON.parse(kept) as WorldDelta[] | ProvinceFile;
        // the shape written before there was a stamp, which is an honest nought rather than a guess
        const rows = Array.isArray(raw) ? raw : raw.deltas ?? [];
        for (const delta of rows) fresh.deltas.set(deltaKey(delta), delta);
        if (!Array.isArray(raw) && typeof raw.when === 'number') {
          // never negative: a world whose clock has been wound back by an operator is a world where
          // nothing slept, not one where a herd owes somebody a week of walking backwards
          fresh.slept = Math.max(0, (this.today - raw.when) * DAY_LENGTH);
        }
      }
    } catch {
      // nothing kept there yet, or something unreadable: the province starts as it was made
    }
    this.provinces.set(id, fresh);
    return fresh;
  }

  /** The world's own time as one number, which is what a stretch of absence is measured against. */
  private get today(): number {
    return this.clock.day + this.clock.time;
  }

  /**
   * Make sure the provinces around these people are to hand, and let go of the rest.
   *
   * The whole of what provinces buy: a world holds the leavings of the ground somebody is standing
   * on rather than of everywhere anybody has ever been. What is let go is written down first, so
   * letting go costs nothing but the reading back.
   *
   * `people` is who is standing on the country and nobody else, so an empty list is a real answer
   * rather than a mistake: anybody down a staircase is not on the surface — their coordinates are a
   * dungeon floor's own — and a world with the whole party underground holds no provinces at all.
   * That is right rather than merely cheap. Nothing on the surface can be changed by somebody who
   * is not on it, the square they came down in is read back in a millisecond when they climb out,
   * and the hour they spent below is an hour the country above them was honestly asleep.
   */
  keepNear(people: ReadonlyArray<{ x: number; z: number }>): void {
    const wanted = new Set<ProvinceId>();
    for (const one of people) for (const id of provincesNear(one.x, one.z, KEEP_READY)) wanted.add(id);
    for (const id of wanted) this.province(id);
    let anyLetGo = false;
    for (const [id, province] of this.provinces) {
      if (wanted.has(id)) continue;
      this.writeProvince(id, province, true);
      this.provinces.delete(id);
      anyLetGo = true;
    }
    // Ten slights become one opinion, on the day the place stopped being anybody's business. Here
    // rather than inside `writeProvince` because a register is the world's rather than a province's
    // — compacting it once when the last of them is let go is one pass over the villages, and
    // compacting it inside the loop would be that same pass repeated for every square somebody has
    // walked out of. `Register.compact` is idempotent within a day, so the two agree about the
    // result and disagree only about the bill.
    if (anyLetGo) this.register?.compact(Math.floor(this.clock.day));
  }

  /**
   * One province's leavings, on its own, stamped with the time it stopped being anybody's.
   *
   * `dirty` alone is no longer enough on the way out. A province read back unchanged and then let go
   * again would keep the stamp it was written with — put away on day 9, walked through on day 10,
   * put away again, and the file still says day 9, so the next arrival is handed a week nobody was
   * away for. So anything with rows in it is rewritten when it is let go even when the rows are the
   * same rows, and that costs a few kilobytes at a moment that already costs a file.
   *
   * It is deliberately *only* on the way out. The other caller is the debounced save, which runs
   * while people are still standing there, and rewriting every held province on every save would
   * mean a megabyte a second for a well-worked square rather than the couple of hundred bytes that
   * actually changed. The cost of that choice is that a world killed rather than closed leaves a
   * stamp from its last real write, so the next arrival over-counts the sleep by however long the
   * process outlived it — seconds, against the days this is measuring.
   *
   * @param leaving the last of them has walked out of it, so the stamp has to be brought up to date
   */
  private writeProvince(id: ProvinceId, province: Province, leaving = false): void {
    if (!province.dirty && !(leaving && province.deltas.size > 0)) return;
    province.dirty = false;
    const file: ProvinceFile = { when: this.today, deltas: [...province.deltas.values()] };
    try {
      this.vault.write(provincePath(this.dataDir, this.seed, id), JSON.stringify(file, null, 2));
    } catch (error) {
      console.error(`could not save province ${id} of world ${this.seed}:`, error);
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, SAVE_DEBOUNCE);
  }

  save(): void {
    for (const [id, province] of this.provinces) this.writeProvince(id, province);
    if (!this.dirty) return;
    this.dirty = false;
    const file: WorldFile = {
      // the world's own facts only: a province writes its own, and writing them twice would mean
      // reading a stale copy back the next time anybody opened the world
      seed: this.seed, clock: this.clock, deltas: [...this.deltas.values()],
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
