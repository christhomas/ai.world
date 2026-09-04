import { hashString, mulberry32, shuffle } from '../core/rng';
import { derive } from '../core/salts';
import type { Structures } from '../world/structures';

/**
 * Danger that will not stay where you left it.
 *
 * A herd belongs to a chunk and a haunt belongs to a ruin, and both are the right answer to their
 * own question: wildlife is a fact about the ground and a wight is a fact about the barrow. But a
 * world made only of those is a world you learn once. The wolf wood is on the map by your second
 * evening, the road round it is on the map by your third, and after that the country is scenery.
 *
 * A band is the other thing. It is a pack of something with teeth that works a round of places,
 * and where it is depends on what day it is. The road that was clear on Tuesday has a war band on
 * it on Friday, the village that was doing well enough has buried four people while you were at
 * sea, and the only way to know is to go and look. That is what makes the same country worth
 * crossing twice.
 *
 * The decision worth arguing about is where the line between derived and remembered falls. Where
 * a band is comes out of the seed and the day and nothing else, exactly as a pod of whales does,
 * so two people a continent apart agree about the road without a byte passing between them. What
 * has been done to it does not: killing is the one thing about a band that no seed could have
 * predicted, so losses are counted and travel, the way a violent death travels to the register.
 * Free where it can be, sent where it must be, and never the two mixed.
 *
 * The ebb is the second half of the idea. A band's temper is rolled per spell of days rather than
 * per day, and rises and falls across the spell rather than sitting flat, so a village gets bad
 * fortnights and quiet ones. Without that, pressure is a slope: every village in the world slides
 * towards empty at the same rate and arriving anywhere in time is luck. With it, a place that is
 * losing people is losing them to something in particular, which is a thing a player can go and
 * deal with.
 */

/**
 * The stream bands are rolled from. Its home is the table in `core/salts.ts` beside every other
 * named stream in the game, and it waits here only until it can be moved across.
 */
const SALT_ROAM = 0x20a3;

export const ROAM = {
  /**
   * Bands abroad in one world. Set against sixteen villages, so most places have something
   * working the country near them most of the time and nowhere is permanently safe.
   */
  BANDS: 24,
  /** Places in a band's round. Four is enough that where it will be next is not obvious. */
  STOPS: 4,
  /**
   * How far from its first stop a round reaches, in tiles. A band belongs to a quarter of the
   * country rather than to the whole of it, which is the only reason holding a region is a
   * different job from holding a world.
   */
  CIRCUIT: 110,
  /** Days a band takes to get from one stop to the next, fewest and most, standing about included. */
  PACE_LEAST: 2,
  PACE_MOST: 4,
  /**
   * Share of each leg a band spends stood over the place it has just walked to rather than on the
   * road to the next one. Without it a band merely passes a village and a village merely has a bad
   * afternoon; with it, arriving somewhere is a week that place will remember.
   */
  DWELL: 0.5,
  /**
   * What sorts walk the roads: how many stand in one when it is whole, how hard it leans on a
   * village, and how much of the country is theirs. Wolves are most of it because a wolf pack is
   * something a new player can actually beat; the ogre is one in ten because a thing that takes
   * thirty hits to put down is a week's ambition, not an evening's.
   */
  SORTS: {
    wolf: { least: 4, most: 7, menace: 0.5, share: 0.45 },
    bear: { least: 2, most: 3, menace: 0.7, share: 0.2 },
    skeleton: { least: 3, most: 5, menace: 0.85, share: 0.25 },
    ogre: { least: 1, most: 1, menace: 1, share: 0.1 },
  },
  /** Days a band's temper holds before it rolls another. A bad spell is about a week. */
  SPELL: 6,
  /** Share of spells a band spends leaving everybody alone. It is still out there. */
  QUIET: 0.35,
  /** How near a village a band has to be, in tiles, before the village feels it at all. */
  PRESS_WITHIN: 40,
  /**
   * The most people a band takes from one village in one day, standing on the doorstep at its
   * worst. Pitched just above the pace a village replaces its dead at, so a band merely passing
   * through is survivable and a band that has settled in is not.
   */
  TAKES: 3,
  /** What a night in the open near a pressed village is multiplied by, at full pressure. */
  NIGHTS_WORSE: 2,
  /**
   * Days a broken band's ground stays quiet before something else moves into it. Long enough
   * that clearing your own country buys you an evening of peace and not merely an hour.
   */
  BROKEN_FOR: 5,
  /** How near, in tiles, before a band is stood up in the world as creatures. */
  SIGHT: 50,
  /** And how far off before they are taken away again. The slack stops them blinking. */
  LEAVE: 70,
  /** The ground one person calls theirs, in tiles: near enough to walk back to before dark. */
  REGION: 160,
  /**
   * Bands one person can keep broken at once while still having a life. A band is a real fight
   * and a trek to reach, and it is back in five days whatever you do about it, so this is a rate
   * dressed as a number: hold about five, and the sixth is loose somewhere behind you.
   */
  HOLD: 5,
} as const;

/** What sort of thing a band is made of. Every one of these is a kind the spawner already knows. */
export type BandKind = keyof typeof ROAM.SORTS;

/** A place on a band's round: somewhere the world already put on the map. */
export interface Stop {
  name: string;
  x: number;
  z: number;
}

/** Somewhere a band can lean on. A village satisfies this as it stands. */
export interface Steading {
  name: string;
  x: number;
  z: number;
}

/** A pack of something dangerous, and the round of places it works. */
export interface Band {
  /**
   * Which of the world's bands this is. It names the slot rather than the pack, so the thing that
   * moves in after one is broken carries the same id and a later `era`.
   */
  id: string;
  /** How many packs have held this ground before this one. */
  era: number;
  kind: BandKind;
  /** How many stand in it when nobody has done anything about it. */
  size: number;
  /** The places it works, in order and back round to the first. */
  circuit: Stop[];
  /** Days it spends walking one leg. */
  pace: number;
  /** How far into its round it was on the world's first day, so bands are not in step. */
  offset: number;
  /** Its own stream, for its temper and for who it takes. */
  seed: number;
}

/** Where a band is today, and what it is walking between. */
export interface Where {
  x: number;
  z: number;
  /** The place it walked to, which it is either stood on or setting out from. */
  from: Stop;
  to: Stop;
  /** How far along the road between them, 0 to 1. */
  through: number;
  /** True while it is camped on `from` rather than out on the road. */
  standing: boolean;
}

/**
 * What a band is doing to a village, for whoever keeps the village. Nothing here is applied:
 * this file has no business burying anybody, and the register has no business knowing what a
 * band is.
 */
export interface Pressing {
  band: Band;
  village: string;
  /** How hard it is leaning, 0 to 1. */
  pressure: number;
  /** What a night in the open hereabouts is multiplied by. */
  nights: number;
  /** How many of the village's people it takes today. Nearly always nought. */
  toll: number;
  /** How somebody who lives there would put it. */
  said: string;
}

/**
 * One of a band put down. The one thing about a band that cannot be worked out from the seed, so
 * it is the one thing that has to travel between players.
 */
export interface Fell {
  band: string;
  era: number;
  /** Which member, so the same kill arriving twice is still one kill. */
  member: number;
  day: number;
}

/** What to hold on disk: the killing, and nothing that the seed already knows. */
export interface RoamingJson {
  /** Every member anybody has put down, as `band#era#member`. */
  lost: string[];
  /** The day each band was finished, by band id. */
  broken: Record<string, number>;
  /** How many packs have held each band's ground. */
  era: Record<string, number>;
}

/** The grounds of a world, dealt out in an order that is the same for everybody who asks. */
function homesOf(seed: number, stops: readonly Stop[]): Stop[] {
  return shuffle(mulberry32(derive(seed, SALT_ROAM)), [...stops]);
}

/** Which sort of band a roll makes, by how much of the country each sort is meant to have. */
function sortOf(roll: number): BandKind {
  let seen = 0;
  for (const kind of Object.keys(ROAM.SORTS) as BandKind[]) {
    seen += ROAM.SORTS[kind].share;
    if (roll < seen) return kind;
  }
  return 'wolf';
}

/**
 * Everywhere in a world a band would walk to. Villages and the marked places between them, which
 * is to say the places the roads already go, so a band on its way somewhere is on a road.
 */
export function stopsOf(structures: Structures): Stop[] {
  const stops: Stop[] = structures.villages.map((v) => ({ name: v.name, x: v.x, z: v.z }));
  for (const poi of structures.pois) stops.push({ name: poi.name, x: poi.x, z: poi.z });
  return stops;
}

/**
 * Roll one band. Pure in seed, stops, slot and era, so the pack that moves into a broken band's
 * ground is the same pack for everybody without anybody being told what it is.
 */
export function bandFor(seed: number, stops: readonly Stop[], slot: number, era: number): Band {
  const rng = mulberry32(derive(seed, SALT_ROAM) ^ Math.imul(slot, 0x9e37) ^ Math.imul(era, 0x85eb));
  const kind = sortOf(rng());
  // one ground each, dealt out of the same shuffled deck for every slot and every era. Two bands
  // sharing a home would heap the world's danger in one county and leave another empty, and a
  // ground that stays dangerous ground after the pack on it is broken is the truer story anyway
  const home = homesOf(seed, stops)[slot % stops.length];
  const away = (s: Stop) => Math.hypot(s.x - home.x, s.z - home.z);
  // the round is drawn from what lies near home, and only falls back to the nearest places
  // anywhere when home is somewhere nothing else is: a band that could be summoned to the far
  // side of the world would make every region everybody's problem
  const others = stops.filter((s) => s !== home).sort((a, b) => away(a) - away(b));
  const near = others.filter((s) => away(s) <= ROAM.CIRCUIT);
  const reach = near.length >= ROAM.STOPS - 1 ? near : others;
  const sort = ROAM.SORTS[kind];
  return {
    id: `band:${slot}`,
    era,
    kind,
    size: sort.least + Math.floor(rng() * (sort.most - sort.least + 1)),
    circuit: [home, ...shuffle(rng, [...reach]).slice(0, ROAM.STOPS - 1)],
    pace: ROAM.PACE_LEAST + rng() * (ROAM.PACE_MOST - ROAM.PACE_LEAST),
    offset: rng() * ROAM.STOPS * ROAM.PACE_MOST,
    seed: (seed ^ Math.floor(rng() * 0xffffff)) >>> 0,
  };
}

/** Every band a world starts with, before anybody has done anything about any of them. */
export function planBands(seed: number, structures: Structures): Band[] {
  const stops = stopsOf(structures);
  const bands: Band[] = [];
  for (let slot = 0; slot < ROAM.BANDS; slot++) bands.push(bandFor(seed, stops, slot, 0));
  return bands;
}

/**
 * Where a band is on a given day. Pure in the band and the day, which is the whole trick: nobody
 * simulates a band and nobody synchronises one, and everybody still finds it in the same field.
 */
export function bandAt(band: Band, day: number): Where {
  const legs = Math.max(0, day + band.offset) / band.pace;
  const done = Math.floor(legs);
  const from = band.circuit[done % band.circuit.length];
  const to = band.circuit[(done + 1) % band.circuit.length];
  const into = legs - done;
  const standing = into <= ROAM.DWELL;
  const through = standing ? 0 : (into - ROAM.DWELL) / (1 - ROAM.DWELL);
  return {
    x: from.x + (to.x - from.x) * through,
    z: from.z + (to.z - from.z) * through,
    from, to, through, standing,
  };
}

/**
 * How bad a mood a band is in today, nought to one.
 *
 * Rolled per spell of days rather than per day, and lifted and dropped across the spell rather
 * than held flat, so a band has bad fortnights and quiet ones instead of a steady appetite. A
 * player who arrives during a quiet spell sees a village doing well enough with a wolf pack two
 * fields away, which is exactly the warning they should get.
 */
export function temperOf(band: Band, day: number): number {
  const since = Math.max(0, day + band.offset);
  const rng = mulberry32(band.seed ^ Math.imul(Math.floor(since / ROAM.SPELL), 0x27d4));
  const worst = rng();
  if (worst < ROAM.QUIET) return 0;
  const through = (since % ROAM.SPELL) / ROAM.SPELL;
  return worst * Math.sin(through * Math.PI);
}

/**
 * How hard a band is leaning on a place today, nought to one. Nought for a band that is nowhere
 * near, nought during a quiet spell, and nought for one that has been broken up.
 *
 * @param standing how many of it are still on their feet, out of its whole size
 */
export function pressureOn(band: Band, place: Steading, day: number, standing = band.size): number {
  if (standing <= 0) return 0;
  const now = bandAt(band, day);
  const away = Math.hypot(place.x - now.x, place.z - now.z);
  if (away >= ROAM.PRESS_WITHIN) return 0;
  const close = 1 - away / ROAM.PRESS_WITHIN;
  return ROAM.SORTS[band.kind].menace * (standing / band.size) * temperOf(band, day) * close;
}

/** What a night in the open near a pressed village is worth multiplying by. */
export function nightsNear(pressure: number): number {
  return 1 + Math.max(0, pressure) * ROAM.NIGHTS_WORSE;
}

/**
 * How many of a village's people a band takes today.
 *
 * Rolled from the band, the village and the day, so it is the same number on every screen and the
 * same number when a client that was offline yesterday works out what it missed. Whoever keeps
 * the register decides who: this only says how many.
 */
export function tollOf(band: Band, place: Steading, day: number, pressure: number): number {
  if (pressure <= 0) return 0;
  const rng = mulberry32(band.seed ^ hashString(place.name) ^ Math.imul(Math.floor(day), 0x1b3f));
  // the fraction is settled by the roll rather than rounded away, so light pressure is an
  // occasional funeral instead of no funeral at all
  return Math.floor(pressure * ROAM.TAKES + rng());
}

/** How somebody who lives in the place would put what is happening to it. */
export function saidOf(band: Band, place: Steading, pressure: number): string {
  const what = told(band);
  if (pressure >= 0.6) return `${what} are on ${place.name}. Nobody is sleeping and nobody is going out.`;
  if (pressure >= 0.25) return `${what} have been at ${place.name} for days. We have buried people over it.`;
  return `${what} have been seen near ${place.name}. The dogs have not settled since.`;
}

/**
 * Everything a band is doing to a village today, or null when it is doing nothing. Handed back
 * rather than applied: burying people is the register's business and this file will not do it.
 */
export function pressingOn(band: Band, place: Steading, day: number, standing = band.size): Pressing | null {
  const pressure = pressureOn(band, place, day, standing);
  if (pressure <= 0) return null;
  return {
    band,
    village: place.name,
    pressure,
    nights: nightsNear(pressure),
    toll: tollOf(band, place, day, pressure),
    said: saidOf(band, place, pressure),
  };
}

/** The bands standing over any of these places today, whatever sort of mood they happen to be in. */
export function bandsOver(bands: readonly Band[], places: readonly Steading[], day: number): Band[] {
  return bands.filter((band) => {
    const now = bandAt(band, day);
    return places.some((p) => Math.hypot(p.x - now.x, p.z - now.z) < ROAM.PRESS_WITHIN);
  });
}

/** The places near enough to one spot that one person could be expected to keep an eye on them. */
export function regionOf<T extends Steading>(places: readonly T[], x: number, z: number): T[] {
  return places.filter((p) => Math.hypot(p.x - x, p.z - z) <= ROAM.REGION);
}

/** The bands close enough to somebody to be worth standing up in the world, nearest first. */
export function bandsNear(bands: readonly Band[], x: number, z: number, day: number, within = ROAM.SIGHT): Band[] {
  return bands
    .map((band) => ({ band, away: distanceTo(band, x, z, day) }))
    .filter((b) => b.away <= within)
    .sort((a, b) => a.away - b.away)
    .map((b) => b.band);
}

/** How far a band is from a point today, in tiles. */
export function distanceTo(band: Band, x: number, z: number, day: number): number {
  const now = bandAt(band, day);
  return Math.hypot(now.x - x, now.z - z);
}

/** What a band is called, in the words anybody would use for it. */
export function told(band: Band): string {
  switch (band.kind) {
    case 'wolf': return 'Wolves';
    case 'bear': return 'Bears';
    case 'skeleton': return 'The walking dead';
    case 'ogre': return 'Something very large';
  }
}

/**
 * One line for somebody who has just come over a rise and found it, which is where this whole
 * design has to become legible or it is merely unfair. Each says what a player can do about it.
 */
export function warningFor(band: Band): string {
  const home = band.circuit[0].name;
  switch (band.kind) {
    case 'wolf':
      return `A wolf pack is working the roads out of ${home}. Kill enough of them and the rest scatter.`;
    case 'bear':
      return `Bears have come down as far as ${home}. There are not many, and every one of them is worth a fight you have thought about.`;
    case 'skeleton':
      return `Something that was buried near ${home} is walking, and it is not walking alone.`;
    case 'ogre':
      return `Something very large has taken the road by ${home}. You can outrun it. You will not outlast it.`;
  }
}

/**
 * The bands of one world, and what has been done to them.
 *
 * Everything derived lives in the functions above and costs nothing to ask twice. This holds the
 * one thing they cannot know: who has been killed. It is kept by member rather than counted, so
 * the same kill arriving twice from two clients is still one kill, and so a client that has been
 * away can be handed the whole list and arrive where everybody else already is.
 */
export class Roaming {
  private readonly stops: Stop[];
  private readonly lost = new Set<string>();
  private readonly broken = new Map<string, number>();
  private readonly era = new Map<string, number>();
  private day: number;

  constructor(private readonly seed: number, structures: Structures, day = 1) {
    this.stops = stopsOf(structures);
    this.day = Math.floor(day);
  }

  /** The day this has caught up to. */
  get today(): number { return this.day; }

  /** One band by its slot, in whatever era its ground is presently in. */
  bandOf(slot: number): Band {
    return bandFor(this.seed, this.stops, slot, this.era.get(`band:${slot}`) ?? 0);
  }

  /** Every band in the world, broken ones included: the whole roster, in slot order. */
  roster(): Band[] {
    const all: Band[] = [];
    for (let slot = 0; slot < ROAM.BANDS; slot++) all.push(this.bandOf(slot));
    return all;
  }

  /** Every band actually out in the country. A broken one is not in it, and nor is its ground. */
  abroad(): Band[] {
    return this.roster().filter((band) => !this.isBroken(band));
  }

  /** How many of a band are still on their feet. */
  standing(band: Band): number {
    let up = band.size;
    for (const key of this.lost) if (key.startsWith(`${band.id}#${band.era}#`)) up--;
    return Math.max(0, up);
  }

  /** Has this band been broken up? Its ground is quiet until something else moves in. */
  isBroken(band: Band): boolean {
    return this.broken.has(band.id) || this.standing(band) <= 0;
  }

  /** The day something else moves into a broken band's ground, or null while it is still whole. */
  backOn(band: Band): number | null {
    const finished = this.broken.get(band.id);
    return finished === undefined ? null : finished + ROAM.BROKEN_FOR;
  }

  /**
   * One of a band has been put down. Returns what to send everybody else, or null when this kill
   * has already been accounted for, so the caller can tell news from an echo.
   */
  felled(band: Band, member: number, day = this.day): Fell | null {
    const fell: Fell = { band: band.id, era: band.era, member, day: Math.floor(day) };
    return this.apply(fell) ? fell : null;
  }

  /**
   * A kill that happened on somebody else's screen, or on this one. Returns whether it was news.
   * A kill against an era that has already been and gone changes nothing: that pack is long dead.
   */
  apply(fell: Fell): boolean {
    if ((this.era.get(fell.band) ?? 0) !== fell.era) return false;
    const key = `${fell.band}#${fell.era}#${fell.member}`;
    if (this.lost.has(key)) return false;
    this.lost.add(key);

    const slot = Number(fell.band.slice('band:'.length));
    if (this.standing(this.bandOf(slot)) <= 0 && !this.broken.has(fell.band)) {
      this.broken.set(fell.band, fell.day);
    }
    return true;
  }

  /**
   * Catch up to a day: anything broken long enough ago has something new move into its ground.
   * Returns the bands that have just arrived, which is worth a word to anybody nearby.
   */
  advance(today: number): Band[] {
    const end = Math.floor(today);
    if (end <= this.day) { this.day = Math.max(this.day, end); return []; }
    this.day = end;

    const arrived: Band[] = [];
    for (const [id, finished] of [...this.broken]) {
      if (end - finished < ROAM.BROKEN_FOR) continue;
      this.broken.delete(id);
      const era = (this.era.get(id) ?? 0) + 1;
      this.era.set(id, era);
      // the dead pack's losses go with it: nothing about it is true of what has taken its place
      for (const key of [...this.lost]) if (key.startsWith(`${id}#`)) this.lost.delete(key);
      arrived.push(this.bandOf(Number(id.slice('band:'.length))));
    }
    return arrived;
  }

  /** Everything every band is doing to these villages today, worst first. */
  pressings(places: readonly Steading[], day = this.day): Pressing[] {
    const out: Pressing[] = [];
    for (const band of this.abroad()) {
      for (const place of places) {
        const pressing = pressingOn(band, place, day, this.standing(band));
        if (pressing) out.push(pressing);
      }
    }
    return out.sort((a, b) => b.pressure - a.pressure);
  }

  /** What to hold on disk. */
  save(): RoamingJson {
    return {
      lost: [...this.lost],
      broken: Object.fromEntries(this.broken),
      era: Object.fromEntries(this.era),
    };
  }

  /** A world's bands as somebody left them. */
  static from(seed: number, structures: Structures, json: Partial<RoamingJson> | undefined, day = 1): Roaming {
    const roaming = new Roaming(seed, structures, day);
    for (const key of json?.lost ?? []) roaming.lost.add(key);
    for (const [id, on] of Object.entries(json?.broken ?? {})) roaming.broken.set(id, on);
    for (const [id, era] of Object.entries(json?.era ?? {})) roaming.era.set(id, era);
    return roaming;
  }
}
