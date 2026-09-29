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

/** How long a preparing page waits on one answer from a ground source before it is refused. */
export const PREPARE_TIMEOUT = 180_000;

/**
 * The waits a world's preparation makes on its ground source, and when each one stops.
 *
 * A source that never answered held its page at "preparing" for ever, and every later join to that
 * world queued behind it, and the World Editor refused the world as busy (#480). So a wait ends one
 * of three ways: the answer, a refusal once it has run past `timeout`, or the page leaving — which
 * is not worth waiting out, because somebody else may be queued behind a page that is no longer
 * there. Longer than the ground worker's own limit, so a stuck thread says so first.
 */
export class Preparations {
  private readonly stops = new Map<object, (error: Error) => void>();

  constructor(private readonly timeout = PREPARE_TIMEOUT) {}

  wait<T>(page: object, asked: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let over = false;
      const stop = (error: Error) => finish(() => reject(error));
      const finish = (settle: () => void) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        if (this.stops.get(page) === stop) this.stops.delete(page);
        settle();
      };
      const timer = setTimeout(() => stop(new Error('The country took too long to grow. Try joining again.')), this.timeout);
      this.stops.set(page, stop);
      asked.then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error)));
    });
  }

  /** The page has gone: whatever it was waiting on is no longer anybody's business. */
  left(page: object): void {
    this.stops.get(page)?.(new Error('The page left before its country was ready.'));
  }
}
