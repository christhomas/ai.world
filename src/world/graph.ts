import { GRAPH } from '../core/config';
import { mulberry32, shuffle } from '../core/rng';
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

export interface RoadGraph {
  seed: number;
  radius: number;
  nodes: RoadNode[];
  edges: RoadEdge[];
  /** Node indices of town centres: each grew its own local road web, like a small hub. */
  towns: number[];
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
    return (Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(z / this.cell) + 32768);
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
        const list = this.cells.get((cx + dx + 32768) * 65536 + (cz + dz + 32768));
        if (list) for (const i of list) visit(i);
      }
    }
  }
}

export function generateRoadGraph(seed: number, cfg = GRAPH): RoadGraph {
  const rng = mulberry32((seed ^ 0xa5a5a5a5) >>> 0);
  const noise = new Simplex2D((seed ^ 0x51ed) >>> 0);
  const R = cfg.RADIUS;

  // --- attractors: jittered grid on a disc, thinned by noise so the map has empty bays ---
  let attractors: Pt[] = [];
  const sp = cfg.ATTRACTOR_SPACING;
  for (let gx = -R; gx <= R; gx += sp) {
    for (let gz = -R; gz <= R; gz += sp) {
      const x = gx + (rng() - 0.5) * sp * 0.9;
      const z = gz + (rng() - 0.5) * sp * 0.9;
      const r = Math.hypot(x, z);
      if (r > R || r < cfg.HUB_RADIUS * 0.6) continue;
      const n = noise.fbm(x * 0.011, z * 0.011, 3);
      // denser near the hub, thinner and patchier toward the rim
      const threshold = -0.3 + (r / R) * 0.55;
      if (n > threshold) attractors.push({ x, z });
    }
  }

  // --- grow ---
  const nodes: RoadNode[] = [{ x: 0, z: 0, parent: -1, depth: 0, level: 1, size: 1 }];
  const grid = new NodeGrid(cfg.INFLUENCE);
  grid.add(0, nodes[0]);
  // Seed the hub with a ring of spokes so the trunk does not start as a single line.
  const spokes = 5 + Math.floor(rng() * 3);
  const spokeOffset = rng() * Math.PI * 2;
  for (let s = 0; s < spokes; s++) {
    const a = spokeOffset + (s / spokes) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    const n: RoadNode = { x: Math.cos(a) * cfg.STEP, z: Math.sin(a) * cfg.STEP, parent: 0, depth: 1, level: 1, size: 1 };
    grid.add(nodes.length, n);
    nodes.push(n);
  }

  const grow = (targets: Pt[], step: number, influence: number, kill: number, maxIter: number): void => {
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
        const parent = nodes[i];
        let dx = p.dx, dz = p.dz;
        let len = Math.hypot(dx, dz);
        if (len < 0.05) {
          // opposing pulls cancel: pick a random heading so growth never stalls
          const a = rng() * Math.PI * 2;
          dx = Math.cos(a); dz = Math.sin(a); len = 1;
        }
        // small heading jitter keeps roads from being ruler-straight
        const jitter = (rng() - 0.5) * 0.5;
        const cos = Math.cos(jitter), sin = Math.sin(jitter);
        const jx = (dx * cos - dz * sin) / len;
        const jz = (dx * sin + dz * cos) / len;
        const n: RoadNode = {
          x: parent.x + jx * step,
          z: parent.z + jz * step,
          parent: i,
          depth: parent.depth + 1,
          level: 1,
          size: 1,
        };
        if (Math.hypot(n.x, n.z) > R) continue;
        born.push(nodes.length);
        grid.add(nodes.length, n);
        nodes.push(n);
      }
      if (born.length === 0) break;

      targets = targets.filter((a) => {
        for (const i of born) {
          const n = nodes[i];
          if ((n.x - a.x) ** 2 + (n.z - a.z) ** 2 < kill2) return false;
        }
        return true;
      });
    }
  };
  grow(attractors, cfg.STEP, cfg.INFLUENCE, cfg.KILL, cfg.MAX_ITER);

  // --- towns: pick well-spread nodes deep in the tree and grow a dense local web around each ---
  const towns: number[] = [];
  {
    const order = nodes.map((n, i) => ({ n, i })).filter(({ n }) => {
      const r = Math.hypot(n.x, n.z);
      return n.depth >= 5 && r > R * 0.28 && r < R * 0.85;
    });
    shuffle(rng, order);
    for (const { n, i } of order) {
      if (towns.length >= cfg.TOWNS) break;
      if (towns.some((t) => Math.hypot(nodes[t].x - n.x, nodes[t].z - n.z) < cfg.TOWN_SPACING)) continue;
      towns.push(i);
    }
    for (const t of towns) {
      const c = nodes[t];
      const local: Pt[] = [];
      const sp = cfg.TOWN_ATTRACTOR_SPACING;
      for (let gx = -cfg.TOWN_RADIUS; gx <= cfg.TOWN_RADIUS; gx += sp) {
        for (let gz = -cfg.TOWN_RADIUS; gz <= cfg.TOWN_RADIUS; gz += sp) {
          const x = c.x + gx + (rng() - 0.5) * sp * 0.8;
          const z = c.z + gz + (rng() - 0.5) * sp * 0.8;
          const r = Math.hypot(x - c.x, z - c.z);
          if (r > cfg.TOWN_RADIUS || r < 5 || Math.hypot(x, z) > R) continue;
          local.push({ x, z });
        }
      }
      grow(local, cfg.STEP * 0.7, cfg.INFLUENCE * 0.5, cfg.KILL * 0.6, 80);
    }
  }

  // --- subtree sizes (children always have larger indices than parents) ---
  for (let i = nodes.length - 1; i > 0; i--) nodes[nodes[i].parent].size += nodes[i].size;

  // --- biome sectors: six warped wedges around the hub, order shuffled by seed ---
  const sectors = shuffle(rng, [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow]);
  const sectorOffset = rng() * Math.PI * 2;
  const graph: RoadGraph = { seed, radius: R, nodes, edges: [], sectors, sectorOffset, towns };

  // --- road levels: noise + biome base, then clamp so adjacent nodes differ by at most one terrace ---
  const levelNoise = new Simplex2D((seed ^ 0x7e7e) >>> 0);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const biome = biomeAt(graph, levelNoise, n.x, n.z);
    const base = BIOME_BASE[biome];
    const h = (levelNoise.fbm(n.x * 0.006, n.z * 0.006, 3) + 1) * 0.5; // [0,1]
    let level = 1 + base + Math.round(h * 3);
    if (Math.hypot(n.x, n.z) < cfg.HUB_RADIUS) level = 1;
    if (n.parent >= 0) {
      const pl = nodes[n.parent].level;
      level = Math.max(pl - 1, Math.min(pl + 1, level));
    }
    n.level = Math.max(1, level);
  }

  // --- edges ---
  const widthFor = (size: number) =>
    Math.min(cfg.MAX_WIDTH, cfg.MIN_WIDTH + 2.4 * Math.log2(size + 1));
  const roadWidthFor = (size: number) => Math.min(1.7, 0.9 + 0.13 * Math.log2(size + 1));
  const nearTown = (n: RoadNode): boolean =>
    towns.some((t) => Math.hypot(nodes[t].x - n.x, nodes[t].z - n.z) < cfg.TOWN_RADIUS + 6);
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    const wide = nearTown(n);
    graph.edges.push({
      a: n.parent, b: i,
      width: wide ? Math.max(widthFor(n.size), cfg.TOWN_LAND_WIDTH) : widthFor(n.size),
      roadWidth: wide ? Math.max(roadWidthFor(n.size), 1.3) : roadWidthFor(n.size),
      loop: false,
    });
  }

  // --- loops: join nearby nodes from different branches ---
  const loopGrid = new NodeGrid(cfg.LOOP_DIST);
  nodes.forEach((n, i) => loopGrid.add(i, n));
  const loop2 = cfg.LOOP_DIST * cfg.LOOP_DIST;
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
      if (d < bestD && d > (cfg.STEP * 0.8) ** 2) { bestD = d; best = j; }
    });
    if (best >= 0 && rng() < cfg.LOOP_CHANCE && Math.abs(nodes[best].level - n.level) <= 1) {
      const size = Math.min(n.size, nodes[best].size);
      graph.edges.push({ a: i, b: best, width: widthFor(size), roadWidth: roadWidthFor(size), loop: true });
      looped.add(i); looped.add(best);
    }
  }

  return graph;
}

const BIOME_BASE: Record<Biome, number> = {
  [Biome.Plains]: 0, [Biome.Forest]: 0, [Biome.Desert]: 0, [Biome.Swamp]: 0, [Biome.Mountain]: 3, [Biome.Snow]: 2,
};

/** Biome for a world position: plains inside the hub clearing, otherwise a noise-warped angular sector. */
export function biomeAt(graph: RoadGraph, noise: Simplex2D, x: number, z: number): Biome {
  const r = Math.hypot(x, z);
  if (r < GRAPH.HUB_RADIUS * 1.15) return Biome.Plains;
  // warp the angle so sector borders wander instead of being straight spokes
  const warp = noise.fbm(x * 0.008, z * 0.008, 2) * 0.55;
  // near the clearing the warp is damped so the hub stays cleanly plains
  const damp = Math.min(1, (r - GRAPH.HUB_RADIUS) / 60);
  let a = Math.atan2(z, x) + warp * damp - graph.sectorOffset;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const idx = Math.floor((a / (Math.PI * 2)) * graph.sectors.length) % graph.sectors.length;
  return graph.sectors[idx];
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
