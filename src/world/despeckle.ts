import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { BIOMES } from './biomes';
import { DESPECKLE_MAJORITY, GROUND_ALT_CHANCE, TileType, isFlatLand, type SampleGrid } from './terrain';

/**
 * Taking the speckle out of a chunk of ground.
 *
 * Terraced land sampled tile by tile comes out with single tiles a step above or below their
 * neighbours — true to the arithmetic and wrong to the eye, because a field with one raised tile in
 * the middle of it reads as a bug rather than as ground. A tile that disagrees with the majority of
 * what is around it is brought into line with them.
 *
 * Kept apart from the sampler because it is about how ground looks rather than about how high it
 * is, and because the sampler is the longest thing in the world.
 */
export function despeckle(grid: SampleGrid, gi: number, seed: number): { type: TileType; level: number } {
  let type = grid.type[gi] as TileType;
  let level = grid.level[gi];
  if (!isFlatLand(type) || grid.bank[gi] || type === TileType.Sand) return { type, level };
  const counts = new Map<number, number>();
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dz === 0) continue;
    const ni = gi + dz * grid.G + dx;
    if (!isFlatLand(grid.type[ni] as TileType)) continue;
    counts.set(grid.level[ni], (counts.get(grid.level[ni]) ?? 0) + 1);
  }
  let mode = level, modeN = 0;
  for (const [l, cnt] of counts) if (cnt > modeN) { modeN = cnt; mode = l; }
  if (modeN < DESPECKLE_MAJORITY || mode === level) return { type, level };
  level = mode;
  const def = BIOMES[grid.biome[gi]];
  const tx = grid.x0 + (gi % grid.G), tz = grid.z0 + Math.floor(gi / grid.G);
  if (level - grid.base[gi] >= def.highAt) type = TileType.High;
  else if (type === TileType.High) type = rand2(seed, tx, tz, TILE_SALT.GROUND_VARIANT) < GROUND_ALT_CHANCE ? TileType.GroundAlt : TileType.Ground;
  return { type, level };
}

