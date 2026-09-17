/**
 * A village's stack of something, and the rule that makes a stack a limit rather than a number.
 *
 * `timber.ts` argued the case for the first of these and every word of it holds for the second: a
 * village on a plain with a wood behind it and a village on a bare rock should differ by more than
 * how fast their purses fill, and what buys that is *a limit that is not a number going down*. A
 * house cannot be built out of an empty yard, whatever is on the table.
 *
 * What this file is for is that the argument was general and the code was not. The mechanism —
 * a stock, a history of what was carried in, a day's work accruing since the last one accounted, a
 * standing stack for a village nobody has looked at yet, and a ceiling — is about *stacks*, not
 * about wood. The second material in this world is ore, for a smith who makes gear out of it, and
 * copying two hundred lines to get it would have been two hundred lines that then have to agree.
 *
 * So the mechanism is here and the material is a handful of numbers with an argument attached. See
 * `TIMBER` and `ORE` for what those arguments are; nothing in this file knows what is in the pile.
 */

/** What one worker lands in a day, what a village already holds, and what it will hold at most. */
export interface Stocking {
  /** What one worker lands in a day. */
  A_DAY: number;
  /**
   * Days of work a village is already holding the first time anybody asks.
   *
   * A village that has stood for years has a stack by the sawpit or a heap by the adit; starting
   * every yard in the world at nothing would mean nothing anywhere could be commissioned until a
   * player had waited a week watching somebody work, which is a rule that reads as a bug. It is
   * exactly nothing for a place that has never had anybody to do the work — which is the
   * distinction the whole idea is about, visible on the first afternoon rather than after one.
   */
  STANDING: number;
  /**
   * What a yard will hold before the workers stop.
   *
   * A village does not gather what it has nowhere to stack and nobody to sell, and without a
   * ceiling a quiet century would leave every village in the country able to build anything
   * instantly — which is the limit going away again by arithmetic, the exact thing this was built
   * to stop.
   */
  HOLDS: number;
}

/**
 * A yard on disk: the stack that is standing, and what was carried in to it.
 *
 * Two records rather than one, because they are two different kinds of number. The first goes up
 * and down and is a *stock*; the second only ever goes up and is a *history*, and a history is what
 * a wright works from — a village that put up a house would otherwise forget the week somebody
 * spent hauling timber into it, which is the one thing it ought to remember.
 *
 * The bare `Record<string, number>` is the shape this was saved in before the second record
 * existed, and it is still read: a yard from that day is a stack nobody is recorded as having
 * brought, which is exactly what it was.
 */
export type YardJson = Record<string, number> | {
  yards: Record<string, number>;
  brought: Record<string, number>;
  /** Last world day each yard received its own workers' output. */
  felled?: Record<string, number>;
};

export class Yard {
  private readonly yards = new Map<string, number>();
  /** Cumulative amount carried in and sold here, which no building ever takes back down. */
  private readonly carriedIn = new Map<string, number>();
  /** The last day accounted for each village's own work. */
  private readonly workedOn = new Map<string, number>();
  /** Villages whose standing stack has already been counted, so it is counted once. */
  private readonly opened = new Set<string>();

  /**
   * @param on the world day this save was written, for a yard that predates the day being kept.
   *
   * A save made before the day was recorded has stock and no record of when it was last worked, and
   * the only honest baseline is the day the save itself was on: the workers had worked up to then
   * and not past it. Without it the first morning back fell through to `today - 1` and credited a
   * single day however long the game had been shut — a fortnight away earned an afternoon's timber.
   *
   * Left out, an old save reads as it did. `Mines.from` takes the day for the same reason.
   */
  constructor(private readonly dials: Stocking, json?: YardJson, on?: number) {
    const saved = json && isSavedYard(json) ? json : null;
    const stacks = saved?.yards ?? json;
    const baseline = Number.isFinite(on) ? Math.floor(on as number) : null;
    for (const [village, much] of Object.entries(stacks ?? {})) {
      this.yards.set(village, much);
      this.opened.add(village);
      // a yard that arrived with no day of its own was last worked on the day the save was written
      if (baseline !== null) this.workedOn.set(village, baseline);
    }
    for (const [village, much] of Object.entries(saved?.brought ?? {})) this.carriedIn.set(village, much);
    // and a save that does carry the days is believed over the baseline, which is only a fallback
    for (const [village, day] of Object.entries(saved?.felled ?? {})) this.workedOn.set(village, day);
  }

  /** What is in this village's yard. Nothing, for a village nobody has looked at or worked for. */
  at(village: string): number {
    return this.yards.get(village) ?? 0;
  }

  /**
   * Everything ever carried into this village and sold, which is what a wright is paying back.
   *
   * Deliberately not the yard: the yard is a stack and this is a history, and the difference is a
   * village that has built a house since. Deliberately not the village's own work either — a
   * woodcutter lives here, and counting his week would hand a cart to a player who stood still
   * for it.
   */
  sold(village: string): number {
    return this.carriedIn.get(village) ?? 0;
  }

  /**
   * Something a player carried in and sold here: it joins the stack, and it is remembered.
   *
   * The tally counts what was *sold*, not what fitted. A seller whose logs meet a full yard has
   * still been paid for them by a market that wanted them, and refusing to credit the surplus would
   * make the wright's memory depend on how much building the village happened to be doing.
   */
  brought(village: string, much: number): void {
    if (much <= 0) return;
    this.carriedIn.set(village, this.sold(village) + much);
    this.land(village, much);
  }

  /**
   * Landed at a village: gathered by its own people, or carried in and sold over a counter.
   *
   * One way in for both, because they are the same act from the yard's point of view — a stack does
   * not know who brought it. Capped, and the surplus is simply not landed rather than being
   * refused: a woodcutter who finds the yard full spends the day doing something else, and a player
   * selling into a full yard has still sold his wood, which the market has already paid for.
   */
  land(village: string, much: number): void {
    if (much <= 0) return;
    this.yards.set(village, Math.min(this.dials.HOLDS, this.at(village) + much));
  }

  /**
   * A village's own work accounted through a particular world day.
   *
   * The regular game path uses this rather than assuming it was called once per rendered midnight:
   * a day skipped by a clock correction or a reopened save is still a day the workers worked, and
   * the same day cannot be landed twice. The first visit keeps the existing standing stock, then
   * counts the day it was first observed.
   *
   * **`day` is the morning being lived, not the day the game is on.** The scheduler hands each
   * missed morning in turn; passing it the last of them made the first call account the whole
   * interval and every call after it a same-day no-op, so a fortnight away earned an afternoon's
   * timber — and earned it at whatever the village's staffing was on the morning it came back
   * rather than on each of the mornings it was away.
   */
  workedThrough(village: string, workers: number, day: number): void {
    const today = Math.floor(day);
    if (!Number.isFinite(today)) return;
    if (!this.opened.has(village)) {
      this.opened.add(village);
      this.land(village, workers * this.dials.A_DAY * this.dials.STANDING);
      this.workedOn.set(village, today - 1);
    }
    const last = this.workedOn.get(village) ?? today - 1;
    if (today <= last) return;
    this.land(village, (today - last) * workers * this.dials.A_DAY);
    this.workedOn.set(village, today);
  }

  /**
   * Whoever is building takes what a job wants, or takes nothing and says so.
   *
   * All of it or none of it: half the timber for a house is a house nobody can start, and a yard
   * quietly emptied by a job that was then refused would be a village that lost its wood to a
   * conversation. The caller asks before it commits, and this is the committing.
   */
  draw(village: string, much: number): boolean {
    if (much <= 0) return true;
    const held = this.at(village);
    if (held < much) return false;
    this.yards.set(village, held - much);
    return true;
  }

  /** What the yard is short of for a job of this size, or nought when it can be started. */
  shortBy(village: string, much: number): number {
    return Math.max(0, much - this.at(village));
  }

  toJSON(): YardJson {
    return {
      yards: Object.fromEntries(this.yards),
      brought: Object.fromEntries(this.carriedIn),
      felled: Object.fromEntries(this.workedOn),
    };
  }
}

function isSavedYard(json: YardJson): json is Exclude<YardJson, Record<string, number>> {
  return 'yards' in json
    && typeof json.yards === 'object' && json.yards !== null
    && 'brought' in json && typeof json.brought === 'object' && json.brought !== null;
}
