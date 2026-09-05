import { remember, type Person } from '../world/people';
import {
  dayUnderground, freshMine, perilAfter, restOvernight, saidOfMine, toldOfMine, type Mine,
} from './mining';

/**
 * The world's mines as the world actually holds them: which village works which hole in which
 * hillside, what came up out of it yesterday, and what the people living round it believe.
 *
 * mining.ts is the arithmetic of one day at one face and knows nothing else. This is the part
 * that has a map in front of it. It exists because for a long time nothing at all called
 * mining.ts: the maths was written, tested and unreached, so the game had a beautifully modelled
 * source of money that never minted a coin and villages that grew poorer for ever.
 *
 * Three things are kept here rather than derived, and each is here for its own reason:
 *
 * - what has been taken out of a mine and what the village believes about it, because both are
 *   consequences of days that have already been lived and cannot be worked back out of the seed
 * - how many of the things living down there have been killed, because that is the player's
 *   doing and the only number in the economy a sword can move
 * - the last day every mine has been worked up to, so a world reopened after a fortnight runs
 *   the fortnight rather than one very profitable morning
 *
 * A mine is keyed by its dungeon anchor id, which is the same string `places.enterDungeon` is
 * handed for that cave. That is deliberate and load-bearing: the workings the village is
 * frightened of and the tunnels the player walks into have to be the same place, or clearing one
 * out changes nothing about the other.
 */

/** Tuning for how a village finds a mine, works it, and hears about it. Distances in tiles. */
export const MINES = {
  /**
   * How near a cave has to be for a village to call it their mine.
   *
   * Generous, and deliberately so. Caves are placed on high ground and villages are placed where
   * people would live, so the two are rarely neighbours; at a hundred tiles most of the world's
   * villages have no mine at all and the whole economy has no source again. This is about a
   * morning's walk, which is what a working day at a face actually costs somebody.
   */
  WITHIN: 220,
  /**
   * How many villages a bad day underground is talked about in: the one that works the mine, and
   * this many of its nearest neighbours.
   *
   * One would mean you could only ever hear about a mine by standing next to it, which makes the
   * fear invisible until it is too late to be interesting. This is what lets somebody in a pub
   * two villages away warn you off a place you have never been.
   */
  HEARD_IN: 2,
  /**
   * How many people in a village carry the story.
   *
   * Nobody holds more than a couple of memories, so telling everybody would mean a whole village
   * that can talk about nothing but the mine — and would push out the deaths, which are the more
   * important news. A handful of people who will mention it is how a rumour actually behaves.
   */
  TOLD: 3,
} as const;

/** Anything on the map with a name: a village, or a hole in a hillside. */
interface Somewhere { name: string; x: number; z: number }

/**
 * Which cave each village calls its mine.
 *
 * Nearest pairs are matched first and a cave is only ever claimed once, so a hole sitting between
 * two villages goes to the one it is on the doorstep of rather than to whichever village happened
 * to come first in the list. One cave, one crew: two villages working the same seam would each
 * take a full day's gold out of it and the mine would empty twice as fast as anybody watching it
 * could account for.
 *
 * Pure in the structures, which are pure in the seed, so every client agrees about who works what
 * without a word passing between them.
 */
export function claimedMines<C extends Somewhere & { id: string }>(
  villages: readonly Somewhere[], caves: readonly C[], within = MINES.WITHIN,
): Map<string, C> {
  const pairs: Array<{ village: string; cave: C; d: number }> = [];
  for (const village of villages) {
    for (const cave of caves) {
      const d = Math.hypot(cave.x - village.x, cave.z - village.z);
      if (d <= within) pairs.push({ village: village.name, cave, d });
    }
  }
  // distance decides, and the names break a tie, so the answer never depends on array order
  pairs.sort((a, b) => a.d - b.d || a.village.localeCompare(b.village) || a.cave.id.localeCompare(b.cave.id));

  const claimed = new Map<string, C>();
  const taken = new Set<string>();
  for (const pair of pairs) {
    if (claimed.has(pair.village) || taken.has(pair.cave.id)) continue;
    claimed.set(pair.village, pair.cave);
    taken.add(pair.cave.id);
  }
  return claimed;
}

/** The anchor id of the workings under a cave — the same string the dungeon is entered by. */
export function mineIdOf(cave: { id: string }): string {
  return `cave:${cave.id}`;
}

/** One village and the mine it works, as the day loop needs to be told about it. */
export interface Working {
  /** The village whose people go down. */
  village: string;
  /** The anchor id of the workings, which is also the mine's key. */
  mine: string;
  /** What the place is called out loud, because that is what people say when they talk about it. */
  name: string;
  /** Where it is, so whatever a dead miner was carrying can be left at the mouth of it. */
  x: number;
  z: number;
  /** The villages the story reaches, nearest first, this one included. */
  heardIn: readonly string[];
}

/** What one village's day at one mine came to, for whoever has to act on it. */
export interface Digging {
  village: string;
  /** The mine's anchor id and the name people call it by. */
  mine: string;
  name: string;
  x: number;
  z: number;
  day: number;
  /** Gold brought up, already shared out among the people who went down. */
  gold: number;
  /** Somebody was frightened badly enough that the village heard about it. */
  scared: boolean;
  /**
   * Who did not come back, still on the register.
   *
   * Handed back rather than buried here, for the same reason the night raids are: burying people
   * is the register's business and this file will not do it. What they had on them is `dropped`,
   * and it is lying on the floor of the mine for whoever goes to look.
   */
  lost: Person | null;
  dropped: number;
}

/** What a mine looks like on disk. Small, and one entry per mine anybody has ever worked. */
export interface MineJson {
  id: string;
  worked: number;
  dread: number;
  /** How many of the things living in it have been killed. */
  cleared: number;
}

export interface MinesJson {
  /** The last whole day every mine has been worked up to. */
  day: number;
  mines: MineJson[];
}

export class Mines {
  /** Every mine anybody has worked, by anchor id. */
  private readonly mines = new Map<string, Mine>();
  /** And how much of what lived in each has been killed, which is the only number a player owns. */
  private readonly cleared = new Map<string, number>();
  /** The last whole day the mines have been worked up to. */
  private day: number;

  constructor(private readonly seed: number, day = 1) {
    this.day = Math.floor(day);
  }

  /** The day the mines have caught up to. */
  get today(): number { return this.day; }

  /** What a mine is like now, or nothing for one nobody has worked yet. */
  at(id: string): Mine | undefined { return this.mines.get(id); }

  /**
   * How dangerous a mine actually is today, as opposed to how dangerous the village thinks it is.
   * Those two numbers being allowed to disagree is the whole of the design.
   */
  perilOf(id: string): number { return perilAfter(this.cleared.get(id) ?? 0); }

  /** What the village would say about the place, or nothing when there is nothing to say. */
  saidOf(id: string): string {
    const mine = this.mines.get(id);
    return mine ? saidOfMine(mine) : '';
  }

  /**
   * Something living in the workings has been killed.
   *
   * Counted rather than remembered creature by creature: the dungeon behind an anchor is regrown
   * from its seed every time anybody walks into it, so there is no such thing as a particular
   * troll that stays dead. What survives being walked away from is how much of the place has been
   * fought through, and that is exactly what the danger down there is made of.
   */
  slain(id: string | null, many = 1): void {
    if (!id) return;
    this.cleared.set(id, (this.cleared.get(id) ?? 0) + many);
  }

  /**
   * Somebody has come up out of the workings and told the village what is down there now.
   *
   * This is the half of task the player cannot do with a sword. Clearing a mine changes the mine;
   * it does not change what anybody believes about it, and a village that believes its mine is
   * haunted stays at home whatever is actually true. So the word has to be carried, and carrying
   * it is what turns an afternoon of fighting into a village that goes back to work.
   *
   * Returns what has changed, for saying out loud, or null when the word tells them nothing they
   * did not already believe — which is what happens when you report on a mine you never cleared.
   */
  told(id: string, name: string): string | null {
    const mine = this.mines.get(id);
    if (!mine) return null;
    const after = toldOfMine(mine, this.perilOf(id));
    if (after.dread >= mine.dread - 0.005) return null;
    this.mines.set(id, after);
    return after.dread <= 0.05
      ? `Word goes round ${name} is quiet again. They will be back at the face in the morning.`
      : `They take some convincing about ${name}, but fewer of them are staying home now.`;
  }

  /**
   * Run every mine forward to today.
   *
   * A mine begins the day its village comes onto the register and not on day one. The register
   * relives a village from its founding whenever somebody first walks into it, and a mine cannot:
   * we have no idea how many miners the place had on its fortieth day, so a back-filled year
   * would be a made-up year, and two players who arrived on different days would disagree about
   * how rich the village is and how frightened it is. Starting from now is a smaller lie and a
   * quieter one.
   *
   * `folkOf` is asked for each village's people again on every simulated day rather than once, so
   * a crew that has just been buried is not still down the mine tomorrow morning.
   */
  advance(
    today: number, workings: readonly Working[], folkOf: (village: string) => readonly Person[],
  ): Digging[] {
    const out: Digging[] = [];
    const end = Math.floor(today);

    while (this.day < end) {
      this.day++;
      for (const working of workings) out.push(...this.workADay(working, this.day, folkOf));
    }
    return out;
  }

  /** One village, one mine, one day: what came up, who did not, and who heard about it. */
  private workADay(
    working: Working, day: number, folkOf: (village: string) => readonly Person[],
  ): Digging[] {
    const crew = folkOf(working.village).filter((p) => p.trade === 'miner');
    const mine = this.mines.get(working.mine) ?? freshMine(working.mine);
    // one stream per mine, so two mines in the same world never have the same day
    const shift = dayUnderground(this.seed ^ hashOf(working.mine), day, mine, crew.length, this.perilOf(working.mine));
    this.mines.set(working.mine, restOvernight(mine, shift));
    if (shift.gold === 0 && !shift.scared) return [];

    // the takings are shared out among the people who actually went down, which is what puts real
    // money on the register rather than a stipend standing in for one. Shared to the coin: a
    // rounded share each leaves dust, and dust in a mint is money the world invented
    let left = shift.gold;
    for (let n = 0; n < crew.length; n++) {
      const share = Math.round(left / (crew.length - n));
      crew[n].purse += share;
      left -= share;
    }

    const lost = shift.lost && crew.length > 0 ? crew[Math.abs(hashOf(`${working.mine}:${day}`)) % crew.length] : null;
    if (shift.scared) this.tellThem(working, day, folkOf);
    return [{
      village: working.village, mine: working.mine, name: working.name, x: working.x, z: working.z,
      day, gold: shift.gold, scared: shift.scared, lost, dropped: shift.dropped,
    }];
  }

  /**
   * A bad day at the face becomes a thing people say.
   *
   * It goes into the same memories a death goes into, and comes back out through the same
   * conversation, because it is the same kind of fact: something happened here and the only
   * record of it is in the heads of the people it happened near. Named by the mine rather than by
   * a person, which memories already allow for — a name outlives whatever it belonged to, and a
   * place name outlives everybody.
   */
  private tellThem(working: Working, day: number, folkOf: (village: string) => readonly Person[]): void {
    for (const village of working.heardIn) {
      // at home the miners carry it, because they were there. Everywhere else it is whoever the
      // village happens to put in front of you, which is how a story arrives in the next valley
      const folk = [...folkOf(village)]
        .sort((a, b) => Number(b.trade === 'miner') - Number(a.trade === 'miner'));
      for (const person of folk.slice(0, MINES.TOLD)) {
        remember(person, { what: 'feared', who: working.name, day });
      }
    }
  }

  /** What to hold on disk: the worked-out seams, the fear, and what has been fought out of them. */
  save(): MinesJson {
    const mines: MineJson[] = [];
    for (const [id, mine] of this.mines) {
      mines.push({ id, worked: mine.worked, dread: mine.dread, cleared: this.cleared.get(id) ?? 0 });
    }
    // a mine nobody has worked but somebody has fought through is still worth keeping: it is a
    // cleared-out cave waiting for its village to be told about it
    for (const [id, cleared] of this.cleared) {
      if (!this.mines.has(id)) mines.push({ id, worked: 0, dread: 0, cleared });
    }
    return { day: this.day, mines };
  }

  /** The world's mines as somebody left them. */
  static from(seed: number, json: Partial<MinesJson> | undefined, day = 1): Mines {
    const mines = new Mines(seed, json?.day ?? day);
    for (const held of json?.mines ?? []) {
      mines.mines.set(held.id, { id: held.id, worked: held.worked, dread: held.dread });
      if (held.cleared > 0) mines.cleared.set(held.id, held.cleared);
    }
    return mines;
  }
}

/** A stable number for a mine's id, so one mine's luck is never another's. */
function hashOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
