import { GRAPH, HYDRO } from '../core/config';
import { mulberry32, shuffle } from '../core/rng';
import { SALT, derive } from '../core/salts';
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

export function generateHydrology(
  graph: RoadGraph,
  probe: (x: number, z: number) => LandProbe | null,
  /**
   * How many terraces the mountains add at a point, which is nought over most of the world.
   *
   * A river takes its height from the road it follows, and roads are never lifted by a mountain —
   * they are the passes through it. So without this no river anywhere ran downhill off high
   * ground, and the tallest waterfall in the world was one that happened by accident at a river
   * mouth. With it, a river that rises on a massif falls the whole height of it.
   */
  uplift: (x: number, z: number, roadDist: number) => number = () => 0,
  /**
   * How high the mountains stand *near* a point, in terraces, for choosing where rivers rise.
   *
   * Separate from `uplift`, which answers about the point itself and is nought a step outside a
   * mountain's own footprint. That is the right answer for the height of the ground and the wrong
   * one for where a river should start: a spring rises at the foot of a range, not on its summit,
   * and a crossroads beside a mountain is exactly the place water comes out of the hill. Without
   * this, a polygon world's mountains had no bearing on its rivers at all — the ranges are not in
   * the heightfield any more, so nothing about them reached this.
   */
  highNearby: (x: number, z: number) => number = () => 0,
  cfg = HYDRO,
): Hydrology {
  const rng = mulberry32(derive(graph.seed, SALT.RIVER_RNG));
  const noise = new Simplex2D(derive(graph.seed, SALT.RIVER_MEANDER));
  const rivers: RiverNode[][] = [];
  const lakes: Lake[] = [];

  /** How high the ground is at a probed point: the road's terrace plus whatever stands on it. */
  const groundLevel = (p: LandProbe, x: number, z: number): number =>
    p.baseLevel + uplift(x, z, p.roadDist);

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
  // high nodes first, shuffled within a height. "High" now counts the mountains standing on the
  // road's own terrace, so a range with a road through it is where the rivers start.
  const startHeight = (i: number): number => {
    const n = graph.nodes[i];
    const p = probe(n.x, n.z);
    // the mountains standing on this road's terrace, and the ones standing beside it: both mean
    // water, and the second is what a spring at the foot of a range is
    return n.level + (p ? uplift(n.x, n.z, p.roadDist) : 0) + highNearby(n.x, n.z) * cfg.FOOT_OF_THE_HILLS;
  };
  candidates.sort((a, b) => startHeight(b.i) - startHeight(a.i));
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
    let level = groundLevel(pr, x, z);
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
      level = Math.min(level, groundLevel(q, x, z));
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
