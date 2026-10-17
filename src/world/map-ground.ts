import { BIOMES, type Biome } from './biomes';
import type { RoadGraph } from './graph';

/**
 * What the map needs of the terrain, and nothing else.
 *
 * Narrow on purpose: the map asks what is at a point and does not want the sampler's hundred other
 * answers, so the two can be tested apart and the map cannot quietly grow a dependency on how the
 * ground is built.
 */
export interface MapGround {
  probe(x: number, z: number): { land: boolean; biome: Biome };
  /**
   * How high the rock stands at a point, in world units, or nought where there is none.
   *
   * Mountains are not in the heightfield of a polygon world — they are geometry standing on it —
   * so a map drawn from the ground alone shows a range as ordinary highland. Optional, because the
   * road-tree world has no such thing and its mountains are already in the ground it is drawn from.
   */
  rock?: (x: number, z: number) => number;
}

/** The sea, as the map draws it. */
export const SEA_RGB = 0x1b4466;

/**
 * Sea left round the outside of the drawn country, in tiles.
 *
 * The map is as big as the roads it has to draw, and the last road is not the last land: the
 * ground is a band either side of one, twenty-odd tiles of it at its widest, and the coast and its
 * shallows lie beyond that. Too little and a map ends in a straight green line where the canvas
 * stopped rather than where the country did. Too much and every map is mostly empty sea, at four
 * bytes and one probe of the terrain for every pixel of it.
 */
const MAP_MARGIN = 32;

/**
 * How far the map reaches from the middle of the world, in tiles: as far out as the roads go, and
 * a margin of sea.
 *
 * It used to be the world's radius plus a few tiles, which is the same number for a mainland and
 * wrong for everything else: the islands are anchored past where the mainland reaches, so on a
 * world whose islands stand seven hundred tiles out the map ended at four hundred and eighty and
 * they were simply not on it. A patch of an endless world has no radius to be padded out to at
 * all, and this asks it the only question that has an answer anywhere: where is the furthest thing
 * you are asking me to draw.
 */
export function mapPad(graph: RoadGraph): number {
  return graph.nodes.reduce((most, n) => Math.max(most, Math.abs(n.x), Math.abs(n.z)), 0) + MAP_MARGIN;
}

/** The height at which rock is drawn as pale as it gets, in world units. */
const MAP_SUMMIT = 52;
const MAP_ROCK = 0x8d8d8d;
const MAP_SNOW = 0xeef2f5;

/** Rock on the map: grey at the foot, white at the top of the tallest thing a world holds. */
function overRock(ground: number, high: number): number {
  const up = Math.max(0, Math.min(1, high / MAP_SUMMIT));
  const mix = (from: number, to: number, shift: number): number =>
    Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * up);
  const rock = up > 0.72 ? MAP_SNOW : MAP_ROCK;
  return (mix(ground, rock, 16) << 16) | (mix(ground, rock, 8) << 8) | mix(ground, rock, 0);
}

/**
 * The colour of the map at a point of the world: the ground as it actually is, and rock over the
 * top of it going white at the summits, so a range reads as a range at a glance rather than as a
 * patch of highland that happens to be a different green.
 */
export function groundColour(ground: MapGround, x: number, z: number): number {
  const here = ground.probe(x, z);
  const colour = here.land ? BIOMES[here.biome].ground : SEA_RGB;
  const high = ground.rock ? ground.rock(x, z) : 0;
  return high > 0 ? overRock(colour, high) : colour;
}

/**
 * The map as an installed app draws it (#575): the same ground and the same roads as the page's
 * map, at one cell per `cell` tiles, built once.
 *
 * The page writes its map pixel by pixel into a canvas. An app is sent the picture instead, as few
 * numbers as it can be: the colours once, then the cells row by row as runs of one colour — mostly
 * sea, which is one long run. Cell (i, j) covers the world from (i * cell - pad, j * cell - pad).
 */
export interface MapPicture {
  pad: number;
  cell: number;
  /** Cells to a side; the picture is square. */
  size: number;
  /** `0xrrggbb` colours, indexed by the runs. */
  colours: number[];
  /** Pairs of a colour index and how many cells in a row have it, across the rows in order. */
  runs: number[];
  /** Each road as a straight stroke: x and z of one end, of the other, and the road's width. */
  roads: number[];
}

export function mapPicture(graph: RoadGraph, ground: MapGround, cell = 2): MapPicture {
  const pad = mapPad(graph);
  const size = Math.ceil((pad * 2) / cell);
  const colours: number[] = [];
  const index = new Map<number, number>();
  const runs: number[] = [];
  let last = -1;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // the middle of the cell, which is what it most nearly is
      const colour = groundColour(ground, (i + 0.5) * cell - pad, (j + 0.5) * cell - pad);
      let at = index.get(colour);
      if (at === undefined) { at = colours.push(colour) - 1; index.set(colour, at); }
      if (at === last && i > 0) runs[runs.length - 1]++;
      else runs.push(at, 1);
      last = at;
    }
  }
  const roads: number[] = [];
  for (const e of graph.edges) {
    const a = graph.nodes[e.a], b = graph.nodes[e.b];
    roads.push(a.x, a.z, b.x, b.z, e.roadWidth * 2);
  }
  return { pad, cell, size, colours, runs, roads };
}
