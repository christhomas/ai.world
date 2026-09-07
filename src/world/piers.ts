import type { Pier } from './structures';
import type { TerrainSampler, TileSample } from './terrain';
import { TileType } from './terrain';

/**
 * Laying a jetty out from a shore.
 *
 * An island and the mainland each get one facing the other, and a ferry runs between the two dock
 * tiles at their ends. Out of `structures.ts` because it is the one job in there that is about a
 * coast rather than about a settlement, and that file had run out of room.
 */

/** Deck tiles laid into the water once the land has run out. */
const PIER_LENGTH = 6;

/** How far a jetty will walk looking for a coast before giving up on this direction. */
const PIER_WALK_MAX = 260;

/**
 * Walk from a start point toward a direction (snapped to an axis) until the land ends, then lay
 * `PIER_LENGTH` deck tiles into the sea. Null if the walk never reaches a coast.
 */
export function planPier(
  sampler: TerrainSampler, sample: TileSample, island: string, side: Pier['side'],
  fromX: number, fromZ: number, dirX: number, dirZ: number,
): Pier | null {
  const dx = Math.abs(dirX) >= Math.abs(dirZ) ? Math.sign(dirX) : 0;
  const dz = dx === 0 ? Math.sign(dirZ) || 1 : 0;
  let x = Math.floor(fromX), z = Math.floor(fromZ);
  let lastLandLevel = 1;
  for (let i = 0; i < PIER_WALK_MAX; i++) {
    sampler.sampleTile(x, z, sample);
    const land = sample.type !== TileType.Skip && sample.type !== TileType.Seabed;
    if (!land) {
      if (i === 0) return null;
      const tiles: Array<[number, number]> = [];
      for (let k = 0; k < PIER_LENGTH; k++) tiles.push([x + dx * k, z + dz * k]);
      return { island, side, tiles, dx, dz, level: lastLandLevel, dockX: x + dx * PIER_LENGTH, dockZ: z + dz * PIER_LENGTH };
    }
    if (sample.type !== TileType.Water && sample.type !== TileType.Bridge) lastLandLevel = Math.max(1, Math.round(sample.level));
    x += dx; z += dz;
  }
  return null;
}
