import { GRAPH } from '../core/config';
import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { Biome } from './biomes';
import { Simplex2D } from './noise';

export interface RoadNode {
  x: number;
  z: number;
  parent: number;
  depth: number;
  level: number;
  size: number;
}

export interface RoadEdge {
  a: number;
  b: number;
  width: number;
  roadWidth: number;
  loop: boolean;
}

export interface IslandInfo {
  id: string;
  seed: number;
  x: number;
  z: number;
  radius: number;
  biome: Biome;
  hub: number;
  firstNode: number;
}

export interface RoadGraph {
  seed: number;
  radius: number;
  nodes: RoadNode[];
  edges: RoadEdge[];
  towns: number[];
  hub?: number;
  islands: IslandInfo[];
  mainlandNodes: number;
  sectors: Biome[];
  sectorOffset: number;
}

export interface SectorMix {
  biome: Biome;
  other: Biome;
  t: number;
}

const TAU = Math.PI * 2;
const ISLAND_BIOME_MARGIN = 40;
const BLEND_TILES = 10;
export type Pie = Pick<RoadGraph, 'islands' | 'sectors' | 'sectorOffset'>;

export function sectorMix(graph: Pie, noise: Simplex2D, x: number, z: number): SectorMix {
  for (const island of graph.islands) {
    if (Math.hypot(x - island.x, z - island.z) < island.radius + ISLAND_BIOME_MARGIN) {
      return { biome: island.biome, other: island.biome, t: 0 };
    }
  }
  const r = Math.hypot(x, z);
  const count = graph.sectors.length;
  const warp = noise.fbm(x * 0.008, z * 0.008, 2) * 0.55;
  const damp = Math.min(1, Math.max(0, (r - GRAPH.HUB_RADIUS) / 60));
  let angle = Math.atan2(z, x) + warp * damp - graph.sectorOffset;
  angle = ((angle % TAU) + TAU) % TAU;
  const position = (angle / TAU) * count;
  const index = Math.floor(position) % count;
  const fraction = position - Math.floor(position);
  const sector = graph.sectors[index];
  const arc = Math.max(1, r) * (TAU / count);
  const width = Math.min(0.45, BLEND_TILES / arc);
  let other = sector, t = 0;
  if (fraction < width) {
    other = graph.sectors[(index + count - 1) % count];
    t = 0.5 * (1 - fraction / width);
  } else if (fraction > 1 - width) {
    other = graph.sectors[(index + 1) % count];
    t = 0.5 * (1 - (1 - fraction) / width);
  }
  const clearing = GRAPH.HUB_RADIUS * 1.15;
  if (r < clearing) {
    const blend = 0.5 * (1 - Math.min(1, (clearing - r) / BLEND_TILES));
    return { biome: Biome.Plains, other: sector, t: blend };
  }
  const blend = 0.5 * (1 - Math.min(1, (r - clearing) / BLEND_TILES));
  if (blend > t) { other = Biome.Plains; t = blend; }
  return { biome: sector, other, t };
}

export function biomeAt(graph: RoadGraph, noise: Simplex2D, x: number, z: number): Biome {
  const mix = sectorMix(graph, noise, x, z);
  if (mix.t <= 0) return mix.biome;
  return rand2(graph.seed, Math.floor(x), Math.floor(z), TILE_SALT.BIOME_DITHER) < mix.t ? mix.other : mix.biome;
}

export function segDist2(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number,
): [number, number] {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const vv = vx * vx + vz * vz;
  let t = vv > 0 ? (wx * vx + wz * vz) / vv : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + vx * t - px;
  const dz = az + vz * t - pz;
  return [dx * dx + dz * dz, t];
}
