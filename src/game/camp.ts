import { hash3, mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { BIOME_ANIMALS, KINDS, pickKind, type SpawnWeight } from '../entities/animals';
import { Biome } from '../world/biomes';
import type { Village } from '../world/structures';
import { MORNING } from './state';

/**
 * Camping: a night in the open, and what the open thinks about that.
 *
 * A room at an inn is ten gold, a locked door and full hearts by morning. A tent is none of those
 * things: it gives back half of you, it costs nothing, and it is pitched out where things live.
 * That is the trade, and it is the whole reason to carry a tent, because the country is far
 * wider than the villages dotted through it.
 *
 * How a night goes is rolled from the seed, the day and the tile, so it is a fact about that spot
 * on that night rather than something that happens to you: two players who pitch on the same
 * ground are woken by the same wolf, and nothing has to be sent between them to arrange it.
 *
 * The decision worth explaining is that what comes is read off the same spawn table the country
 * is populated from. A biome that gains a predator gains a bad night with it, and nobody has to
 * remember to write the danger down in a second place where it could quietly go stale.
 */

export const CAMP = {
  /** Share of full health a whole night under canvas gives back. A bed at an inn gives all of it. */
  MENDS: 0.5,
  /** Chance of a visitor in country where nothing much hunts. Sleeping outdoors is never nothing. */
  RESTLESS: 0.06,
  /** What the country's own hunters add on top of that, at their share of everything living there. */
  PROWL: 1.2,
  /** No night is worse than this, however deep the wood. */
  WORST: 0.45,
  /** Tiles from the edge of a village at which its lamps and its dogs stop making any difference. */
  LONELY: 50,
  /** How far off the visitor stands when you open your eyes, in tiles: near enough that running is a decision. */
  CLOSE: 3,
  /** What comes where nothing dangerous lives. A wolf will walk a very long way towards a fire. */
  STRANGER: 'wolf',
} as const;

/** What surrounds a camp, which is all the night cares about. */
export interface Country {
  biome: Biome;
  /** Tiles to the edge of the nearest village, and Infinity when there is not one anywhere near. */
  toVillage: number;
}

/** A night in the open, as it turned out. */
export interface Night {
  /** Share of the night actually slept: all of it when nothing came. */
  slept: number;
  /** The kind that came, or null for a night that passed quietly. */
  visitor: string | null;
  /** How far off it is when you open your eyes, in tiles. */
  away: number;
  /** Which way, in radians, so the same wolf comes from the same side of the fire for everybody. */
  bearing: number;
}

/** The kinds in a country that would walk into a camp: whatever lives there and bites. */
export function huntersOf(biome: Biome): SpawnWeight[] {
  return BIOME_ANIMALS[biome].filter((s) => (KINDS[s.kind]?.dangerous ?? 0) > 0);
}

/** Share of everything living in a country that hunts, weighted the way the spawner weights it. */
function prowlerShare(biome: Biome): number {
  let living = 0;
  let hunting = 0;
  for (const s of BIOME_ANIMALS[biome]) {
    living += s.weight;
    if ((KINDS[s.kind]?.dangerous ?? 0) > 0) hunting += s.weight;
  }
  return living > 0 ? hunting / living : 0;
}

/**
 * How likely a night on this ground is to be broken. Nought inside a village, because whatever
 * hunts alone will not come at a street: that is what a village is for, and it is why paying for
 * a bed buys certainty as well as hearts.
 */
export function dangerOf(land: Country): number {
  const wild = Math.min(CAMP.WORST, CAMP.RESTLESS + prowlerShare(land.biome) * CAMP.PROWL);
  const alone = Math.min(1, Math.max(0, land.toVillage) / CAMP.LONELY);
  return wild * alone;
}

/**
 * The night at one spot. Pure in (seed, day, tile), so the same ground on the same night goes the
 * same way however often it is asked and whoever is asking.
 */
export function nightAt(seed: number, day: number, tx: number, tz: number, land: Country): Night {
  const roll = mulberry32(hash3(derive(seed, SALT.CAMP), Math.floor(tx), Math.floor(tz), day));
  if (roll() >= dangerOf(land)) return { slept: 1, visitor: null, away: 0, bearing: 0 };
  // whatever lives here, or else the one that goes everywhere: an empty table is not a safe night
  const visitor = pickKind(huntersOf(land.biome), roll()) ?? CAMP.STRANGER;
  // an hour before dawn is a different night from one before midnight, so when it comes is most
  // of what a broken night costs you
  return { slept: roll(), visitor, away: CAMP.CLOSE, bearing: roll() * Math.PI * 2 };
}

/**
 * Hearts a night like this gives back to a sleeper who can hold this many. Healing follows the
 * hours slept rather than arriving whole at dawn, which is the difference between a tent and a
 * bed: a night that ends with a wolf in it mends almost nothing.
 */
export function heartsFrom(night: Night, maxHp: number): number {
  return Math.round(maxHp * CAMP.MENDS * night.slept);
}

/**
 * Where the clock stands when you get up, given the hour you lay down at. The night runs from
 * there to first light, crossing midnight on the way if it has to, and `days` says whether the
 * date turned over while you were asleep.
 */
export function wakes(night: Night, laidDownAt: number): { time: number; days: number } {
  const toDawn = (MORNING - laidDownAt + 1) % 1;
  // lying down exactly at first light means sleeping the whole day round, not sleeping no time
  const length = toDawn === 0 ? 1 : toDawn;
  const woke = laidDownAt + length * night.slept;
  return { time: woke % 1, days: Math.floor(woke) };
}

/** Tiles from a spot to the edge of the nearest village, and Infinity where there is none. */
export function tilesToVillage(
  villages: readonly Pick<Village, 'x' | 'z' | 'radius'>[], x: number, z: number,
): number {
  let best = Infinity;
  for (const village of villages) {
    best = Math.min(best, Math.max(0, Math.hypot(village.x - x, village.z - z) - village.radius));
  }
  return best;
}
