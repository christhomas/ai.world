import { GRAPH } from '../core/config';
import { mulberry32, shuffle } from '../core/rng';
import type { Biome } from './biomes';
import type { TerrainSampler, TileSample } from './terrain';
import { TileType } from './terrain';

/**
 * Villages and points of interest. Houses are placed on flat land beside roads, get a door path
 * back to the road, and are rendered as instanced props. POIs sit off the road as things to find.
 */

export const enum StructureKind {
  House = 1,
  Well = 2,
  Shrine = 3,
  Ruins = 4,
  Tower = 5,
  Campfire = 6,
  GiantTree = 7,
  Plaza = 8,   // town square: flattened disc, no prop of its own
  Stall = 9,
  Sign = 10,
  Church = 11,
}

export type ShopType = 'store' | 'smith' | 'inn' | 'apothecary';

export interface Shop {
  type: ShopType;
  house: Structure;
  /** Where the shopkeeper stands (tile coords). */
  doorX: number;
  doorZ: number;
}

export interface Structure {
  kind: StructureKind;
  /** Footprint centre tile (integer tile coords of the centre tile). */
  tx: number;
  tz: number;
  /** Footprint half sizes in tiles (1 = 3x3). */
  hw: number;
  hd: number;
  level: number;
  rot: number;      // radians, multiple of PI/2 for houses
  biome: Biome;
  /** Tiles turned into path from the door to the road. */
  path: Array<[number, number]>;
  /** Plaza only: disc radius in tiles. */
  radius?: number;
}

export interface Village {
  name: string;
  x: number;
  z: number;
  radius: number;
  level: number;
  biome: Biome;
  houses: Structure[];
  shops: Shop[];
  church: Structure | null;
  /** Tile in front of the church door where the congregation gathers. */
  churchDoor: [number, number] | null;
}

export interface Poi {
  name: string;
  kind: StructureKind;
  x: number;
  z: number;
  structure: Structure;
}

export interface Structures {
  villages: Village[];
  pois: Poi[];
  all: Structure[];
}

export const VILLAGES = 16;
export const POIS = 28;
const SHOP_ORDER: ShopType[] = ['store', 'smith', 'inn', 'apothecary'];

const PREFIX = ['Oak', 'Ash', 'Elder', 'Stone', 'Mill', 'Fern', 'Brook', 'Wolf', 'Silver', 'Amber', 'Frost', 'Dune', 'Reed', 'Moss', 'Hawk', 'Bramble', 'Thorn', 'Willow', 'Crag', 'Salt'];
const SUFFIX = ['ford', 'hollow', 'mere', 'stead', 'wick', 'bury', 'haven', 'ton', 'vale', 'cross', 'field', 'reach', 'holm', 'gate', 'moor'];

const POI_NAMES: Record<number, string[]> = {
  [StructureKind.Shrine]: ['Shrine of Winds', 'Moonwell Shrine', 'Shrine of the Quiet Stone', 'Sunken Shrine', 'Shrine of Echoes'],
  [StructureKind.Ruins]: ['Old Ruins', 'Fallen Keep', 'Ruins of Aldra', 'Broken Hall', 'The Forgotten Walls'],
  [StructureKind.Tower]: ['Watchtower', 'Lonely Spire', 'Beacon Tower', 'Sentinel Post', 'Gull Tower'],
  [StructureKind.Campfire]: ['Abandoned Camp', "Wanderer's Rest", 'Cold Campfire', "Trapper's Camp", 'Roadside Camp'],
  [StructureKind.GiantTree]: ['The Great Oak', 'Elder Tree', 'Heartwood', 'The Old One', 'Grandfather Oak'],
};

export function generateStructures(sampler: TerrainSampler): Structures {
  const graph = sampler.graph;
  const rng = mulberry32((graph.seed ^ 0x5a5a5a) >>> 0);
  const villages: Village[] = [];
  const pois: Poi[] = [];
  const all: Structure[] = [];
  const usedNames = new Set<string>();
  const sample: TileSample = sampler.newSample();

  const villageName = (): string => {
    for (let i = 0; i < 20; i++) {
      const n = PREFIX[Math.floor(rng() * PREFIX.length)] + SUFFIX[Math.floor(rng() * SUFFIX.length)];
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    return 'Nowhere';
  };

  let plazaX = 0, plazaZ = 0, plazaR = 0; // current village square; footprints keep clear of it

  /** Is this tile inside another structure's footprint, yard, or door path? */
  const occupied = (x: number, z: number): boolean => {
    for (const s of all) {
      if (s.kind === StructureKind.Plaza) continue;
      if (Math.abs(x - s.tx) <= s.hw + 1 && Math.abs(z - s.tz) <= s.hd + 1) return true;
      for (const [px, pz] of s.path) if (px === x && pz === z) return true;
    }
    return false;
  };

  /** All tiles of a footprint are flat land at `level`, with no water/road, and no other structure nearby. */
  const footprintOk = (tx: number, tz: number, hw: number, hd: number, level: number | null): number | null => {
    if (plazaR > 0 && Math.hypot(tx + 0.5 - plazaX, tz + 0.5 - plazaZ) < plazaR + hw + 2) return null;
    let lvl = level;
    for (let dz = -hd - 1; dz <= hd + 1; dz++) {
      for (let dx = -hw - 1; dx <= hw + 1; dx++) {
        sampler.sampleTile(tx + dx, tz + dz, sample);
        const t = sample.type;
        const inner = Math.abs(dx) <= hw && Math.abs(dz) <= hd;
        if (t === TileType.Skip || t === TileType.Seabed || t === TileType.Water || t === TileType.Bridge) return null;
        if (inner && t === TileType.Road) return null;
        if (!inner) continue; // the yard ring may be a road or slope; it just must be land
        if (lvl === null) lvl = sample.level;
        else if (sample.level !== lvl) return null;
      }
    }
    for (const s of all) {
      if (s.kind === StructureKind.Plaza) continue;
      if (Math.abs(s.tx - tx) <= s.hw + hw + 1 && Math.abs(s.tz - tz) <= s.hd + hd + 1) return null;
      for (const [px, pz] of s.path) if (Math.abs(px - tx) <= hw && Math.abs(pz - tz) <= hd) return null;
    }
    return lvl;
  };

  /** Walk from the door tile toward the road until a road tile is hit. */
  const doorPath = (tx: number, tz: number, level: number, roadX: number, roadZ: number): Array<[number, number]> | null => {
    const path: Array<[number, number]> = [];
    let x = tx, z = tz;
    for (let i = 0; i < 14; i++) {
      sampler.sampleTile(x, z, sample);
      if (sample.type === TileType.Road || sample.type === TileType.Bridge) return path;
      if (sample.type === TileType.Skip || sample.type === TileType.Seabed || sample.type === TileType.Water) return null;
      if (Math.abs(sample.level - level) > 1) return null;
      if (occupied(x, z)) return null;
      path.push([x, z]);
      const dx = roadX - (x + 0.5), dz = roadZ - (z + 0.5);
      if (Math.abs(dx) > Math.abs(dz)) x += Math.sign(dx); else z += Math.sign(dz);
    }
    return null;
  };

  const placeHouse = (cx: number, cz: number, biome: Biome): Structure | null => {
    const tx = Math.floor(cx), tz = Math.floor(cz);
    const hw = 1, hd = 1;
    const probe = sampler.landProbe(tx + 0.5, tz + 0.5);
    if (!probe || !probe.land) return null;
    const level = footprintOk(tx, tz, hw, hd, probe.baseLevel);
    if (level === null) return null;
    // door faces the road
    const ang = Math.atan2(probe.cz - (tz + 0.5), probe.cx - (tx + 0.5));
    const rot = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    const fx = Math.round(Math.cos(rot)), fz = Math.round(Math.sin(rot));
    const reach = Math.abs(fx) > 0 ? hw : hd;
    const doorX = tx + fx * (reach + 1), doorZ = tz + fz * (reach + 1);
    const path = doorPath(doorX, doorZ, level, probe.cx, probe.cz);
    if (!path) return null;
    const s: Structure = { kind: StructureKind.House, tx, tz, hw, hd, level, rot, biome, path };
    all.push(s);
    return s;
  };

  const buildVillage = (nodeIdx: number, spread: number, maxHouses: number, minHouses: number, squareR: number): Village | null => {
    const n = graph.nodes[nodeIdx];
    const probe = sampler.landProbe(n.x, n.z);
    if (!probe || !probe.land) return null;
    const biome = sampler.biomeOf(n.x, n.z);
    const level = n.level;
    const ctx = Math.floor(n.x), ctz = Math.floor(n.z);
    // town square first: everything else keeps clear of it
    plazaX = ctx + 0.5; plazaZ = ctz + 0.5; plazaR = squareR;
    const plaza: Structure = { kind: StructureKind.Plaza, tx: ctx, tz: ctz, hw: Math.ceil(squareR), hd: Math.ceil(squareR), level, rot: 0, biome, path: [], radius: squareR };
    const mark = all.length;
    all.push(plaza);
    all.push({ kind: StructureKind.Well, tx: ctx, tz: ctz, hw: 0, hd: 0, level, rot: 0, biome, path: [] });

    // church on the edge of the square, facing the well
    let church: Structure | null = null;
    let churchDoor: [number, number] | null = null;
    const nx = -probe.uz, nz = probe.ux;
    for (let attempt = 0; attempt < 12 && !church; attempt++) {
      const a = attempt < 2 ? Math.atan2(nz, nx) + attempt * Math.PI : rng() * Math.PI * 2;
      const dist = squareR + 2.6;
      const cx = Math.floor(plazaX + Math.cos(a) * dist), cz = Math.floor(plazaZ + Math.sin(a) * dist);
      plazaR = 0; // the church may touch the square
      const lvl = footprintOk(cx, cz, 1, 1, level);
      plazaR = squareR;
      if (lvl === null) continue;
      const toCentre = Math.atan2(plazaZ - (cz + 0.5), plazaX - (cx + 0.5));
      const rot = Math.round(toCentre / (Math.PI / 2)) * (Math.PI / 2);
      const fx = Math.round(Math.cos(rot)), fz = Math.round(Math.sin(rot));
      const door: [number, number] = [cx + fx * 2, cz + fz * 2];
      // path from the door to the square
      const path: Array<[number, number]> = [];
      let px = door[0], pz = door[1];
      for (let i = 0; i < 6 && Math.hypot(px + 0.5 - plazaX, pz + 0.5 - plazaZ) > squareR; i++) {
        path.push([px, pz]);
        px += fx; pz += fz;
      }
      church = { kind: StructureKind.Church, tx: cx, tz: cz, hw: 1, hd: 1, level, rot, biome, path };
      churchDoor = door;
      all.push(church);
    }

    const houses: Structure[] = [];
    for (let attempt = 0; attempt < 80 && houses.length < maxHouses; attempt++) {
      const side = rng() < 0.5 ? -1 : 1;
      const along = (rng() - 0.5) * 2 * spread;
      const lat = probe.roadWidth + 2.5 + rng() * 6;
      const cx = n.x + probe.ux * along + nx * lat * side;
      const cz = n.z + probe.uz * along + nz * lat * side;
      const h = placeHouse(cx, cz, biome);
      if (h) houses.push(h);
    }
    if (houses.length < minHouses) {
      all.length = mark;
      plazaR = 0;
      return null;
    }
    // market stalls on the square
    const stallAngle = rng() * Math.PI * 2;
    for (let i = 0; i < 2; i++) {
      const a = stallAngle + i * 2.4;
      const sx = Math.floor(plazaX + Math.cos(a) * (squareR - 1.6)), sz = Math.floor(plazaZ + Math.sin(a) * (squareR - 1.6));
      all.push({ kind: StructureKind.Stall, tx: sx, tz: sz, hw: 0, hd: 0, level, rot: a + Math.PI, biome, path: [] });
    }
    // the first few houses are shops; a sign stands beside each door
    const shops: Shop[] = [];
    const nShops = Math.min(houses.length - 1, 2 + (houses.length >= 6 ? 1 : 0) + (houses.length >= 8 ? 1 : 0));
    for (let i = 0; i < nShops; i++) {
      const h = houses[i];
      const door = h.path[0] ?? [h.tx + Math.round(Math.cos(h.rot)) * 2, h.tz + Math.round(Math.sin(h.rot)) * 2];
      const fx = Math.round(Math.cos(h.rot)), fz = Math.round(Math.sin(h.rot));
      // sign one tile beside the door, along the wall
      const sx = h.tx + fx * 2 + (fz !== 0 ? 1 : 0) * 1, sz = h.tz + fz * 2 + (fx !== 0 ? 1 : 0) * 1;
      all.push({ kind: StructureKind.Sign, tx: sx, tz: sz, hw: 0, hd: 0, level: h.level, rot: h.rot, biome, path: [] });
      shops.push({ type: SHOP_ORDER[i % SHOP_ORDER.length], house: h, doorX: door[0], doorZ: door[1] });
    }
    plazaR = 0;
    return { name: villageName(), x: n.x, z: n.z, radius: spread + 8, level, biome, houses, shops, church, churchDoor };
  };

  // --- hub town ---
  const hub = buildVillage(0, 18, 10, 1, 5.5);
  if (hub) { hub.name = 'Crossroads Town'; villages.push(hub); }

  // --- towns: the secondary hubs the road graph grew webs around ---
  for (const t of graph.towns) {
    const n = graph.nodes[t];
    if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < 70)) continue;
    const v = buildVillage(t, 14, 10, 3, 5);
    if (v) villages.push(v);
  }

  // --- smaller villages on wide, deep branches ---
  const sites = graph.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.depth >= 3 && n.size >= 10 && Math.hypot(n.x, n.z) > GRAPH.HUB_RADIUS * 1.6);
  shuffle(rng, sites);
  for (const { n, i } of sites) {
    if (villages.length >= VILLAGES + 1) break;
    if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < 80)) continue;
    const v = buildVillage(i, 11, 6, 3, 4);
    if (v) villages.push(v);
  }

  // --- points of interest off the road ---
  const poiKinds = [StructureKind.Shrine, StructureKind.Ruins, StructureKind.Tower, StructureKind.Campfire, StructureKind.GiantTree];
  const spots = graph.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.depth >= 2);
  shuffle(rng, spots);
  for (const { n } of spots) {
    if (pois.length >= POIS) break;
    if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < v.radius + 12)) continue;
    if (pois.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < 45)) continue;
    const probe = sampler.landProbe(n.x, n.z);
    if (!probe) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const lat = probe.roadWidth + 4 + rng() * Math.max(2, probe.landWidth - probe.roadWidth - 8);
    const cx = n.x - probe.uz * lat * side, cz = n.z + probe.ux * lat * side;
    const tx = Math.floor(cx), tz = Math.floor(cz);
    const kind = poiKinds[Math.floor(rng() * poiKinds.length)];
    const half = kind === StructureKind.Campfire ? 1 : kind === StructureKind.Tower ? 1 : 2;
    const level = footprintOk(tx, tz, half, half, null);
    if (level === null) continue;
    const biome = sampler.biomeOf(cx, cz);
    const s: Structure = { kind, tx, tz, hw: half, hd: half, level, rot: rng() * Math.PI * 2, biome, path: [] };
    all.push(s);
    const names = POI_NAMES[kind].filter((n) => !usedNames.has(n));
    if (names.length === 0) { all.pop(); continue; }
    const name = names[Math.floor(rng() * names.length)];
    usedNames.add(name);
    pois.push({ name, kind, x: tx + 0.5, z: tz + 0.5, structure: s });
  }

  return { villages, pois, all };
}

export function structureBounds(s: Structure): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = s.tx - s.hw - 1, maxX = s.tx + s.hw + 1, minZ = s.tz - s.hd - 1, maxZ = s.tz + s.hd + 1;
  if (s.kind === StructureKind.Sign || s.kind === StructureKind.Stall) { minX = s.tx; maxX = s.tx; minZ = s.tz; maxZ = s.tz; }
  for (const [x, z] of s.path) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Village that contains (x,z), if any. */
export function villageAt(villages: Village[], x: number, z: number): Village | null {
  for (const v of villages) if (Math.hypot(v.x - x, v.z - z) < v.radius) return v;
  return null;
}

