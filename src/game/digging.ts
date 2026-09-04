import { hash3, mulberry32 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { Biome } from '../world/biomes';
import { TileType, type TileSample } from '../world/terrain';

/**
 * Digging: a shovel, a likely looking slope, and whatever the hill has been keeping.
 *
 * What lies under a tile is rolled from the world seed and the tile's own coordinates, so two
 * players who have never spoken turn up the same nugget on the same hillside and nothing has to
 * travel between them. It is a fact about the world rather than a thing that happens in it, which
 * is why nothing here is saved and nothing here is sent.
 *
 * The decision worth explaining is which holes are remembered: only the ones that paid. Barren
 * ground rolls barren for ever, so there is nothing to farm there and nothing to write down; that
 * leaves the memory small enough to keep in a session and throw away with it.
 */

export const DIG = {
  /** Share of flat meadow that holds anything at all. Most holes are just a hole. */
  BASE: 0.05,
  /** Each terrace a tile stands above its road multiplies the odds again: metal comes out of hillsides, not lawns. */
  PER_TERRACE: 0.35,
  /** No ground is ever better than this, however high and stony it gets. */
  RICHEST: 0.45,
  /** Of the tiles that hold something, this share is gold. The rest is silver. */
  GOLD_SHARE: 0.25,
  /** A silver seam gives one to this many pieces. Gold is a nugget, and one nugget. */
  SILVER_PIECES: 3,
  /** Holes one sitting remembers. Beyond it the oldest is forgotten, so a long walk does not grow without end. */
  HOLES: 512,
} as const;

/**
 * How much better than meadow each country is to dig. The highlands keep the metal because that
 * is where the world put its rock; the marsh keeps water and nothing else.
 */
const SEAM: Record<Biome, number> = {
  [Biome.Plains]: 1,
  [Biome.Forest]: 1.2,
  [Biome.Desert]: 1.6,
  [Biome.Swamp]: 0.4,
  [Biome.Mountain]: 3.4,
  [Biome.Snow]: 2.2,
};

/** What digging cares about at a tile: the country, how high it stands, and whether a spade goes in. */
export interface Ground {
  biome: Biome;
  /** Terraces above the road running past, which is the nearest thing this world has to a hill. */
  rise: number;
  /** Water, sea, roads and floors take no spade. */
  soft: boolean;
}

/** What came out of the hole. */
export interface Find {
  /** Item id: gold or silver, both of which a shop will take. */
  item: string;
  count: number;
}

/** Tiles a spade goes into: bare ground, sand and bare rock, never water, road, deck or floor. */
function takesSpade(type: TileType): boolean {
  return type === TileType.Ground || type === TileType.GroundAlt
    || type === TileType.Sand || type === TileType.High;
}

const key = (tx: number, tz: number): string => `${Math.floor(tx)},${Math.floor(tz)}`;

/** Read a sampled tile the way somebody holding a shovel reads it. */
export function groundOf(tile: Pick<TileSample, 'type' | 'biome' | 'level' | 'base'>): Ground {
  return {
    biome: tile.biome,
    rise: Math.max(0, tile.level - tile.base),
    soft: takesSpade(tile.type),
  };
}

/** How likely this ground is to hold anything, 0 where a spade will not go. */
export function richness(ground: Ground): number {
  if (!ground.soft) return 0;
  return Math.min(DIG.RICHEST, DIG.BASE * SEAM[ground.biome] * (1 + ground.rise * DIG.PER_TERRACE));
}

/**
 * What is under one tile, for anybody who digs it. Pure in (seed, tile), so the same hillside
 * answers the same way on every machine and for the life of the world.
 */
export function seamAt(seed: number, tx: number, tz: number, ground: Ground): Find | null {
  const chance = richness(ground);
  if (chance <= 0) return null;
  const roll = mulberry32(hash3(seed, Math.floor(tx), Math.floor(tz), TILE_SALT.DIG_SEAM));
  if (roll() >= chance) return null;
  // the land decides how often you find something; which metal it is, is the luck of the hole
  if (roll() < DIG.GOLD_SHARE) return { item: 'nugget', count: 1 };
  return { item: 'silverore', count: 1 + Math.floor(roll() * DIG.SILVER_PIECES) };
}

/**
 * The holes dug this sitting. Local and unsaved on purpose: the seam is derivable, so the only
 * work left is stopping a player who has found one lucky tile from pressing Enter until they are
 * rich on it.
 */
export class Digging {
  private readonly order: string[] = [];
  private readonly dug = new Set<string>();

  /** Has this tile already given up what it had? */
  turned(tx: number, tz: number): boolean {
    return this.dug.has(key(tx, tz));
  }

  /**
   * Turn over a tile. Returns what came out, or null when the ground held nothing or has already
   * been dug. An empty hole is not remembered, because the roll will say the same next time.
   */
  dig(seed: number, tx: number, tz: number, ground: Ground): Find | null {
    if (this.turned(tx, tz)) return null;
    const found = seamAt(seed, tx, tz, ground);
    if (!found) return null;
    this.dug.add(key(tx, tz));
    this.order.push(key(tx, tz));
    if (this.order.length > DIG.HOLES) this.dug.delete(this.order.shift()!);
    return found;
  }
}
