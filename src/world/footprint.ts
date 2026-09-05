import type { TerrainSampler, TileSample } from './terrain';
import { TileType } from './terrain';

/**
 * Will this patch of ground take a building, and at what terrace?
 *
 * This is the ground half of the question a village asks itself when it decides where a house
 * goes: every tile of the footprint has to be dry land on one level, with no road running through
 * it. The yard ring around the footprint is checked too but allowed to be a road or a slope,
 * because a house with its door onto the lane is the point and a house on a cliff edge is not.
 *
 * It is pulled out of `generateStructures` and exported because the player can now commission a
 * house of their own by standing somewhere and saying there, and that has to be judged by exactly
 * the rule the world judges its own houses by. Two implementations of "will this ground take a
 * building" would drift, and the one that drifted would be the one the player was standing on.
 *
 * Returns the terrace the building would sit on, or null if the ground will not have it. Pass a
 * `sample` to reuse when calling this in a loop; generation does, so laying out sixteen villages
 * costs one of them rather than a hundred thousand.
 */
export function footprintLevel(
  sampler: TerrainSampler, tx: number, tz: number, hw: number, hd: number,
  level: number | null, sample: TileSample = sampler.newSample(),
): number | null {
  let lvl = level;
  for (let dz = -hd - 1; dz <= hd + 1; dz++) {
    for (let dx = -hw - 1; dx <= hw + 1; dx++) {
      sampler.sampleTile(tx + dx, tz + dz, sample);
      const t = sample.type;
      const inner = Math.abs(dx) <= hw && Math.abs(dz) <= hd;
      if (t === TileType.Skip || t === TileType.Seabed || t === TileType.Water || t === TileType.Bridge) return null;
      if (inner && t === TileType.Road) return null;
      if (!inner) continue; // the yard ring may be a road or slope; it just must be land
      if (lvl === null) lvl = sample.level;
      else if (sample.level !== lvl) return null;
    }
  }
  return lvl;
}
