import { GRAPH, HYDRO } from '../core/config';
import { mulberry32, shuffle } from '../core/rng';
import { Simplex2D } from './noise';
import type { RoadGraph } from './graph';

/**
 * Hydrology: rivers and lakes. Rivers start beside highland roads and wander outward toward
 * the sea. Their level only ever goes down along the flow, so every terrace they cross becomes
 * a waterfall. A river that runs into another river, or runs out of steps, ends in a lake.
 */

export interface RiverNode { x: number; z: number; level: number; width: number }
export interface Lake { x: number; z: number; r: number; level: number }
export interface Hydrology { rivers: RiverNode[][]; lakes: Lake[] }

/** What the terrain sampler knows about a point, enough to route water. */
export interface LandProbe {
  land: boolean;
  roadDist: number;
  roadWidth: number;
  landWidth: number;
  baseLevel: number;
  /** Closest point on the road centreline. */
  cx: number;
  cz: number;
  /** Unit direction of that road segment, parent → child (away from the hub for tree edges). */
  ux: number;
  uz: number;
}

export function generateHydrology(graph: RoadGraph, probe: (x: number, z: number) => LandProbe | null, cfg = HYDRO): Hydrology {
  const rng = mulberry32((graph.seed ^ 0x8ebe) >>> 0);
  const noise = new Simplex2D((graph.seed ^ 0x2222) >>> 0);
  const rivers: RiverNode[][] = [];
  const lakes: Lake[] = [];

  const nearWater = (x: number, z: number, dist: number, skipRiver = -1): boolean => {
    const d2 = dist * dist;
    for (let r = 0; r < rivers.length; r++) {
      if (r === skipRiver) continue;
      for (const n of rivers[r]) if ((n.x - x) ** 2 + (n.z - z) ** 2 < d2) return true;
    }
    for (const l of lakes) if ((l.x - x) ** 2 + (l.z - z) ** 2 < (dist + l.r) ** 2) return true;
    return false;
  };

  // --- sources: prefer high, deep-in-the-tree nodes; keep them apart ---
  const candidates = graph.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.parent >= 0 && n.depth >= 4 && Math.hypot(n.x, n.z) > GRAPH.HUB_RADIUS * 1.6);
  shuffle(rng, candidates);
  candidates.sort((a, b) => b.n.level - a.n.level); // stable: high nodes first, shuffled within a level
  const sources: number[] = [];
  for (const { i } of candidates) {
    if (sources.length >= cfg.RIVERS) break;
    const n = graph.nodes[i];
    if (sources.some((s) => Math.hypot(graph.nodes[s].x - n.x, graph.nodes[s].z - n.z) < cfg.SOURCE_SPACING)) continue;
    sources.push(i);
  }

  for (const si of sources) {
    const n = graph.nodes[si];
    const pr0 = probe(n.x, n.z);
    if (!pr0) continue;
    // start beside the road, on a random side, and follow the corridor downstream
    let side = rng() < 0.5 ? -1 : 1;
    const nx0 = -pr0.uz, nz0 = pr0.ux;
    const off = pr0.landWidth * 0.45 + 1;
    let x = n.x + nx0 * off * side, z = n.z + nz0 * off * side;
    const pr = probe(x, z);
    if (!pr || !pr.land || pr.roadDist < pr.roadWidth + 2) continue;
    if (nearWater(x, z, cfg.SOURCE_SPACING * 0.5)) continue;

    let hx = pr0.ux, hz = pr0.uz; // heading
    let level = pr.baseLevel;
    let width: number = cfg.RIVER_MIN_WIDTH;
    const nodes: RiverNode[] = [{ x, z, level, width }];
    let endedAtSea = false;

    for (let step = 0; step < cfg.RIVER_MAX_STEPS; step++) {
      const q0 = probe(x, z);
      if (!q0) break;
      // road direction, oriented to keep going the way we are already going
      let ux = q0.ux, uz = q0.uz;
      if (ux * hx + uz * hz < 0) { ux = -ux; uz = -uz; }
      const nx = -uz, nz = ux;
      // stay at a lateral offset inside the corridor; flipping sides makes the river cross the road
      if (rng() < cfg.CROSS_CHANCE) side = -side;
      const lateral = (x - q0.cx) * nx + (z - q0.cz) * nz;
      const target = side * Math.max(q0.roadWidth + 2.5, q0.landWidth * 0.5);
      const pull = Math.max(-0.9, Math.min(0.9, (target - lateral) * 0.12));
      const meander = noise.noise(x * 0.04, z * 0.04) * 0.5 + (rng() - 0.5) * 0.3;
      let dx = ux + nx * pull, dz = uz + nz * pull;
      const cos = Math.cos(meander), sin = Math.sin(meander);
      const rx = dx * cos - dz * sin, rz = dx * sin + dz * cos;
      const len = Math.hypot(rx, rz) || 1;
      hx = rx / len; hz = rz / len;
      x += hx * cfg.RIVER_STEP;
      z += hz * cfg.RIVER_STEP;

      const q = probe(x, z);
      if (!q || !q.land) {
        // mouth: one node past the coast at sea level so the estuary meets the sea plane
        nodes.push({ x, z, level: 1, width: Math.min(cfg.RIVER_MAX_WIDTH, width + 0.4) });
        endedAtSea = true;
        break;
      }
      if (nearWater(x, z, cfg.MERGE_DIST, rivers.length)) break;
      level = Math.min(level, q.baseLevel);
      width = Math.min(cfg.RIVER_MAX_WIDTH, width + 0.05);
      nodes.push({ x, z, level, width });
    }
    if (nodes.length < cfg.RIVER_MIN_NODES) continue;
    if (!endedAtSea) {
      const last = nodes[nodes.length - 1];
      lakes.push({ x: last.x, z: last.z, r: 3 + rng() * 2.5, level: last.level });
    }
    rivers.push(nodes);
  }

  // --- standalone lakes in hollows away from the road ---
  const pool = graph.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.depth >= 3 && n.parent >= 0);
  shuffle(rng, pool);
  let placed = 0;
  for (const { n } of pool) {
    if (placed >= cfg.LAKES) break;
    const side = rng() < 0.5 ? -1 : 1;
    const pr0 = probe(n.x, n.z);
    if (!pr0) continue;
    const off = pr0.landWidth * 0.55;
    const x = n.x - pr0.uz * off * side, z = n.z + pr0.ux * off * side;
    const pr = probe(x, z);
    const r = 2.5 + rng() * 3;
    if (!pr || !pr.land || pr.roadDist < pr.roadWidth + r + 1.5 || pr.roadDist > pr.landWidth - r - 1.5) continue;
    if (nearWater(x, z, r + 8)) continue;
    lakes.push({ x, z, r, level: pr.baseLevel });
    placed++;
  }

  return { rivers, lakes };
}
