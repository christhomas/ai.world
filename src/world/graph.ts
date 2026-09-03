import { GRAPH } from '../core/config';
import type { Anchor } from './manifest';
import { hash3 } from '../core/rng';
import { mulberry32, rand2, shuffle, type Rng } from '../core/rng';
import { SALT, TILE_SALT, derive } from '../core/salts';
import { cellKey } from './spatial';
import { Simplex2D } from './noise';
import { Biome } from './biomes';

/**
 * Road network. A space-colonisation tree grown from the hub in continuous 2D:
 * attractor points scattered over a disc (noise-masked so some regions stay empty),
 * every attractor pulls its nearest road node, nodes grow toward the pull, attractors
 * die once reached. Result: organic 360° branching that fills space where we want it
 * and leaves sea everywhere else. Walkable land is then defined as "close to a road".
 */

export interface RoadNode {
  x: number;
  z: number;
  parent: number;   // -1 for the hub
  depth: number;
  level: number;    // terrace level the road sits on at this node
  size: number;     // subtree node count; trunks are big, twigs are 1
}

export interface RoadEdge {
  a: number;
  b: number;
  width: number;      // land half-width around this road
  roadWidth: number;  // half-width of the road surface itself
  loop: boolean;
}

/** Mutable copy of the GRAPH tuning, so islands can grow with their own settings. */
export type RoadConfig = { -readonly [K in keyof typeof GRAPH]: number };

export interface IslandInfo {
  id: string;
  seed: number;
  x: number;
  z: number;
  radius: number;
  biome: Biome;
  /** Node index of the island's hub (its harbour town). */
  hub: number;
  /** First node index belonging to this island (nodes are appended per island). */
  firstNode: number;
}

export interface RoadGraph {
  seed: number;
  radius: number;
  nodes: RoadNode[];
  edges: RoadEdge[];
  /** Node indices of town centres: each grew its own local road web, like a small hub. */
  towns: number[];
  /** Islands attached by `attachIslands`; empty for a bare mainland. */
  islands: IslandInfo[];
  /** Number of nodes that belong to the mainland (islands are appended after). */
  mainlandNodes: number;
  /** Biome order by angular sector, index 0 starting at `sectorOffset` radians. */
  sectors: Biome[];
  sectorOffset: number;
}

interface Pt { x: number; z: number }

/** Uniform grid for nearest-neighbour queries over nodes. */
class NodeGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly cell: number) {}
  private key(x: number, z: number): number {
    return cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell));
  }
  add(i: number, p: Pt): void {
    const k = this.key(p.x, p.z);
    let list = this.cells.get(k);
    if (!list) { list = []; this.cells.set(k, list); }
    list.push(i);
  }
  /** Visit node indices in the 3x3 cells around p. */
  near(p: Pt, visit: (i: number) => void): void {
    const cx = Math.floor(p.x / this.cell);
    const cz = Math.floor(p.z / this.cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cells.get(cellKey(cx + dx, cz + dz));
        if (list) for (const i of list) visit(i);
      }
    }
  }
}

/** Growth tuning that is not worth a config knob but deserves a name. */
const GROWTH = {
  ATTRACTOR_JITTER: 0.9,        // fraction of the grid spacing an attractor may wander
  MASK_SCALE: 0.011,            // noise frequency for empty bays
  MASK_THRESHOLD_HUB: -0.3,     // noise must exceed this near the hub…
  MASK_THRESHOLD_RIM: 0.25,     // …and this at the rim (denser centre, patchy edge)
  HUB_SPOKES: [5, 7],           // initial spokes out of the hub
  SPOKE_JITTER: 0.4,
  HEADING_JITTER: 0.5,          // radians of wobble per growth step
  STALL_EPSILON: 0.05,          // pull vectors shorter than this count as cancelled out
  TOWN_BAND: [0.28, 0.85],      // towns sit between these fractions of the radius
  TOWN_MIN_DEPTH: 5,
  TOWN_STEP: 0.7,               // town webs grow with shorter, denser steps
  TOWN_INFLUENCE: 0.5,
  TOWN_KILL: 0.6,
  TOWN_ITER: 80,
  TOWN_ATTRACTOR_JITTER: 0.8,
  TOWN_CLEARING: 5,             // no attractors right on top of the town centre
  TOWN_ROAD_WIDTH: 1.3,
  LEVEL_NOISE_SCALE: 0.006,
  LEVEL_RANGE: 3,               // terraces of variation from noise
  WIDTH_PER_LOG_SIZE: 2.4,      // land half-width grows with log2(subtree size)
  ROAD_WIDTH_BASE: 0.9,
  ROAD_WIDTH_PER_LOG_SIZE: 0.13,
  ROAD_WIDTH_MAX: 1.7,
  LOOP_MIN_STEP_FRACTION: 0.8,  // loops must be longer than most of a growth step
} as const;

interface Growth {
  nodes: RoadNode[];
  grid: NodeGrid;
  rng: Rng;
  R: number;
}

export function generateRoadGraph(seed: number, cfg: RoadConfig = GRAPH): RoadGraph {
  const rng = mulberry32(derive(seed, SALT.ROAD_RNG));
  const noise = new Simplex2D(derive(seed, SALT.ROAD_MASK));
  const g: Growth = { nodes: [], grid: new NodeGrid(cfg.INFLUENCE), rng, R: cfg.RADIUS };

  const attractors = scatterAttractors(rng, noise, cfg);
  seedHub(g, cfg);
  grow(g, attractors, cfg.STEP, cfg.INFLUENCE, cfg.KILL, cfg.MAX_ITER);
  const towns = pickTowns(g, cfg);
  growTownWebs(g, towns, cfg);
  accumulateSubtreeSizes(g.nodes);

  const sectors = shuffle(rng, [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow]);
  const sectorOffset = rng() * Math.PI * 2;
  const graph: RoadGraph = { seed, radius: cfg.RADIUS, nodes: g.nodes, edges: [], sectors, sectorOffset, towns, islands: [], mainlandNodes: g.nodes.length };

  assignLevels(graph, seed, cfg);
  buildEdges(graph, cfg);
  addLoops(graph, rng, cfg);
  return graph;
}

/** Jittered grid on a disc, thinned by noise so the map has empty bays. */
function scatterAttractors(rng: Rng, noise: Simplex2D, cfg: RoadConfig): Pt[] {
  const R = cfg.RADIUS;
  const attractors: Pt[] = [];
  const sp = cfg.ATTRACTOR_SPACING;
  for (let gx = -R; gx <= R; gx += sp) {
    for (let gz = -R; gz <= R; gz += sp) {
      const x = gx + (rng() - 0.5) * sp * GROWTH.ATTRACTOR_JITTER;
      const z = gz + (rng() - 0.5) * sp * GROWTH.ATTRACTOR_JITTER;
      const r = Math.hypot(x, z);
      if (r > R || r < cfg.HUB_RADIUS * 0.6) continue;
      const n = noise.fbm(x * GROWTH.MASK_SCALE, z * GROWTH.MASK_SCALE, 3);
      const threshold = GROWTH.MASK_THRESHOLD_HUB + (r / R) * (GROWTH.MASK_THRESHOLD_RIM - GROWTH.MASK_THRESHOLD_HUB);
      if (n > threshold) attractors.push({ x, z });
    }
  }
  return attractors;
}

/** Hub node plus a ring of spokes, so the trunk does not start as a single line. */
function seedHub(g: Growth, cfg: RoadConfig): void {
  const addNode = (n: RoadNode) => { g.grid.add(g.nodes.length, n); g.nodes.push(n); };
  addNode({ x: 0, z: 0, parent: -1, depth: 0, level: 1, size: 1 });
  const [minSpokes, maxSpokes] = GROWTH.HUB_SPOKES;
  const spokes = minSpokes + Math.floor(g.rng() * (maxSpokes - minSpokes + 1));
  const spokeOffset = g.rng() * Math.PI * 2;
  for (let s = 0; s < spokes; s++) {
    const a = spokeOffset + (s / spokes) * Math.PI * 2 + (g.rng() - 0.5) * GROWTH.SPOKE_JITTER;
    addNode({ x: Math.cos(a) * cfg.STEP, z: Math.sin(a) * cfg.STEP, parent: 0, depth: 1, level: 1, size: 1 });
  }
}

/**
 * Space colonisation: every attractor pulls its nearest node within `influence`; each pulled node
 * grows one child of length `step` toward the summed pull; attractors within `kill` of a new node die.
 */
function grow(g: Growth, targets: Pt[], step: number, influence: number, kill: number, maxIter: number): void {
  const { nodes, grid, rng, R } = g;
  const infl2 = influence * influence;
  const kill2 = kill * kill;
  for (let iter = 0; iter < maxIter && targets.length > 0; iter++) {
    const pull = new Map<number, { dx: number; dz: number }>();
    for (const a of targets) {
      let best = -1, bestD = infl2;
      grid.near(a, (i) => {
        const n = nodes[i];
        const d = (n.x - a.x) ** 2 + (n.z - a.z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best < 0) continue;
      const n = nodes[best];
      const len = Math.sqrt(bestD) || 1;
      let p = pull.get(best);
      if (!p) { p = { dx: 0, dz: 0 }; pull.set(best, p); }
      p.dx += (a.x - n.x) / len;
      p.dz += (a.z - n.z) / len;
    }
    if (pull.size === 0) break;

    const born: number[] = [];
    for (const [i, p] of pull) {
      const child = sprout(nodes[i], i, p, step, rng);
      if (Math.hypot(child.x, child.z) > R) continue;
      born.push(nodes.length);
      grid.add(nodes.length, child);
      nodes.push(child);
    }
    if (born.length === 0) break;

    targets = targets.filter((a) => born.every((i) => (nodes[i].x - a.x) ** 2 + (nodes[i].z - a.z) ** 2 >= kill2));
  }
}

/** One new node `step` away from `parent` along the (jittered) pull direction. */
function sprout(parent: RoadNode, parentIdx: number, pull: { dx: number; dz: number }, step: number, rng: Rng): RoadNode {
  let { dx, dz } = pull;
  let len = Math.hypot(dx, dz);
  if (len < GROWTH.STALL_EPSILON) {
    // opposing pulls cancel: pick a random heading so growth never stalls
    const a = rng() * Math.PI * 2;
    dx = Math.cos(a); dz = Math.sin(a); len = 1;
  }
  // small heading jitter keeps roads from being ruler-straight
  const jitter = (rng() - 0.5) * GROWTH.HEADING_JITTER;
  const cos = Math.cos(jitter), sin = Math.sin(jitter);
  const jx = (dx * cos - dz * sin) / len;
  const jz = (dx * sin + dz * cos) / len;
  return { x: parent.x + jx * step, z: parent.z + jz * step, parent: parentIdx, depth: parent.depth + 1, level: 1, size: 1 };
}

/** Well-spread nodes deep in the tree that become town centres. */
function pickTowns(g: Growth, cfg: RoadConfig): number[] {
  const { nodes, rng, R } = g;
  const [lo, hi] = GROWTH.TOWN_BAND;
  const order = nodes.map((n, i) => ({ n, i })).filter(({ n }) => {
    const r = Math.hypot(n.x, n.z);
    return n.depth >= GROWTH.TOWN_MIN_DEPTH && r > R * lo && r < R * hi;
  });
  shuffle(rng, order);
  const towns: number[] = [];
  for (const { n, i } of order) {
    if (towns.length >= cfg.TOWNS) break;
    if (towns.some((t) => Math.hypot(nodes[t].x - n.x, nodes[t].z - n.z) < cfg.TOWN_SPACING)) continue;
    towns.push(i);
  }
  return towns;
}

/** Each town grows a dense local web from attractors scattered around it. */
function growTownWebs(g: Growth, towns: number[], cfg: RoadConfig): void {
  const { nodes, rng, R } = g;
  const sp = cfg.TOWN_ATTRACTOR_SPACING;
  for (const t of towns) {
    const c = nodes[t];
    const local: Pt[] = [];
    for (let gx = -cfg.TOWN_RADIUS; gx <= cfg.TOWN_RADIUS; gx += sp) {
      for (let gz = -cfg.TOWN_RADIUS; gz <= cfg.TOWN_RADIUS; gz += sp) {
        const x = c.x + gx + (rng() - 0.5) * sp * GROWTH.TOWN_ATTRACTOR_JITTER;
        const z = c.z + gz + (rng() - 0.5) * sp * GROWTH.TOWN_ATTRACTOR_JITTER;
        const r = Math.hypot(x - c.x, z - c.z);
        if (r > cfg.TOWN_RADIUS || r < GROWTH.TOWN_CLEARING || Math.hypot(x, z) > R) continue;
        local.push({ x, z });
      }
    }
    grow(g, local, cfg.STEP * GROWTH.TOWN_STEP, cfg.INFLUENCE * GROWTH.TOWN_INFLUENCE, cfg.KILL * GROWTH.TOWN_KILL, GROWTH.TOWN_ITER);
  }
}

/** Children always have larger indices than parents, so one reverse pass sums subtrees. */
function accumulateSubtreeSizes(nodes: RoadNode[]): void {
  for (let i = nodes.length - 1; i > 0; i--) nodes[nodes[i].parent].size += nodes[i].size;
}

/** Road levels: noise + biome base, clamped so adjacent nodes differ by at most one terrace. */
function assignLevels(graph: RoadGraph, seed: number, cfg: RoadConfig): void {
  const { nodes } = graph;
  const levelNoise = new Simplex2D(derive(seed, SALT.BIOME));
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const biome = biomeAt(graph, levelNoise, n.x, n.z);
    const base = BIOME_BASE[biome];
    const h = (levelNoise.fbm(n.x * GROWTH.LEVEL_NOISE_SCALE, n.z * GROWTH.LEVEL_NOISE_SCALE, 3) + 1) * 0.5; // [0,1]
    let level = 1 + base + Math.round(h * GROWTH.LEVEL_RANGE);
    if (Math.hypot(n.x, n.z) < cfg.HUB_RADIUS) level = 1;
    if (n.parent >= 0) {
      const pl = nodes[n.parent].level;
      level = Math.max(pl - 1, Math.min(pl + 1, level));
    }
    n.level = Math.max(1, level);
  }
}

function landWidthFor(size: number, cfg: RoadConfig): number {
  return Math.min(cfg.MAX_WIDTH, cfg.MIN_WIDTH + GROWTH.WIDTH_PER_LOG_SIZE * Math.log2(size + 1));
}

function roadWidthFor(size: number): number {
  return Math.min(GROWTH.ROAD_WIDTH_MAX, GROWTH.ROAD_WIDTH_BASE + GROWTH.ROAD_WIDTH_PER_LOG_SIZE * Math.log2(size + 1));
}

/** One edge per parent link; land near towns is widened so squares and houses fit. */
function buildEdges(graph: RoadGraph, cfg: RoadConfig): void {
  const { nodes, towns } = graph;
  const nearTown = (n: RoadNode): boolean =>
    towns.some((t) => Math.hypot(nodes[t].x - n.x, nodes[t].z - n.z) < cfg.TOWN_RADIUS + 6);
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    const wide = nearTown(n);
    graph.edges.push({
      a: n.parent, b: i,
      width: wide ? Math.max(landWidthFor(n.size, cfg), cfg.TOWN_LAND_WIDTH) : landWidthFor(n.size, cfg),
      roadWidth: wide ? Math.max(roadWidthFor(n.size), GROWTH.TOWN_ROAD_WIDTH) : roadWidthFor(n.size),
      loop: false,
    });
  }
}

/** Join nearby nodes from different branches so the map is not a pure tree. */
function addLoops(graph: RoadGraph, rng: Rng, cfg: RoadConfig): void {
  const { nodes } = graph;
  const loopGrid = new NodeGrid(cfg.LOOP_DIST);
  nodes.forEach((n, i) => loopGrid.add(i, n));
  const loop2 = cfg.LOOP_DIST * cfg.LOOP_DIST;
  const minLen2 = (cfg.STEP * GROWTH.LOOP_MIN_STEP_FRACTION) ** 2;
  const looped = new Set<number>();
  for (let i = 1; i < nodes.length; i++) {
    if (looped.has(i)) continue;
    const n = nodes[i];
    let best = -1, bestD = loop2;
    loopGrid.near(n, (j) => {
      if (j <= i || looped.has(j)) return;
      const m = nodes[j];
      if (m.parent === i || n.parent === j || m.parent === n.parent) return;
      const d = (m.x - n.x) ** 2 + (m.z - n.z) ** 2;
      if (d < bestD && d > minLen2) { bestD = d; best = j; }
    });
    if (best >= 0 && rng() < cfg.LOOP_CHANCE && Math.abs(nodes[best].level - n.level) <= 1) {
      const size = Math.min(n.size, nodes[best].size);
      graph.edges.push({ a: i, b: best, width: landWidthFor(size, cfg), roadWidth: roadWidthFor(size), loop: true });
      looped.add(i); looped.add(best);
    }
  }
}

const BIOME_BASE: Record<Biome, number> = {
  [Biome.Plains]: 0, [Biome.Forest]: 0, [Biome.Desert]: 0, [Biome.Swamp]: 0, [Biome.Mountain]: 3, [Biome.Snow]: 2,
};

export interface SectorMix {
  biome: Biome;
  /** Neighbouring biome bleeding in, and its weight in [0, 0.5]. */
  other: Biome;
  t: number;
}

const TAU = Math.PI * 2;
/** Island biome extends this far past the island's nominal radius (covers its coast). */
const ISLAND_BIOME_MARGIN = 40;
/** Width of the dithered transition between biomes, in tiles. */
export const BLEND_TILES = 10;

/**
 * Sector lookup with blend weights: plains inside the hub clearing, otherwise a noise-warped
 * angular wedge. Near a wedge edge (or the clearing edge) `other`/`t` describe the neighbour
 * bleeding in, so callers can dither tiles or lerp colours instead of drawing a hard line.
 */
export function sectorMix(graph: RoadGraph, noise: Simplex2D, x: number, z: number): SectorMix {
  // islands are one biome each, surrounded by sea, so no blending is needed
  for (const isl of graph.islands) {
    if (Math.hypot(x - isl.x, z - isl.z) < isl.radius + ISLAND_BIOME_MARGIN) return { biome: isl.biome, other: isl.biome, t: 0 };
  }
  const r = Math.hypot(x, z);
  const K = graph.sectors.length;
  const warp = noise.fbm(x * 0.008, z * 0.008, 2) * 0.55;
  const damp = Math.min(1, Math.max(0, (r - GRAPH.HUB_RADIUS) / 60));
  let a = Math.atan2(z, x) + warp * damp - graph.sectorOffset;
  a = ((a % TAU) + TAU) % TAU;
  const f = (a / TAU) * K;
  const idx = Math.floor(f) % K;
  const frac = f - Math.floor(f);
  const sector = graph.sectors[idx];

  // angular band: BLEND_TILES wide regardless of radius
  const arc = Math.max(1, r) * (TAU / K);
  const w = Math.min(0.45, BLEND_TILES / arc);
  let other = sector, t = 0;
  if (frac < w) { other = graph.sectors[(idx + K - 1) % K]; t = 0.5 * (1 - frac / w); }
  else if (frac > 1 - w) { other = graph.sectors[(idx + 1) % K]; t = 0.5 * (1 - (1 - frac) / w); }

  // hub clearing ring
  const R0 = GRAPH.HUB_RADIUS * 1.15;
  if (r < R0) {
    const tr = 0.5 * (1 - Math.min(1, (R0 - r) / BLEND_TILES));
    return { biome: Biome.Plains, other: sector, t: tr };
  }
  const tr = 0.5 * (1 - Math.min(1, (r - R0) / BLEND_TILES));
  if (tr > t) { other = Biome.Plains; t = tr; }
  return { biome: sector, other, t };
}

/** Biome for a world position, dithered per tile across blend bands. */
export function biomeAt(graph: RoadGraph, noise: Simplex2D, x: number, z: number): Biome {
  const m = sectorMix(graph, noise, x, z);
  if (m.t <= 0) return m.biome;
  return rand2(graph.seed, Math.floor(x), Math.floor(z), TILE_SALT.BIOME_DITHER) < m.t ? m.other : m.biome;
}

/** Squared distance from p to segment ab, plus the parameter t of the closest point. */
export function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const vv = vx * vx + vz * vz;
  let t = vv > 0 ? (wx * vx + wz * vz) / vv : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + vx * t - px;
  const dz = az + vz * t - pz;
  return [dx * dx + dz * dz, t];
}

/** Island sizing and placement. Distances in tiles. */
export const ISLANDS = {
  COUNT: 4,
  RADIUS_MIN: 70,
  RADIUS_RANGE: 40,
  GAP: 60,              // open sea between the mainland's reach and the island's edge
  SPACING: 40,          // sea between islands
  SECTOR_HALF_ANGLE: 0.35,
  HUB_FLAT_RADIUS: 25,  // island nodes this close to the harbour town stay at level 1 so piers connect
  BIOMES: [Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow, Biome.Plains],
} as const;

/** Road tuning for an island of the given radius: smaller, denser, no secondary towns. */
export function islandConfig(radius: number): RoadConfig {
  return {
    ...GRAPH,
    RADIUS: radius, TOWNS: 0, HUB_RADIUS: 14, ATTRACTOR_SPACING: 14, INFLUENCE: 40, KILL: 11, STEP: 6,
    LOOP_DIST: 16, MAX_ITER: 300, MAX_WIDTH: 18,
  };
}

/** Radius and biome an island gets from its own seed. */
export function islandTraits(seed: number): { radius: number; biome: Biome } {
  const rng = mulberry32(seed);
  const radius = ISLANDS.RADIUS_MIN + Math.floor(rng() * ISLANDS.RADIUS_RANGE);
  const biome = ISLANDS.BIOMES[Math.floor(rng() * ISLANDS.BIOMES.length)];
  return { radius, biome };
}

/**
 * Default island anchors for a mainland: spread around the compass, each just past the mainland's
 * reach in that direction. Only used when the manifest has no island anchors yet.
 */
export function planIslands(mainland: RoadGraph, rootSeed: number): Array<{ id: string; x: number; z: number; seed: number }> {
  const rng = mulberry32(hash3(rootSeed, 0, 0, SALT.ISLAND));
  const out: Array<{ id: string; x: number; z: number; seed: number; radius: number }> = [];
  const baseAngle = rng() * TAU;
  for (let i = 0; i < ISLANDS.COUNT; i++) {
    const id = `island:${i}`;
    const seed = hash3(rootSeed, hashStringLite(id), 0, SALT.ISLAND);
    const { radius } = islandTraits(seed);
    const angle = baseAngle + (i / ISLANDS.COUNT) * TAU + (rng() - 0.5) * 0.5;
    // how far the mainland reaches in this direction
    let reach = mainland.radius * 0.5;
    for (let n = 0; n < mainland.mainlandNodes; n++) {
      const node = mainland.nodes[n];
      const a = Math.atan2(node.z, node.x);
      const da = Math.atan2(Math.sin(a - angle), Math.cos(a - angle));
      if (Math.abs(da) < ISLANDS.SECTOR_HALF_ANGLE) reach = Math.max(reach, Math.hypot(node.x, node.z));
    }
    let dist = reach + ISLANDS.GAP + radius;
    const x0 = Math.cos(angle), z0 = Math.sin(angle);
    // push outward until clear of islands already placed
    for (let tries = 0; tries < 20; tries++) {
      const x = x0 * dist, z = z0 * dist;
      if (out.every((o) => Math.hypot(o.x - x, o.z - z) > o.radius + radius + ISLANDS.SPACING)) break;
      dist += 20;
    }
    out.push({ id, x: Math.round(x0 * dist), z: Math.round(z0 * dist), seed, radius });
  }
  return out.map(({ id, x, z, seed }) => ({ id, x, z, seed }));
}

/** Same string hash the manifest uses for ids, kept local to avoid a circular import. */
function hashStringLite(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Grow each island's own road tree from its anchor seed and append it to the mainland graph:
 * nodes translated to the anchor, indices re-based, the island hub registered as a town.
 */
export function attachIslands(graph: RoadGraph, anchors: Anchor[]): void {
  for (const a of anchors) {
    const { radius, biome } = islandTraits(a.seed);
    const sub = generateRoadGraph(a.seed, islandConfig(radius));
    const base = graph.nodes.length;
    for (const n of sub.nodes) {
      graph.nodes.push({ x: n.x + a.x, z: n.z + a.z, parent: n.parent < 0 ? -1 : n.parent + base, depth: n.depth, level: n.level, size: n.size });
    }
    for (const e of sub.edges) graph.edges.push({ ...e, a: e.a + base, b: e.b + base });
    graph.towns.push(base);
    graph.islands.push({ id: a.id, seed: a.seed, x: a.x, z: a.z, radius, biome, hub: base, firstNode: base });
    relevelIsland(graph, base, a.x, a.z, biome, a.seed);
  }
}

/** Island levels follow the island's own biome; the harbour area stays low so a pier can meet the shore. */
function relevelIsland(graph: RoadGraph, firstNode: number, cx: number, cz: number, biome: Biome, seed: number): void {
  const { nodes } = graph;
  const noise = new Simplex2D(derive(seed, SALT.BIOME));
  const baseLevel = BIOME_BASE[biome];
  for (let i = firstNode; i < nodes.length; i++) {
    const n = nodes[i];
    const h = (noise.fbm(n.x * GROWTH.LEVEL_NOISE_SCALE, n.z * GROWTH.LEVEL_NOISE_SCALE, 3) + 1) * 0.5;
    let level = 1 + baseLevel + Math.round(h * GROWTH.LEVEL_RANGE);
    if (Math.hypot(n.x - cx, n.z - cz) < ISLANDS.HUB_FLAT_RADIUS) level = 1;
    if (n.parent >= 0) {
      const pl = nodes[n.parent].level;
      level = Math.max(pl - 1, Math.min(pl + 1, level));
    }
    n.level = Math.max(1, level);
  }
}
