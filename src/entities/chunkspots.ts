import { WORLD } from '../core/config';
import { Biome } from '../world/biomes';
import { TileType } from '../world/terrain';
import type { ChunkTiles } from '../world/tiles';

/**
 * Reading a chunk for the places something could be put.
 *
 * Spawning asks two questions of a square of ground — where could this stand, and what country is
 * this — and both are answered by walking the tiles once. Kept apart from the manager because they
 * are about the ground rather than about the creatures on it, and because the manager is already
 * the longest thing in the game.
 */

export interface SortedTiles {
  land: number[];
  water: number[];
  road: number[];
  /** The country most of this chunk is in, which decides what would live here. */
  biome: Biome;
}

/** Every tile of a chunk, sorted into what could stand on it. */
export function sortTiles(tiles: ChunkTiles): SortedTiles {
  const CS = WORLD.CHUNK_SIZE;
  const land: number[] = [], water: number[] = [], road: number[] = [];
  const biomeCount = new Map<number, number>();
  for (let i = 0; i < CS * CS; i++) {
    const t = tiles.types[i];
    if (t === TileType.Ground || t === TileType.GroundAlt || t === TileType.Sand) {
      if (!tiles.blocked[i]) land.push(i);
      biomeCount.set(tiles.biomes[i], (biomeCount.get(tiles.biomes[i]) ?? 0) + 1);
    } else if (t === TileType.Water) {
      water.push(i);
    } else if (t === TileType.Road || t === TileType.Bridge) {
      road.push(i);
    }
  }
  let biome = 0 as Biome, best = -1;
  for (const [b, n] of biomeCount) if (n > best) { best = n; biome = b as Biome; }
  return { land, water, road, biome };
}

/** The middle of a tile, in world coordinates: where something standing on it would stand. */
export function tileCentre(tiles: ChunkTiles, i: number): [number, number] {
  const CS = WORLD.CHUNK_SIZE;
  return [tiles.cx * CS + (i % CS) + 0.5, tiles.cz * CS + Math.floor(i / CS) + 0.5];
}
