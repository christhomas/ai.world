import { WORLD } from '../core/config';
import type { Biome } from './biomes';

/**
 * What a tile is, as everything that draws or walks one needs it.
 *
 * Split out of `terrain.ts`, which decides these; this only says what they are. The two are worth
 * keeping apart because the deciding is long and the vocabulary is read by half the game — the
 * mesher, the walker, the map, the props, the save — none of which cares how a tile was arrived at.
 */

/** What is drawn on top of a tile. Skip = nothing at all (open sea, no floor). */
export const enum TileType {
  Skip = 0,
  Seabed = 1,
  Ground = 2,
  GroundAlt = 3,
  Sand = 4,
  Road = 5,
  High = 6,
  Water = 7,   // river / lake bed; surface height lives in ChunkData.water
  Bridge = 8,  // road over water
  Floor = 9,   // under a building; blocked for walkers
  Plaza = 10,  // town square cobbles; walkable, flat
  Pier = 11,   // wooden deck over water; walkable, flat
}

/**
 * One chunk of tiles including a one-tile apron on every side so the mesher can
 * look at neighbours without asking for adjacent chunks. Index = (z + 1) * size + (x + 1)
 * where x,z are 0..CHUNK_SIZE-1 local coords; the apron occupies index -1 and CHUNK_SIZE.
 */
export interface ChunkData {
  cx: number;
  cz: number;
  size: number;          // CHUNK_SIZE + 2
  height: Float32Array;  // top surface y in world units (for water tiles: the bed)
  type: Uint8Array;      // TileType
  biome: Uint8Array;     // Biome
  prop: Uint8Array;      // PropKind
  /** Fixed prop yaw for structures; NaN = random. */
  propRot: Float32Array;
  shore: Float32Array;   // for seabed tiles: tiles from the coast (0 = at the coast)
  /** Heights at the 4 corners (NW, NE, SE, SW). Flat tiles repeat their own height four times. */
  corners: Float32Array;
  /**
   * 1 where the tile is a face of a mountain and is drawn as one leaning surface rather than a
   * terrace. Terraces are the look of this world and stay exactly as they were; a mountain is
   * cut from a smooth field, and mixing the two — a flat tile height with sloped corners — draws
   * tops and walls that disagree and tears the mesh apart.
   */
  sloped: Uint8Array;
  /** Water surface height for Water/Bridge tiles, 0 elsewhere. */
  water: Float32Array;
  empty: boolean;
}

/** Raw terrain at one tile, before structures are stamped on. */
export interface TileSample {
  type: TileType;
  level: number;
  /** Terrace the road sits on here; High ground is measured from it. */
  base: number;
  height: number;
  water: number;
  shore: number;
  biome: Biome;
  bank: boolean;
  roadDist: number;
  roadWidth: number;
  corners: [number, number, number, number];
  /** Whether this tile is part of a mountain face, and so drawn as a slope rather than a step. */
  sloped: boolean;
}

export interface Probe {
  land: boolean;
  biome: Biome;
  /** Distance to nearest road centreline, Infinity if no road is anywhere near. */
  roadDist: number;
  hub: boolean;
}

/** Share of ground tiles that use the alternate ground colour. */
export const GROUND_ALT_CHANCE = 0.35;
/** Neighbours (of 8) that must agree before the de-speckle filter overrides a tile's level. */
export const DESPECKLE_MAJORITY = 5;
/** Tiles beyond the road edge kept free of props. */
export const ROAD_SHOULDER = 1.2;
/** How far a mountain has to stand above the ground before nothing grows under it, in units. */
export const PROP_HEADROOM = 1.5;
export const HIGH_ROCK_DENSITY = 0.06;
/** Coast sand gets this fraction of the bank prop density. */
export const COAST_PROP_FACTOR = 0.25;
/** Bridge decks sit this far above the river surface. */
export const BRIDGE_DECK_LIFT = 0.14;


export interface SampleGrid {
  G: number;
  x0: number;
  z0: number;
  type: Uint8Array;
  biome: Uint8Array;
  bank: Uint8Array;
  level: Float32Array;
  height: Float32Array;
  water: Float32Array;
  shore: Float32Array;
  roadDist: Float32Array;
  roadWidth: Float32Array;
  sloped: Uint8Array;
  base: Int16Array;
  corners: Float32Array;
}

/** Tiles whose level the de-speckle filter may compare and adjust. */
export function isFlatLand(t: TileType): boolean {
  return t === TileType.Ground || t === TileType.GroundAlt || t === TileType.High || t === TileType.Sand;
}
