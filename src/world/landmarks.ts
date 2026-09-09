import type { Rng } from '../core/rng';
import { shuffle } from '../core/rng';
import type { Biome } from './biomes';
import type { RoadGraph } from './graph';
import { pairJetties } from './piers';
import { rand2 } from '../core/rng';
import { derive } from '../core/salts';
import { StructureKind, type Pier, type Settling, type Signpost, type Site, type Structure, type Village } from './structures';
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

/**
 * The same four things, asked of places rather than found by walking a tree.
 *
 * The difference is only in the choosing. A signpost stands at a crossroads because that crossroads
 * is out in the country and its own name says so — not because it was the eleventh node a shuffle
 * reached. A cave is in the first cliff face somebody walking out from a crossroads finds, which is
 * the same rule as before and was always local; what was not local was which crossroads got to look.
 *
 * So each place is asked, in the order its name sorts, and nothing is counted. A patch of country
 * with a great many cliffs in it has a great many caves, which is what a country with cliffs in it
 * should have.
 */
export interface Places {
  sampler: TerrainSampler;
  sample: TileSample;
  all: Structure[];
  villages: Village[];
  footprintOk: (tx: number, tz: number, hw: number, hd: number, level: number | null) => number | null;
  settling: Settling;
}

/** Salts, so the questions asked of a crossroads cannot be the same number. */
const OF_A_POST = 0x51a7;
const OF_A_HOLE = 0x2ca4;

/** Share of the crossroads out in the country that carry a signpost, and how far one points. */
const POSTED = 0.34;
const A_DAYS_WALK = 260;
/**
 * And the share that are worth walking out from, looking for a cliff or a beach — and how far.
 *
 * Further than the road tree's version walks, because it stopped at the width of the band of land
 * around a road, and a country whose land is a shape has no such band: the number it reports is a
 * fixed twenty-two, which stops the walk in open fields well before any coast. Forty tiles is far
 * enough to reach the sea from a road that runs near it, and near enough that what is found belongs
 * to the crossroads it was found from.
 */
const WORTH_A_LOOK = 0.45;
const LOOK_OUT_TO = 40;
/**
 * How high the country has to stand for a cave to be cut into it, in terraces.
 *
 * The road tree's rule was "a tile drawn as high ground", and that does not carry over. There, a
 * mountain is a lift added to a tile's own rise, so its flanks read as `High`; in a country made of
 * polygons the mountains raise the *base* the tiles are measured from, so the ground can stand
 * fifteen terraces up and every tile of it still read as ordinary ground. A world of cliffs would
 * have had no caves in it and nothing would have said so.
 *
 * So the country is asked instead, at the same height its own biome starts calling itself mountain.
 */
const CAVE_COUNTRY = 8;

export function markThePlaces(o: Places): { piers: Pier[]; signposts: Signpost[]; caves: Site[]; wrecks: Site[] } {
  const { sampler, sample, all, villages, footprintOk, settling } = o;
  const signposts: Signpost[] = [];
  const caves: Site[] = [];
  const wrecks: Site[] = [];
  const seed = sampler.seed;

  for (const post of settling.posts ?? []) {
    // never inside a village: a signpost among the houses is telling you where you already are
    if (villages.some((v) => Math.hypot(v.x - post.x, v.z - post.z) < v.radius)) continue;
    const key = nameKey(post.id);
    if (rand2(derive(seed, OF_A_POST), key, 0, OF_A_POST) < POSTED) {
      raiseSignpost(o, post, key, signposts);
    }
    if (rand2(derive(seed, OF_A_HOLE), key, 0, OF_A_HOLE) < WORTH_A_LOOK) {
      lookAround(o, post, key, caves, wrecks);
    }
  }
  void sample; void all; void footprintOk;
  return { piers: [], signposts, caves, wrecks };
}

/** A signpost beside the road, naming the nearest three places anybody would want. */
function raiseSignpost(o: Places, post: { id: string; x: number; z: number }, key: number, out: Signpost[]): void {
  const { sampler, footprintOk, settling } = o;
  const probe = sampler.landProbe(post.x, post.z);
  if (!probe || !probe.land) return;
  const side = rand2(derive(sampler.seed, OF_A_POST), key, 1, OF_A_POST) < 0.5 ? -1 : 1;
  const off = probe.roadWidth + 1.4;
  const tx = Math.floor(post.x - probe.uz * off * side), tz = Math.floor(post.z + probe.ux * off * side);
  const level = footprintOk(tx, tz, 0, 0, null);
  if (level === null) return;

  const near = (settling.neighbours ?? [])
    .map((v) => ({ name: v.name, d: Math.hypot(v.x - post.x, v.z - post.z), dir: compassDir(v.x - post.x, v.z - post.z) }))
    .filter((v) => v.d > 0 && v.d <= A_DAYS_WALK)
    .sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : 1))
    .slice(0, 3)
    .map((v) => ({ name: v.name, dir: v.dir, tiles: Math.round(v.d) }));
  if (near.length === 0) return;                    // nothing to point at is not a signpost

  o.all.push({
    kind: StructureKind.Signpost, tx, tz, hw: 0, hd: 0, level,
    rot: Math.atan2(-(post.z - tz), post.x - tx), biome: sampler.biomeOf(tx, tz), path: [],
  });
  out.push({ x: tx + 0.5, z: tz + 0.5, directions: near });
}

/** Walk out from a crossroads until the ground gives you a cliff to go into or a beach to lie on. */
function lookAround(
  o: Places, post: { id: string; x: number; z: number }, key: number, caves: Site[], wrecks: Site[],
): void {
  const { sampler, sample, all, villages } = o;
  const probe = sampler.landProbe(post.x, post.z);
  if (!probe) return;
  const side = rand2(derive(sampler.seed, OF_A_HOLE), key, 1, OF_A_HOLE) < 0.5 ? -1 : 1;
  for (let lat = probe.roadWidth + 3; lat < LOOK_OUT_TO; lat += 1.5) {
    const x = Math.floor(post.x - probe.uz * lat * side), z = Math.floor(post.z + probe.ux * lat * side);
    if (all.some((s) => Math.abs(s.tx - x) <= s.hw + 3 && Math.abs(s.tz - z) <= s.hd + 3)) continue;
    if (villages.some((v) => Math.hypot(v.x - x, v.z - z) < v.radius)) return;
    sampler.sampleTile(x, z, sample);
    const level = sample.level;
    // the name comes from the place, so two patches that both find this cliff call it the same
    if (sample.type !== TileType.Skip && sample.type !== TileType.Seabed && sample.type !== TileType.Water
      && (sample.type === TileType.High || sampler.highlandAt(x + 0.5, z + 0.5) >= CAVE_COUNTRY)) {
      const biome = sampler.biomeOf(x, z);
      all.push({ kind: StructureKind.CaveMouth, tx: x, tz: z, hw: 1, hd: 1, level, rot: Math.atan2(-(post.z - z), post.x - x), biome, path: [] });
      caves.push({ id: `cave:${x},${z}`, name: CAVE_NAMES[nameKey(`cave:${x},${z}`) % CAVE_NAMES.length], x: x + 0.5, z: z + 0.5 });
      return;
    }
    if (sample.type === TileType.Sand && level <= 1) {
      const biome = sampler.biomeOf(x, z);
      const turn = rand2(derive(sampler.seed, OF_A_HOLE), key, 2, OF_A_HOLE) * Math.PI * 2;
      all.push({ kind: StructureKind.Shipwreck, tx: x, tz: z, hw: 2, hd: 1, level, rot: turn, biome, path: [] });
      wrecks.push({ id: `wreck:${x},${z}`, name: WRECK_NAMES[nameKey(`wreck:${x},${z}`) % WRECK_NAMES.length], x: x + 0.5, z: z + 0.5 });
      return;
    }
  }
}

/** A place's name as a number, so what stands there can be decided by it. */
function nameKey(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
