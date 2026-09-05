import { GRAPH } from '../core/config';
import { mulberry32, shuffle } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Biome } from './biomes';
import type { RoadEdge, RoadGraph, RoadNode } from './graph';
import { FaceKind, faceAt, generateMesh, type WorldMesh } from './mesh';

/**
 * The roads, laid over the polygon mesh.
 *
 * The old network was a tree grown outward from the middle, and land was whatever lay near it.
 * Here it is the other way round: the mesh has already decided what is sea and what is country,
 * and the roads are drawn on the country that exists. A crossroads is a corner of the mesh — three
 * faces meet at every one of them, so a junction is a junction by construction — and a road is an
 * edge between two corners with dry ground on at least one side of it.
 *
 * That gives a web rather than a tree: you can go round, not only out and back. What is kept of
 * the old shape is only what the rest of the game reads — a parent and a depth for every node,
 * which is a spanning tree over the web, and a handful of towns.
 */

/** How the web is chosen out of all the edges the mesh offers. */
export const WEB = {
  /**
   * Share of the edges that are not needed for connectivity that get built anyway.
   *
   * The spanning tree is the skeleton and would be a tree again if nothing else were added; these
   * are what make it a web. High enough that most junctions have three ways out of them.
   */
  LOOPS: 0.55,
  /** Half-width of the road surface itself, in tiles. */
  ROAD_WIDTH: 2.2,
  /** How many towns a world gets, and how far apart they have to stand, in tiles. */
  TOWNS: 9,
  TOWN_SPACING: 120,
} as const;

const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

/**
 * Build the road web for a world.
 *
 * Returns the same shape the rest of the game already reads, so nothing downstream has to know
 * the world is made differently. `mesh` comes back on it as well, because what is now the
 * authority on land and sea is the mesh rather than anything in here.
 */
export function generateWebGraph(seed: number, radius = GRAPH.RADIUS): RoadGraph & { mesh: WorldMesh } {
  const mesh = generateMesh(seed, radius);
  const rng = mulberry32(derive(seed, SALT.ROAD_RNG));

  // a corner is a crossroads if any of the faces meeting there is dry
  const dry = (kind: FaceKind): boolean => kind === FaceKind.Land || kind === FaceKind.Mountain;
  const onLand = new Set<number>();
  const candidates = new Map<string, { a: number; b: number }>();
  for (const face of mesh.faces) {
    if (!dry(face.kind)) continue;
    for (let k = 0; k < face.corners.length; k++) {
      const a = face.corners[k], b = face.corners[(k + 1) % face.corners.length];
      onLand.add(a); onLand.add(b);
      candidates.set(edgeKey(a, b), { a, b });
    }
  }

  // nodes, in a fixed order so the same seed numbers them the same way
  const order = [...onLand].sort((a, b) => a - b);
  const indexOf = new Map<number, number>();
  const nodes: RoadNode[] = order.map((vertex, i) => {
    indexOf.set(vertex, i);
    const v = mesh.vertices[vertex];
    return { x: v.x, z: v.z, parent: -1, depth: 0, level: 1, size: 1 };
  });

  const links: Array<{ a: number; b: number }> = [];
  for (const { a, b } of candidates.values()) {
    const ia = indexOf.get(a), ib = indexOf.get(b);
    if (ia === undefined || ib === undefined) continue;
    links.push({ a: ia, b: ib });
  }
  links.sort((p, q) => (p.a - q.a) || (p.b - q.b));

  // the hub is the crossroads nearest the middle, because that is where the player starts
  let hub = 0, best = Infinity;
  nodes.forEach((n, i) => {
    const away = Math.hypot(n.x, n.z);
    if (away < best) { best = away; hub = i; }
  });

  // a spanning tree over whatever is reachable from the hub, which is what gives parent and depth
  const near = new Map<number, number[]>();
  for (const [i, link] of links.entries()) {
    if (!near.has(link.a)) near.set(link.a, []);
    if (!near.has(link.b)) near.set(link.b, []);
    near.get(link.a)!.push(i);
    near.get(link.b)!.push(i);
  }
  const inTree = new Set<number>();
  const reached = new Set<number>([hub]);
  const queue = [hub];
  while (queue.length > 0) {
    const here = queue.shift()!;
    for (const li of near.get(here) ?? []) {
      const link = links[li];
      const there = link.a === here ? link.b : link.a;
      if (reached.has(there)) continue;
      reached.add(there);
      inTree.add(li);
      nodes[there].parent = here;
      nodes[there].depth = nodes[here].depth + 1;
      queue.push(there);
    }
  }

  // and then the loops, which are what stop it being a tree again
  const edges: RoadEdge[] = [];
  for (const [li, link] of links.entries()) {
    if (!reached.has(link.a) || !reached.has(link.b)) continue;   // an island with no way in
    const kept = inTree.has(li) || rng() < WEB.LOOPS;
    if (!kept) continue;
    edges.push({
      a: link.a, b: link.b,
      width: mesh.radius,          // land is the mesh's business now, so this is no longer a limit
      roadWidth: WEB.ROAD_WIDTH,
      loop: !inTree.has(li),
    });
  }

  // subtree sizes, so trunks read as trunks: how many nodes hang off each one
  const kids = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    if (n.parent < 0) return;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent)!.push(i);
  });
  const byDepth = [...reached].sort((a, b) => nodes[b].depth - nodes[a].depth);
  for (const i of byDepth) {
    let size = 1;
    for (const k of kids.get(i) ?? []) size += nodes[k].size;
    nodes[i].size = size;
  }

  // towns on the deepest, best-spaced crossroads that stand on open land rather than in the peaks
  const towns: number[] = [];
  const spread = [...reached].sort((a, b) => nodes[b].size - nodes[a].size);
  for (const i of spread) {
    if (towns.length >= WEB.TOWNS) break;
    const face = faceAt(mesh, nodes[i].x, nodes[i].z);
    if (!face || face.kind !== FaceKind.Land) continue;
    if (towns.some((t) => Math.hypot(nodes[t].x - nodes[i].x, nodes[t].z - nodes[i].z) < WEB.TOWN_SPACING)) continue;
    towns.push(i);
  }

  const sectors = shuffle(rng, [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow]);
  return {
    seed, radius, nodes, edges, towns,
    islands: [], mainlandNodes: nodes.length,
    sectors, sectorOffset: rng() * Math.PI * 2,
    mesh,
  };
}
