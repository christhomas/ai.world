import type { PatchParts } from '../src/world/endless';
import type { RoadGraph } from '../src/world/graph';
import type { Highland } from '../src/world/highland';
import type { Anchor } from '../src/world/manifest';
import type { Hydrology } from '../src/world/rivers';
import type { Structures } from '../src/world/structures';
import { TerrainSampler } from '../src/world/terrain';
import type { TerrainLayer } from '../src/world/terrainlayers';

/**
 * A road country grown somewhere else, as the parts that survive a `postMessage`.
 *
 * The road graph itself is cheap: a fifth of a second on the Pi. What is not cheap is everything
 * `TerrainSampler` works out from it — the rivers and the villages — which is eight seconds of one
 * core on the same machine, measured on seed 12345, and was the whole of the freeze in #479. Handed
 * those, a sampler is rebuilt in about a quarter of a second, and paints the same tiles: the rest of
 * what it holds is noise and indexes, which are a function of the seed and cost nothing to make again.
 *
 * `islands` travel back because a fresh world's islands are planned while it is grown, and the
 * manifest has to be told them: they are written down the moment they are known. See `islandsFor`.
 */
export interface RoadParts {
  islands: readonly Anchor[];
  graph: RoadGraph;
  hydro: Hydrology;
  structures: Structures;
}

/**
 * Where a joining world's expensive ground comes from, when it is not this thread.
 *
 * The ground worker is one; a test holding a country back is another. The simulation asks and
 * rebuilds, and never learns which it was talking to.
 */
export interface GroundSource {
  grow(seed: number, patch: string, layers: readonly Highland[], terrain: readonly TerrainLayer[]): Promise<PatchParts>;
  growRoad(seed: number, islands: readonly Anchor[]): Promise<RoadParts>;
}

/** What a grown road country has to hand over to be rebuilt on the simulation's thread. */
export function roadPartsOf(islands: readonly Anchor[], sampler: TerrainSampler): RoadParts {
  return { islands, graph: sampler.graph, hydro: sampler.hydro, structures: sampler.structures };
}

/** The road country again, from its parts: rivers and villages as they were grown, not grown again. */
export function rebuildRoad(parts: RoadParts): TerrainSampler {
  return new TerrainSampler(parts.graph, { hydro: parts.hydro, structures: parts.structures });
}
