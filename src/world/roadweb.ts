import { GRAPH } from '../core/config';
import { mulberry32, shuffle } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Simplex2D } from './noise';
import { Biome } from './biomes';
import type { IslandInfo, RoadEdge, RoadGraph, RoadNode } from './graph';
import { FaceKind, faceAt, generateMesh, isLand, type MeshFace, type WorldMesh } from './mesh';

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
  LOOPS: 0.28,
  /** Half-width of the road surface itself, in tiles. */
  ROAD_WIDTH: 2.2,
  /**
   * How many pieces each road between two crossroads is bent into, and how far it may wander from
   * the straight line, as a share of its length.
   *
   * A road drawn straight from corner to corner draws the mesh: you can see the hexagons through
   * it. Bending it hides the lattice and is what a road does anyway, since nobody ever laid one
   * along a ruler.
   */
  BENDS: 3,
  WANDER: 0.19,
  /**
   * Where along a border the ground is felt for before a road is offered there.
   *
   * Not the ends, which belong to the next border along as much as to this one, and not the middle
   * alone, which passes a road that runs out into a bay and comes back. Five points inside the
   * ends catches every border that spends any real length in the water, and the tenths at either
   * hand leave the junctions themselves alone.
   */
  FOOTING: [0.1, 0.3, 0.5, 0.7, 0.9],
  /**
   * How many of those have to be dry, which is a compromise and worth saying why.
   *
   * Demanding all five takes away a fifth of the network, and every road taken away leaves land
   * with nothing near it — which the sampler cannot draw at all, because a tile with no road
   * within about forty tiles has no terrace level to sit at and comes out as sea. Demanding none
   * of them leaves a fifth of the roads drawn across open water. A simple majority is the best of
   * both: roads over water fall from a fifth to a fifteenth, and the land orphaned by the change
   * goes from two per cent to under four.
   */
  FOOTHOLD: 3,
  /** How many towns a world gets, and how far apart they have to stand, in tiles. */
  TOWNS: 9,
  TOWN_SPACING: 120,
  /**
   * How the ground a road sits on rises inland, in terraces, and how coarsely it varies.
   *
   * Without this every crossroads sat at level one, the country was dead flat, and — much worse —
   * the rivers had no downhill to run to and spread over a third of the map with bridges over all
   * of it. A road climbs as it leaves the sea, and mountain country starts higher again.
   */
  LEVEL_RANGE: 3,
  LEVEL_SCALE: 0.006,
  MOUNTAIN_BASE: 3,
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

  // Every border of every dry face is a road that could be built, and every corner of one is a
  // crossroads. That is the plain reading of the mesh and it only works because the mesh is
  // irregular: back when the faces were hexagons this drew a honeycomb, with three roads leaving
  // every junction at a hundred and twenty degrees, and no amount of bending them hid it. Faces of
  // three to six sides at several different scales give junctions of three, four and five roads at
  // every angle, which is a road network rather than a lattice with roads painted on it.
  const dry = (kind: FaceKind): boolean => kind === FaceKind.Land || kind === FaceKind.Mountain;
  const onLand = new Set<number>();
  const candidates = new Map<string, { a: number; b: number }>();
  /**
   * Whether there is ground the whole way along a border, so a road built there could be walked.
   *
   * The mesh decides land face by face, but a lookup displaces the point it is given before it
   * asks, so the coastline is not the border it was drawn from: a border between dry country and
   * open water is half in the sea by the time the ground is built, and the sampler draws seabed
   * there and no road at all. That left a fifth of the network as lines on the map with nothing
   * under them — bands walked into the water and quests pointed across it. So a border is only
   * offered as a road if the ground is there, sampled along its length rather than at its ends,
   * because the ends are shared with the next border along and one wet corner would otherwise cut
   * a whole junction out of the web.
   */
  const walkable = (a: number, b: number): boolean => {
    const va = mesh.vertices[a], vb = mesh.vertices[b];
    let dry = 0;
    for (const t of WEB.FOOTING) {
      if (isLand(mesh, va.x + (vb.x - va.x) * t, va.z + (vb.z - va.z) * t)) dry++;
    }
    return dry >= WEB.FOOTHOLD;
  };
  for (const face of mesh.faces) {
    if (!dry(face.kind)) continue;
    for (let k = 0; k < face.corners.length; k++) {
      const a = face.corners[k], b = face.corners[(k + 1) % face.corners.length];
      if (!walkable(a, b)) continue;
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

  // and then the loops, which are what stop it being a tree again. Not every edge: a road on every
  // border of every face draws the mesh for the player in dashed lines.
  const edges: RoadEdge[] = [];
  const bend = (a: number, b: number, loop: boolean): void => {
    const from = nodes[a], to = nodes[b];
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    // the perpendicular the road is allowed to wander along, and one bulge along it per road
    const px = -dz / len, pz = dx / len;
    const swing = (rng() * 2 - 1) * WEB.WANDER * len;
    let prev = a;
    for (let k = 1; k < WEB.BENDS; k++) {
      const t = k / WEB.BENDS;
      // a single arc rather than a jagged line: nought at both ends, most of it in the middle
      const off = Math.sin(t * Math.PI) * swing;
      const mid = nodes.length;
      nodes.push({
        x: from.x + dx * t + px * off,
        z: from.z + dz * t + pz * off,
        parent: prev, depth: nodes[prev].depth + 1, level: 1, size: 1,
      });
      edges.push({ a: prev, b: mid, width: mesh.radius, roadWidth: WEB.ROAD_WIDTH, loop });
      prev = mid;
    }
    edges.push({ a: prev, b, width: mesh.radius, roadWidth: WEB.ROAD_WIDTH, loop });
  };

  for (const [li, link] of links.entries()) {
    if (!reached.has(link.a) || !reached.has(link.b)) continue;   // an island with no way in
    const inWeb = inTree.has(li);
    if (!inWeb && rng() >= WEB.LOOPS) continue;
    bend(link.a, link.b, !inWeb);
  }

  // the ground each crossroads stands on. Rivers run downhill and need somewhere to run from.
  const levelNoise = new Simplex2D(derive(seed, SALT.BIOME));
  for (const node of nodes) {
    const face = faceAt(mesh, node.x, node.z);
    const base = face?.kind === FaceKind.Mountain ? WEB.MOUNTAIN_BASE : 0;
    const h = (levelNoise.fbm(node.x * WEB.LEVEL_SCALE, node.z * WEB.LEVEL_SCALE, 3) + 1) * 0.5;
    node.level = Math.max(1, 1 + base + Math.round(h * WEB.LEVEL_RANGE));
  }
  // and then smoothed along the tree, so no road climbs more than a terrace between one
  // crossroads and the next and every one of them stays walkable
  const byDepthUp = [...reached].sort((a, b) => nodes[a].depth - nodes[b].depth);
  for (const i of byDepthUp) {
    const parent = nodes[i].parent;
    if (parent < 0) continue;
    const pl = nodes[parent].level;
    nodes[i].level = Math.max(1, Math.max(pl - 1, Math.min(pl + 1, nodes[i].level)));
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

  // Islands: dry ground with no dry ground next to it. The mesh throws these off by itself, so
  // they are found rather than placed — walk the faces, and any landmass that is not the one the
  // hub stands on is an island. `mainlandNodes` stays the whole list because the nodes are
  // numbered in corner order rather than mainland-then-islands, which nothing in this world reads.
  const dryFace = (f: MeshFace): boolean => dry(f.kind);
  const seenFace = new Set<number>();
  const islands: IslandInfo[] = [];
  const hubFace = faceAt(mesh, nodes[hub].x, nodes[hub].z);
  for (const face of mesh.faces) {
    if (seenFace.has(face.id) || !dryFace(face)) continue;
    const mass: MeshFace[] = [];
    const queue = [face];
    seenFace.add(face.id);
    while (queue.length > 0) {
      const here = queue.pop()!;
      mass.push(here);
      for (const n of here.neighbours) {
        if (n < 0 || seenFace.has(n) || !dryFace(mesh.faces[n])) continue;
        seenFace.add(n);
        queue.push(mesh.faces[n]);
      }
    }
    if (hubFace && mass.some((f) => f.id === hubFace.id)) continue;   // that one is the mainland

    const cx = mass.reduce((a, f) => a + f.cx, 0) / mass.length;
    const cz = mass.reduce((a, f) => a + f.cz, 0) / mass.length;
    const reach = Math.max(...mass.map((f) => Math.hypot(f.cx - cx, f.cz - cz))) + mesh.size;
    // the crossroads on it, if the roads reached: an island of one face may have none
    let onIt = -1, best = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - cx, n.z - cz);
      if (d < reach && d < best) { best = d; onIt = i; }
    });
    islands.push({
      id: `isle:${Math.round(cx)},${Math.round(cz)}`,
      seed: seed ^ Math.round(cx * 31 + cz * 17),
      x: cx, z: cz, radius: reach,
      biome: Biome.Plains,
      hub: onIt >= 0 ? onIt : hub,
      firstNode: onIt >= 0 ? onIt : hub,
    });
  }

  const sectors = shuffle(rng, [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow]);
  return {
    seed, radius, nodes, edges, towns,
    islands, mainlandNodes: nodes.length,
    sectors, sectorOffset: rng() * Math.PI * 2,
    mesh,
  };
}
