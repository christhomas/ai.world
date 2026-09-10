import { hash3, mulberry32 } from '../core/rng';
import { SALT, TILE_SALT } from '../core/salts';
import { Biome } from './biomes';
import { TileType, type TileSample } from './terrain';

/**
 * What a piece of ground is holding: metal under it, and leaf on it.
 *
 * Both are rolled from the world seed and the tile's own coordinates, so two players who have never
 * spoken turn up the same nugget on the same hillside and kneel on the same herb at the same river
 * bank, with nothing travelling between them. `digging.ts` said as much about itself long before
 * this file existed — *"a fact about the world rather than a thing that happens in it"* — and that
 * is exactly why the two of them are here now rather than in `game/`.
 *
 * The move was forced by trying to use them. A tile that grows nothing of its own should show what
 * it is hiding, because otherwise a player digs a hundred holes in ordinary dirt and never learns
 * that either system exists — and `rollProp`, which decides what a tile grows, is in `world/` and
 * could not ask a question that lived in `game/` without pointing the dependency backwards. The
 * layer was right and the code was in the wrong place.
 *
 * What stays in `game/` is what a person does about it: the spade, the mortar, the recipes, the
 * holes somebody remembers digging. This is only the ground.
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


/** Tiles a spade goes into: bare ground, sand and bare rock, never water, road, deck or floor. */
function takesSpade(type: TileType): boolean {
  return type === TileType.Ground || type === TileType.GroundAlt
    || type === TileType.Sand || type === TileType.High;
}


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


export const BREW = {
  /** Share of ordinary meadow holding a herb. Most ground is only grass. */
  BASE: 0.06,
  /** A river bank or a lake shore multiplies it: damp is the ground the leaf actually wants. */
  DAMP: 2.2,
  /** No ground is ever better than this, however wet and shaded it gets. */
  RICHEST: 0.5,
  /** Of the patches that grow at all, this share is worth two leaves rather than one. */
  HANDFUL: 0.25,
  /** Days before a picked patch has grown back. Short enough to walk a circuit of them. */
  REGROW: 3,
  /**
   * Patches one sitting remembers picking. Past it the oldest is forgotten and comes back early,
   * which is the cheaper mistake: the alternative is a set that grows for as long as you walk.
   */
  PICKED: 512,
} as const;

/**
 * How much better than meadow each country is for herbs. The wood and the marsh keep the damp and
 * the shade the leaf lives on; the dunes and the high rock keep neither, and it shows.
 */
const GROWTH: Record<Biome, number> = {
  [Biome.Plains]: 1,
  [Biome.Forest]: 1.8,
  [Biome.Desert]: 0.12,
  [Biome.Swamp]: 2.1,
  [Biome.Mountain]: 0.2,
  [Biome.Snow]: 0.35,
};

/** What growing cares about at a tile: the country, whether it is damp, and whether roots take. */
export interface Patch {
  biome: Biome;
  /** A bank or a shore, which is where the ground stays wet between one rain and the next. */
  damp: boolean;
  /** Ground a plant can root in: bare earth and sand, never rock, road, deck, floor or water. */
  rooted: boolean;
}

/** What a mortar turns one heap of things into. */
/** What came out of the hole. */
export interface Find {
  /** Item id: gold or silver, both of which a shop will take. */
  item: string;
  count: number;
}

/** Tiles a plant roots in: bare earth and sand, never bare rock, water, road, deck or floor. */
function rootsIn(type: TileType): boolean {
  return type === TileType.Ground || type === TileType.GroundAlt || type === TileType.Sand;
}

const key = (tx: number, tz: number): string => `${Math.floor(tx)},${Math.floor(tz)}`;

/** Read a sampled tile the way somebody looking for a leaf reads it. */

export function patchOf(tile: Pick<TileSample, 'type' | 'biome' | 'bank'>): Patch {
  return { biome: tile.biome, damp: tile.bank, rooted: rootsIn(tile.type) };
}

/** How likely this ground is to be growing anything, 0 where nothing roots. */
export function plenty(patch: Patch): number {
  if (!patch.rooted) return 0;
  return Math.min(BREW.RICHEST, BREW.BASE * GROWTH[patch.biome] * (patch.damp ? BREW.DAMP : 1));
}

/**
 * How many leaves one tile is holding, 0 for most of the country. Pure in (seed, tile), so the
 * same bank answers the same way on every machine and for the life of the world.
 */
export function herbAt(seed: number, tx: number, tz: number, patch: Patch): number {
  const chance = plenty(patch);
  if (chance <= 0) return 0;
  const roll = mulberry32(hash3(seed, Math.floor(tx), Math.floor(tz), SALT.HERBS));
  if (roll() >= chance) return 0;
  // the country decides how often a patch is there at all; how much of it there is, is the luck
  // of the particular square of ground
  return roll() < BREW.HANDFUL ? 2 : 1;
}

/** What a recipe still wants, by item, and how many short you are. Empty when you could grind now. */
