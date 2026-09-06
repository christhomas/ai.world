import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { BIOMES, PropKind, pickWeighted } from './biomes';
import { mountainAt, type Ranges } from './ranges';
import {
  COAST_PROP_FACTOR, HIGH_ROCK_DENSITY, PROP_HEADROOM, ROAD_SHOULDER, TileType, type SampleGrid,
} from './terrain';

/**
 * What grows on a tile.
 *
 * A table lookup and a die: the biome says what could be here and how thickly, the tile says
 * whether anything can be, and the seed says which one it is. Kept apart from the sampler because
 * it is about what stands on the ground rather than about where the ground is.
 */
/** Majority filter: a lone tile a terrace off from its neighbourhood joins the crowd. */
export function rollProp(
grid: SampleGrid, gi: number, type: TileType, seed: number, ranges: Ranges | null,
): PropKind {
  const tx = grid.x0 + (gi % grid.G), tz = grid.z0 + Math.floor(gi / grid.G);
  // Nothing grows under a mountain. The ground beneath one is still generated — it is what the
  // rock stands on, and the rim needs it — but a tree rooted in ground that is now the inside of
  // a mountain is a trunk sticking out of a cliff. A hand's breadth of clearance rather than
  // nought, so the skirt where the rock meets the grass still has its scrub.
  if (ranges) {
    const rock = mountainAt(ranges, tx + 0.5, tz + 0.5);
    if (rock !== null && rock > grid.height[gi] + PROP_HEADROOM) return PropKind.None;
  }
  const def = BIOMES[grid.biome[gi]];
  const r = rand2(seed, tx, tz, TILE_SALT.PROP_ROLL);
  const kindRoll = rand2(seed, tx, tz, TILE_SALT.PROP_KIND);
  if (type === TileType.Water) return r < def.waterDensity ? pickWeighted(def.water, kindRoll) : PropKind.None;
  if (grid.bank[gi]) return r < def.bankDensity ? pickWeighted(def.bank, kindRoll) : PropKind.None;
  if (grid.roadDist[gi] < grid.roadWidth[gi] + ROAD_SHOULDER) return PropKind.None;
  switch (type) {
    case TileType.High: return r < HIGH_ROCK_DENSITY ? (kindRoll < 0.5 ? PropKind.Rock : PropKind.Boulder) : PropKind.None;
    case TileType.Ground:
    case TileType.GroundAlt: return r < def.propDensity ? pickWeighted(def.props, kindRoll) : PropKind.None;
    case TileType.Sand: return r < def.bankDensity * COAST_PROP_FACTOR ? pickWeighted(def.bank, kindRoll) : PropKind.None;
    default: return PropKind.None;
  }
}

/** Flatten yards, lay door paths, and drop each building prop on its centre tile. */
/** Which village a structure belongs to, by whose radius it falls inside. Empty for the wild. */
