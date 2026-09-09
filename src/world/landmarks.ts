import type { Rng } from '../core/rng';
import { shuffle } from '../core/rng';
import type { Biome } from './biomes';
import type { RoadGraph } from './graph';
import { pairJetties } from './piers';
import { StructureKind, type Pier, type Signpost, type Site, type Structure, type Village } from './structures';
import { TileType, type TerrainSampler, type TileSample } from './terrain';

/**
 * What stands between the villages: jetties, signposts, caves and wrecks.
 *
 * Everything here is placed against the settlements rather than among them — a signpost is only
 * useful where there is nothing to see, a wreck belongs on an empty beach, and a cave is somewhere
 * you find rather than somewhere you are shown. So they are laid out last, when the villages are
 * known and the ground they left is what is available.
 *
 * Cut out of `structures.ts`, which had grown past what one screen holds. There is nothing subtle
 * about the boundary: these four read the finished village list and add to the same pile of
 * buildings, and none of the village machinery reads them back.
 */

export const CAVES = 10;
export const WRECKS = 8;
const SITE_SPACING = 60;
const CAVE_NAMES = ['Weeping Cave', 'Bat Hollow', 'Deep Crack', 'Smugglers\' Cave', 'Blackmouth Cave', 'Echo Cave', 'Cold Crawl', 'Miner\'s Fault', 'Rattling Cave', 'Hermit\'s Cave'];
const WRECK_NAMES = ['Wreck of the Marigold', 'Broken Keel', 'Wreck of the Tern', 'Salt Bones', 'Wreck of the Gull', 'Old Hull', 'Wreck of the Wren', 'Storm\'s Toll'];

const SIGNPOSTS = 22;
const SIGNPOST_SPACING = 90;

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
export function compassDir(dx: number, dz: number): string {
  return COMPASS[Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) & 7];
}

/** Everything the four of them need, which is the finished villages and the ground under them. */
export interface Between {
  sampler: TerrainSampler;
  graph: RoadGraph;
  sample: TileSample;
  rng: Rng;
  /** The pile of buildings, added to in place — a signpost has to know what it must not stand on. */
  all: Structure[];
  villages: Village[];
  /** The village builder's own test for whether a footprint fits, which a signpost needs as well. */
  footprintOk: (tx: number, tz: number, hw: number, hd: number, level: number | null) => number | null;
}

export function markTheWay(o: Between): { piers: Pier[]; signposts: Signpost[]; caves: Site[]; wrecks: Site[] } {
  const { sampler, graph, sample, rng, all, villages, footprintOk } = o;
  const piers: Pier[] = [];
  const signposts: Signpost[] = [];
  const caves: Site[] = [];
  const wrecks: Site[] = [];

  // --- piers: one on each shore per island, pointing at each other ---
  for (const isl of graph.islands) {
    let nearest = 0, nearestD = Infinity;
    for (let n = 0; n < graph.mainlandNodes; n++) {
      const d = Math.hypot(graph.nodes[n].x - isl.x, graph.nodes[n].z - isl.z);
      if (d < nearestD) { nearestD = d; nearest = n; }
    }
    const m = graph.nodes[nearest];
    // both shores surveyed, then paired: see `pairJetties`, which is where the reasoning lives
    const { islandPier, mainPier } = pairJetties(sampler, sample, isl, m);
    for (const pier of [islandPier, mainPier]) {
      if (!pier) continue;
      piers.push(pier);
      const [sx, sz] = pier.tiles[0];
      all.push({ kind: StructureKind.Pier, tx: sx, tz: sz, hw: 0, hd: 0, level: pier.level, rot: Math.atan2(-pier.dz, pier.dx), biome: 0 as Biome, path: pier.tiles });
      // schedule sign on the shore beside the first plank
      const signX = sx - pier.dx + (pier.dz !== 0 ? 1 : 0), signZ = sz - pier.dz + (pier.dx !== 0 ? 1 : 0);
      all.push({ kind: StructureKind.Sign, tx: signX, tz: signZ, hw: 0, hd: 0, level: pier.level, rot: Math.atan2(-pier.dz, pier.dx), biome: 0 as Biome, path: [] });
    }
  }

  // --- signposts: at junction nodes between settlements, naming the way ---
  const junctions = graph.nodes
    .map((n, i) => ({ n, i, degree: graph.edges.filter((e) => e.a === i || e.b === i).length }))
    .filter(({ n, degree }) => degree >= 3 && villages.every((v) => Math.hypot(v.x - n.x, v.z - n.z) > v.radius));
  shuffle(rng, junctions);
  for (const { n } of junctions) {
    if (signposts.length >= SIGNPOSTS) break;
    if (signposts.some((s) => Math.hypot(s.x - n.x, s.z - n.z) < SIGNPOST_SPACING)) continue;
    const probe = sampler.landProbe(n.x, n.z);
    if (!probe || !probe.land) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const off = probe.roadWidth + 1.4;
    const tx = Math.floor(n.x - probe.uz * off * side), tz = Math.floor(n.z + probe.ux * off * side);
    const level = footprintOk(tx, tz, 0, 0, null);
    if (level === null) continue;
    const near = villages
      .map((v) => ({ name: v.name, d: Math.hypot(v.x - n.x, v.z - n.z), dir: compassDir(v.x - n.x, v.z - n.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((v) => ({ name: v.name, dir: v.dir, tiles: Math.round(v.d) }));
    if (near.length === 0) continue;
    all.push({ kind: StructureKind.Signpost, tx, tz, hw: 0, hd: 0, level, rot: Math.atan2(-(n.z - tz), n.x - tx), biome: sampler.biomeOf(tx, tz), path: [] });
    signposts.push({ x: tx + 0.5, z: tz + 0.5, directions: near });
  }

  // --- caves in the high ground, wrecks on the beaches ---
  const siteNodes = graph.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.depth >= 2);
  shuffle(rng, siteNodes);
  for (const { n } of siteNodes) {
    if (caves.length >= CAVES && wrecks.length >= WRECKS) break;
    const probe = sampler.landProbe(n.x, n.z);
    if (!probe) continue;
    const side = rng() < 0.5 ? -1 : 1;
    // walk outward from the road looking for a cliff face (cave) or a beach (wreck)
    for (let lat = probe.roadWidth + 3; lat < probe.landWidth + 8; lat += 1.5) {
      const x = Math.floor(n.x - probe.uz * lat * side), z = Math.floor(n.z + probe.ux * lat * side);
      if (all.some((s) => Math.abs(s.tx - x) <= s.hw + 3 && Math.abs(s.tz - z) <= s.hd + 3)) continue;
      if (villages.some((v) => Math.hypot(v.x - x, v.z - z) < v.radius)) break;
      sampler.sampleTile(x, z, sample);
      const level = sample.level;
      if (sample.type === TileType.High && caves.length < CAVES) {
        if (caves.some((c) => Math.hypot(c.x - x, c.z - z) < SITE_SPACING)) continue;
        const biome = sampler.biomeOf(x, z);
        all.push({ kind: StructureKind.CaveMouth, tx: x, tz: z, hw: 1, hd: 1, level, rot: Math.atan2(-(n.z - z), n.x - x), biome, path: [] });
        caves.push({ id: `cave:${x},${z}`, name: `${CAVE_NAMES[caves.length % CAVE_NAMES.length]}`, x: x + 0.5, z: z + 0.5 });
        break;
      }
      if (sample.type === TileType.Sand && level <= 1 && wrecks.length < WRECKS) {
        if (wrecks.some((w) => Math.hypot(w.x - x, w.z - z) < SITE_SPACING)) continue;
        const biome = sampler.biomeOf(x, z);
        all.push({ kind: StructureKind.Shipwreck, tx: x, tz: z, hw: 2, hd: 1, level, rot: rng() * Math.PI * 2, biome, path: [] });
        wrecks.push({ id: `wreck:${x},${z}`, name: `${WRECK_NAMES[wrecks.length % WRECK_NAMES.length]}`, x: x + 0.5, z: z + 0.5 });
        break;
      }
    }
  }

  return { piers, signposts, caves, wrecks };
}
