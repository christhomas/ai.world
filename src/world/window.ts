import { GRAPH, HYDRO, WORLD } from '../core/config';
import type { RoadGraph } from './graph';
import type { Lake } from './rivers';
import { CellIndex } from './spatial';
import { structureBounds, type Structures } from './structures';

/**
 * What a sampler holds, and how much of it a window keeps.
 *
 * The ground is painted by asking three questions about a tile — which road is nearest, which
 * water, which building — and each is answered from an index of everything in the world that could
 * be the answer. A world with an edge can afford one of each, built once, holding everything there
 * is. An endless one cannot: there is no "everything".
 *
 * So a sampler may be given a window, and then it holds only what reaches into it. The argument
 * that this is free is entirely in the margins below. Each thing is indexed under the box it can
 * paint ground in — a road plus how far the land spreads from it, a river plus its banks, a
 * building plus its own footprint — so a box that does not touch the window cannot be the answer to
 * anything asked from inside it, and dropping it changes no tile.
 *
 * The window prunes what is *kept*, not yet what is *grown*: the rivers are still routed and the
 * villages still founded across the whole map before anything is let go. That is the order the work
 * goes in — this says what bounded has to mean, and each source moves behind it in turn.
 * `window.test.ts` is what holds it to that: a windowed sampler paints its own patch exactly as a
 * sampler of the whole world does.
 */

/** A patch of country a sampler is being asked about, in tiles. */
export interface Within {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** How coarse the index grids are, in tiles. */
export const CELL = 32;

/**
 * How far from a road's line its ground can reach: the widest band of land, and the seabed beyond
 * it, since a road near the coast paints the shallows too.
 */
export const EDGE_MARGIN = GRAPH.MAX_WIDTH * 1.45 + WORLD.SEABED_RANGE + 2;
/** A river's own width plus its banks. */
export const RIVER_MARGIN = HYDRO.RIVER_MAX_WIDTH + HYDRO.BANK + 8;
/** A lake's banks. Its radius wobbles, so the caller adds a fraction of that as well. */
export const LAKE_MARGIN = HYDRO.BANK + 8;

/** One straight run of a river, with its level and width at either end. */
export interface RiverSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  la: number;
  lb: number;
  wa: number;
  wb: number;
}

/** Does a thing's reach, given as the box it is indexed under, come into the window at all? */
function meets(within: Within | null, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  if (!within) return true;
  return maxX >= within.x0 && minX <= within.x1 && maxZ >= within.z0 && minZ <= within.z1;
}

/** Every road, under the ground it can paint. */
export function indexRoads(graph: RoadGraph, within: Within | null): CellIndex {
  const { nodes, edges } = graph;
  const index = new CellIndex(CELL, edges.length);
  edges.forEach((e, i) => {
    const a = nodes[e.a], b = nodes[e.b];
    const minX = Math.min(a.x, b.x) - EDGE_MARGIN, minZ = Math.min(a.z, b.z) - EDGE_MARGIN;
    const maxX = Math.max(a.x, b.x) + EDGE_MARGIN, maxZ = Math.max(a.z, b.z) + EDGE_MARGIN;
    if (meets(within, minX, minZ, maxX, maxZ)) index.insert(i, minX, minZ, maxX, maxZ);
  });
  return index;
}

/** The rivers and the lakes in one index: ids past the last river segment are lakes. */
export function indexWater(segs: RiverSeg[], lakes: Lake[], within: Within | null): CellIndex {
  const index = new CellIndex(CELL, segs.length + lakes.length);
  segs.forEach((s, i) => {
    const minX = Math.min(s.ax, s.bx) - RIVER_MARGIN, minZ = Math.min(s.az, s.bz) - RIVER_MARGIN;
    const maxX = Math.max(s.ax, s.bx) + RIVER_MARGIN, maxZ = Math.max(s.az, s.bz) + RIVER_MARGIN;
    if (meets(within, minX, minZ, maxX, maxZ)) index.insert(i, minX, minZ, maxX, maxZ);
  });
  lakes.forEach((l, i) => {
    const m = l.r * 1.3 + LAKE_MARGIN;
    if (meets(within, l.x - m, l.z - m, l.x + m, l.z + m)) {
      index.insert(segs.length + i, l.x - m, l.z - m, l.x + m, l.z + m);
    }
  });
  return index;
}

/** Everything built, under its own footprint. A tile past a wall is not that building's business. */
export function indexStructures(structures: Structures, within: Within | null): CellIndex {
  const index = new CellIndex(CELL, structures.all.length);
  structures.all.forEach((s, i) => {
    const b = structureBounds(s);
    if (meets(within, b.minX, b.minZ, b.maxX + 1, b.maxZ + 1)) {
      index.insert(i, b.minX, b.minZ, b.maxX + 1, b.maxZ + 1);
    }
  });
  return index;
}
