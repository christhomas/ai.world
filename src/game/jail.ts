import type { Village } from '../world/structures';
import type { Charge } from './records';

/**
 * The cell at the back of a village police station: who is in it, how long they have left, and
 * what being in it costs.
 *
 * A sentence here is served, never skipped. The hours the law asks for are wound onto the world
 * clock, so the crops come on, the market turns over and everybody on the village register is a
 * day nearer their end by the time the door opens. That is the whole punishment: the game takes
 * back the one thing it cannot hand you again, and no number had to be invented to stand in for
 * it.
 *
 * The decision worth explaining is that a cell holds a name and not the hero. Nothing in here
 * knows what a player is: it is given somebody's name, holds them until an hour on the world
 * clock, and lets them out when anybody next asks. That is what lets a village put its own
 * troublemaker behind the same door the hero wakes behind, which is what T42 wants for a villain
 * the country can be rid of for a fortnight, and it is why a station being broken open is
 * something this module is told about rather than something it watches for. Breaking one open is
 * a deed done out in the world by things that know how to swing an axe; all that lands here is
 * the news, and the village that is without law until the roof is back on.
 */

/** What the law charges for an hour, how long a wrecked station takes to rebuild, and the walk. */
export const JAIL = {
  /** Hours in a day of the world clock: what turns a sentence into a day and a fraction of one. */
  HOURS_A_DAY: 24,
  /** Gold taken for every hour held. A night you can sleep off for nothing is not a sentence. */
  FINE_AN_HOUR: 5,
  /** And never more of a purse than this: a fine that empties you teaches you to avoid villages. */
  FINE_SHARE: 0.3,
  /** How far a constable will walk somebody to a cell, in tiles. Past it there is nowhere to put them. */
  ESCORT: 140,
  /** Days a station stands open to the sky after it is broken into, with nobody keeping order. */
  REBUILD_DAYS: 4,
  /** A day nobody has reached, so a station that was never touched is standing on every one of them. */
  NEVER: 0,
  /**
   * Names kept on a village's charge sheet, newest last.
   *
   * Bounded for the reason the churchyard is bounded: this is a record and not a history. A village
   * the player has been robbing for a month has taken more people in than anybody would sit and
   * listen to, and the watch only keeps the recent ones legible.
   */
  SHEET_KEPT: 24,
} as const;

/** Somebody behind a door, and how their sentence stands. */
export interface Held {
  /** The name on the charge sheet. */
  who: string;
  /** The village whose station is holding them. */
  village: string;
  /** True when it is the hero in there: the world reads differently when the player is the one held. */
  hero: boolean;
  /** The whole sentence, in hours of the clock. */
  hours: number;
  /** World day, fraction and all, at which the door is opened. */
  until: number;
  /** What was taken on the way in. */
  fine: number;
  /** The station door, where they were brought in and where they are turned out. */
  x: number;
  z: number;
}

/** One village's station: who is in the cell, and whether the building is standing at all. */
interface Cell {
  held: Held | null;
  /** The day the roof is back on, or JAIL.NEVER for a station nobody has broken open. */
  standingAgain: number;
  /**
   * Everybody this village has taken in, newest last, and what it cost them.
   *
   * The cell forgets a prisoner the moment their hour comes; the sheet does not. That is the whole
   * difference between being held and having been held, and it is the only thing in the game that
   * remembers a night the player would rather nobody mentioned.
   */
  sheet: Charge[];
}

/** What a save has to remember about the law: who is inside, which stations are heaps, and the sheet. */
export interface JailSave {
  cells: Array<{ village: string; held: Held | null; standingAgain: number; sheet?: Charge[] }>;
}

/** The world clock, as much of it as a sentence touches. */
export interface WorldClock {
  /** Whole days since the world began. */
  day: number;
  /** Fraction through the current day, 0 at midnight. */
  time: number;
}

/** The clock as one number, days and the part of one: what every sentence counts down against. */
export function clockAt(clock: WorldClock): number {
  return clock.day + clock.time;
}

/**
 * Wind the clock forward by hours of the game's day, rolling into tomorrow as often as it needs
 * to. This is the sentence: everything else about being held is book-keeping around it.
 */
export function windOn(clock: WorldClock, hours: number): void {
  const gone = clock.time + hours / JAIL.HOURS_A_DAY;
  clock.day += Math.floor(gone);
  clock.time = gone - Math.floor(gone);
}

/**
 * What the court takes: a few coins for every hour held, and never more than a share of what you
 * were carrying. Somebody walking in with nothing walks out with nothing, and is none the poorer
 * for it, because the hours were always the point.
 */
export function fineFor(hours: number, purse: number): number {
  return Math.min(Math.round(hours * JAIL.FINE_AN_HOUR), Math.floor(Math.max(0, purse) * JAIL.FINE_SHARE));
}

/** How long is left on a sentence, said the way somebody counting it off would say it. */
export function hoursLeftIn(held: Held, now: number): number {
  return Math.max(0, (held.until - now) * JAIL.HOURS_A_DAY);
}

/** A count of hours with its noun, so nothing ever reads "1 hours". */
export function hoursSaid(hours: number): string {
  const whole = Math.max(1, Math.round(hours));
  return `${whole} hour${whole === 1 ? '' : 's'}`;
}

/**
 * What the hero is told when they come round, which is the only account of the sentence they
 * ever get: how long they lost, and what it cost them while they were not watching.
 */
export function toldOnWaking(held: Held): string {
  const cost = held.fine > 0 ? `${held.fine} gold lighter` : 'no poorer, having had nothing worth taking';
  return `You come round on the boards of the cell at ${held.village}, ${hoursSaid(held.hours)} older and ${cost}.`;
}

/**
 * Every cell in the country, and the state of the buildings around them.
 *
 * Writing to it needs the village itself, because a sentence has to know there is a door and
 * where it is. Asking about it needs only the name, because that is all anybody standing in the
 * street has.
 */
export class Jail {
  private readonly cells = new Map<string, Cell>();

  /** What the save had, or an empty country where every station is standing and every cell is cold. */
  static from(saved: JailSave | null | undefined): Jail {
    const jail = new Jail();
    for (const cell of saved?.cells ?? []) {
      // a save written before the watch kept a sheet has none, and starts a fresh one rather than
      // pretending nobody in that world was ever taken in
      jail.cells.set(cell.village, { held: cell.held, standingAgain: cell.standingAgain, sheet: cell.sheet ?? [] });
    }
    return jail;
  }

  /** The village's cell, made the first time anybody asks about it. */
  private cellOf(village: string): Cell {
    let cell = this.cells.get(village);
    if (!cell) { cell = { held: null, standingAgain: JAIL.NEVER, sheet: [] }; this.cells.set(village, cell); }
    return cell;
  }

  /**
   * Every name the country's watch has written down, which is what the charge sheet is read from.
   *
   * Handed over flat, with each row carrying the village it was written in, because that is the
   * shape `theCharges` wants and because a sergeant reading his own sheet and an agent counting
   * arrests across a world are the same question asked at two sizes.
   */
  charges(): readonly Charge[] {
    return [...this.cells.values()].flatMap((cell) => cell.sheet);
  }

  /**
   * Who this village is holding. Nobody counts the hours down for a prisoner, so the door opens
   * here, the next time anybody looks: for the hero that is the moment they wake, and for anybody
   * else it is the moment somebody wonders whether he is still in there.
   */
  holds(village: string, now: number): Held | null {
    const cell = this.cells.get(village);
    if (!cell?.held) return null;
    if (now >= cell.held.until) { cell.held = null; return null; }
    return cell.held;
  }

  /** How long the prisoner has left, in hours, and nought for an empty cell. */
  hoursLeft(village: string, now: number): number {
    const held = this.holds(village, now);
    return held ? hoursLeftIn(held, now) : 0;
  }

  /** Everybody the country is holding at this hour: what a later task asks before it lets a villain out. */
  everyone(now: number): Held[] {
    return [...this.cells.keys()].flatMap((village) => this.holds(village, now) ?? []);
  }

  /** True while the station is a heap of timber, and so while the village has nobody keeping order. */
  lawless(village: string, day: number): boolean {
    return day < (this.cells.get(village)?.standingAgain ?? JAIL.NEVER);
  }

  /** The day this village has a station again, or JAIL.NEVER for one that was never broken open. */
  standingAgain(village: string): number {
    return this.cells.get(village)?.standingAgain ?? JAIL.NEVER;
  }

  /** Whether this village could hold anybody at all right now: a roof, a door, and nobody behind it. */
  canHold(village: Village, now: number, day: number): boolean {
    return village.station !== null && !this.lawless(village.name, day) && this.holds(village.name, now) === null;
  }

  /**
   * The nearest station that would take somebody: the walk a constable is willing to make. A
   * wrecked station is no use and neither is a full one, so the law goes to the next village
   * along rather than turning a prisoner loose at the door.
   */
  nearest(villages: Village[], x: number, z: number, now: number, day: number): Village | null {
    let found: Village | null = null;
    let nearest: number = JAIL.ESCORT;
    for (const village of villages) {
      if (!this.canHold(village, now, day)) continue;
      const d = Math.hypot(village.x - x, village.z - z);
      if (d < nearest) { nearest = d; found = village; }
    }
    return found;
  }

  /**
   * Put somebody in a named village's cell: the entry a story uses when it knows exactly whose
   * door it wants shut. Null when there is no station, it is a ruin, or somebody is already in
   * there, because a cell holds one at a time and always has.
   */
  commit(village: Village, who: string, hours: number, now: number, day: number, fine = 0, hero = false): Held | null {
    if (hours <= 0 || !this.canHold(village, now, day)) return null;
    const station = village.station!;
    const held: Held = {
      who, village: village.name, hero, hours, until: now + hours / JAIL.HOURS_A_DAY, fine,
      x: station.doorX + 0.5, z: station.doorZ + 0.5,
    };
    const cell = this.cellOf(village.name);
    cell.held = held;
    /*
     * And the same act writes the line on the sheet, which is the only place it could be written.
     *
     * Every way anybody ends up behind a door in this world goes through here — a constable
     * catching the hero, a village putting its own villain away — so a sheet kept anywhere else
     * would be a second list that had to be remembered about, and the one arrest somebody forgot
     * to report would be the one the player wanted to read about.
     *
     * The hero goes down as "You" because that is what the sheet says when you are shown it: the
     * name on a charge sheet is the name of whoever was charged, and yours is the one you know.
     */
    cell.sheet.push({ who: hero ? 'You' : who, village: village.name, day, hours, fine });
    if (cell.sheet.length > JAIL.SHEET_KEPT) cell.sheet.splice(0, cell.sheet.length - JAIL.SHEET_KEPT);
    return held;
  }

  /**
   * A constable has laid hands on the hero somewhere. Finds the cell they will be walked to and
   * settles the fine; winding the clock is left to whoever owns it, because only the world can
   * make the hours actually pass.
   */
  take(villages: Village[], x: number, z: number, who: string, hours: number, now: number, day: number, purse: number): Held | null {
    const village = this.nearest(villages, x, z, now, day);
    if (!village) return null;
    return this.commit(village, who, hours, now, day, fineFor(hours, purse), true);
  }

  /** Open the door early. The only way anybody leaves before their hour, short of the roof coming off. */
  release(village: string): Held | null {
    const cell = this.cells.get(village);
    const held = cell?.held ?? null;
    if (cell) cell.held = null;
    return held;
  }

  /**
   * The station has been broken open. Whoever was inside is out, and the village is without law
   * until the timber is back up, which is a long enough while for everybody to notice.
   */
  brokenOpen(village: string, day: number): Held | null {
    const cell = this.cellOf(village);
    const freed = cell.held;
    cell.held = null;
    cell.standingAgain = day + JAIL.REBUILD_DAYS;
    return freed;
  }

  /** The station is a building again, however many days early. */
  rebuild(village: string): void {
    this.cellOf(village).standingAgain = JAIL.NEVER;
  }

  /** For the save: only the cells that have anything to say are worth writing down. */
  toJSON(): JailSave {
    const cells: JailSave['cells'] = [];
    for (const [village, cell] of this.cells) {
      if (!cell.held && cell.standingAgain === JAIL.NEVER && cell.sheet.length === 0) continue;
      cells.push({ village, held: cell.held, standingAgain: cell.standingAgain, sheet: cell.sheet });
    }
    return { cells };
  }
}
