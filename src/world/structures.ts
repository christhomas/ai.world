import { footprintLevel } from './footprint';
import { GRAPH } from '../core/config';
import { mulberry32, shuffle } from '../core/rng';
import { SALT, derive } from '../core/salts';
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
  Pier = 12,   // wooden jetty; tiles listed in `path`
  Signpost = 13, // fingerpost at a junction, naming the nearest settlements
  NoticeBoard = 16, // village board: errands posted where anyone can read them
  CaveMouth = 14, // way into a cave anchor
  Shipwreck = 15, // broken hull on a beach with one hold to loot
}

export interface Pier {
  island: string;
  side: 'mainland' | 'island';
  /** Deck tiles from the shore outward. */
  tiles: Array<[number, number]>;
  /** Unit direction the pier points (axis-aligned). */
  dx: number;
  dz: number;
  level: number;
  /** Tile where a boat docks: one past the last deck tile. */
  dockX: number;
  dockZ: number;
}

export type ShopType = 'store' | 'smith' | 'inn' | 'apothecary';

export interface Shop {
  type: ShopType;
  house: Structure;
  /** Where the shopkeeper stands (tile coords). */
  doorX: number;
  doorZ: number;
}

/**
 * The village pub. It is one of the houses, like a shop is, but it is not a shop: nothing on its
 * shelves is why you go in. What it holds is the room's talk, which lives in the game layer.
 */
export interface Pub {
  house: Structure;
  /** Where the doorway is, and where the talk happens (tile coords). */
  doorX: number;
  doorZ: number;
}

/**
 * The village police station, with the cell at the back of it. Like the pub it is one of the
 * ordinary houses, because a village does not raise a gaol out of nothing: it gives the law a
 * roof off its own street and hangs a sign on it, and the sign is the only thing that tells the
 * building from a home. What goes on behind the door is the game layer's business.
 */
export interface Station {
  house: Structure;
  /** The doorway: where anybody is brought in, turned out, and looked in on (tile coords). */
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

/** A doorway you can walk through, and what waits on the other side. */
export interface Doorway {
  /** Tile just outside the door. */
  x: number;
  z: number;
  kind: 'house' | 'church' | ShopType;
  village: string;
  /** Building position, which seeds its interior. */
  bx: number;
  bz: number;
}

export interface Village {
  name: string;
  /** Where the notice board stands, if the square had room for one. */
  board: [number, number] | null;
  x: number;
  z: number;
  radius: number;
  level: number;
  biome: Biome;
  houses: Structure[];
  shops: Shop[];
  /** The pub, if the village runs to one. */
  pub: Pub | null;
  /** The police station, if the village is big enough to be worth keeping law in. */
  station: Station | null;
  church: Structure | null;
  /** Tile in front of the church door where the congregation gathers. */
  churchDoor: [number, number] | null;
  /** Market pitches around the square, in the order they were laid out. */
  stalls: Array<[number, number]>;
}

export interface Poi {
  name: string;
  kind: StructureKind;
  x: number;
  z: number;
  structure: Structure;
}

export interface Signpost {
  x: number;
  z: number;
  /** Nearest settlements, closest first. */
  directions: Array<{ name: string; dir: string; tiles: number }>;
}

/** A discoverable place attached to its own manifest anchor. */
export interface Site {
  id: string;
  name: string;
  x: number;
  z: number;
}

export interface Structures {
  doors: Doorway[];
  villages: Village[];
  pois: Poi[];
  all: Structure[];
  piers: Pier[];
  signposts: Signpost[];
  caves: Site[];
  wrecks: Site[];
}

export const VILLAGES = 16;
export const POIS = 28;
const SHOP_ORDER: ShopType[] = ['store', 'smith', 'inn', 'apothecary'];

/** Layout tuning for settlements and points of interest. Distances in tiles. */
const LAYOUT = {
  NAME_ATTEMPTS: 20,
  CHURCH_ATTEMPTS: 12,
  CHURCH_OFFSET: 2.6,          // beyond the square's edge
  CHURCH_PATH_MAX: 6,
  HOUSE_ATTEMPTS: 80,
  PUB_HOUSES: 4,               // houses a village needs before one of them is the pub
  STATION_HOUSES: 6,           // and before the law is worth a building of its own
  HOUSE_LATERAL_MIN: 2.5,      // beyond the road edge
  HOUSE_LATERAL_RANGE: 6,
  STALLS: 2,
  STALL_ANGLE_GAP: 2.4,        // radians between stalls
  STALL_INSET: 1.6,            // inside the square's edge
  DOOR_PATH_MAX: 14,
  VILLAGE_SPACING: 80,
  TOWN_SPACING: 70,
  POI_SPACING: 45,
  POI_VILLAGE_CLEARANCE: 12,   // beyond the village radius
  POI_LATERAL_MIN: 4,          // beyond the road edge
  HUB: { spread: 18, maxHouses: 10, minHouses: 1, squareR: 5.5 },
  TOWN: { spread: 14, maxHouses: 10, minHouses: 3, squareR: 5 },
  VILLAGE: { spread: 11, maxHouses: 6, minHouses: 3, squareR: 4 },
} as const;

/** How many of a village's houses are shops: two, plus one each at six and eight houses. */
function shopCount(houses: number): number {
  return Math.min(houses - 1, 2 + (houses >= 6 ? 1 : 0) + (houses >= 8 ? 1 : 0));
}

/** Snap an angle to the nearest quarter turn and return it with its unit step. */
function facing(angle: number): { rot: number; fx: number; fz: number } {
  const rot = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  return { rot, fx: Math.round(Math.cos(rot)), fz: Math.round(Math.sin(rot)) };
}

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
  const rng = mulberry32(derive(graph.seed, SALT.STRUCTURES));
  const villages: Village[] = [];
  const pois: Poi[] = [];
  const all: Structure[] = [];
  const piers: Pier[] = [];
  const signposts: Signpost[] = [];
  const caves: Site[] = [];
  const wrecks: Site[] = [];
  const doors: Doorway[] = [];
  const usedNames = new Set<string>();
  const sample: TileSample = sampler.newSample();

  const villageName = (): string => {
    for (let i = 0; i < LAYOUT.NAME_ATTEMPTS; i++) {
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

  /**
   * Could somebody walk from the road out to here?
   *
   * The ground climbs away from the road, so a landmark placed far off it can sit above a step
   * nobody can climb — and nothing in the game would ever say so: the quest naming it would
   * simply be impossible. So the line from the road node to the spot is walked, and a spot is
   * refused if the ground ever jumps more than a terrace between one step and the next.
   *
   * Measured in terraces rather than in the hero's units on purpose: one terrace is a stride and
   * two is a wall, which is a fact about how this world is built and belongs here rather than
   * being borrowed from whoever happens to be walking.
   */
  const walkableFrom = (fromX: number, fromZ: number, toX: number, toZ: number): boolean => {
    const dx = toX - fromX, dz = toZ - fromZ;
    const steps = Math.ceil(Math.hypot(dx, dz) * 2);
    if (steps === 0) return true;
    let last: number | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      sampler.sampleTile(Math.floor(fromX + dx * t), Math.floor(fromZ + dz * t), sample);
      if (sample.type === TileType.Water) return false;
      if (last !== null && Math.abs(sample.level - last) > 1) return false;
      last = sample.level;
    }
    return true;
  };

  /** All tiles of a footprint are flat land at `level`, with no water/road, and no other structure nearby. */
  const footprintOk = (tx: number, tz: number, hw: number, hd: number, level: number | null): number | null => {
    if (plazaR > 0 && Math.hypot(tx + 0.5 - plazaX, tz + 0.5 - plazaZ) < plazaR + hw + 2) return null;
    const lvl = footprintLevel(sampler, tx, tz, hw, hd, level, sample);
    if (lvl === null) return null;
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
    for (let i = 0; i < LAYOUT.DOOR_PATH_MAX; i++) {
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
    const { rot, fx, fz } = facing(Math.atan2(probe.cz - (tz + 0.5), probe.cx - (tx + 0.5)));
    const reach = Math.abs(fx) > 0 ? hw : hd;
    const doorX = tx + fx * (reach + 1), doorZ = tz + fz * (reach + 1);
    const path = doorPath(doorX, doorZ, level, probe.cx, probe.cz);
    if (!path) return null;
    const s: Structure = { kind: StructureKind.House, tx, tz, hw, hd, level, rot, biome, path };
    all.push(s);
    return s;
  };

  /** Chapel on the edge of the current square, facing the well, with a short path onto the cobbles. */
  const placeChurch = (squareR: number, level: number, biome: Biome, roadNormalAngle: number): { church: Structure | null; churchDoor: [number, number] | null } => {
    for (let attempt = 0; attempt < LAYOUT.CHURCH_ATTEMPTS; attempt++) {
      // try the two sides of the road first, then random directions
      const a = attempt < 2 ? roadNormalAngle + attempt * Math.PI : rng() * Math.PI * 2;
      const dist = squareR + LAYOUT.CHURCH_OFFSET;
      const cx = Math.floor(plazaX + Math.cos(a) * dist), cz = Math.floor(plazaZ + Math.sin(a) * dist);
      plazaR = 0; // the church may touch the square
      const lvl = footprintOk(cx, cz, 1, 1, level);
      plazaR = squareR;
      if (lvl === null) continue;
      const { rot, fx, fz } = facing(Math.atan2(plazaZ - (cz + 0.5), plazaX - (cx + 0.5)));
      const door: [number, number] = [cx + fx * 2, cz + fz * 2];
      const path: Array<[number, number]> = [];
      let px = door[0], pz = door[1];
      for (let i = 0; i < LAYOUT.CHURCH_PATH_MAX && Math.hypot(px + 0.5 - plazaX, pz + 0.5 - plazaZ) > squareR; i++) {
        path.push([px, pz]);
        px += fx; pz += fz;
      }
      const church: Structure = { kind: StructureKind.Church, tx: cx, tz: cz, hw: 1, hd: 1, level, rot, biome, path };
      all.push(church);
      return { church, churchDoor: door };
    }
    return { church: null, churchDoor: null };
  };

  /** Market stalls just inside the square's edge, facing the well. */
  const placeStalls = (squareR: number, level: number, biome: Biome): Array<[number, number]> => {
    const stallAngle = rng() * Math.PI * 2;
    const pitches: Array<[number, number]> = [];
    for (let i = 0; i < LAYOUT.STALLS; i++) {
      const a = stallAngle + i * LAYOUT.STALL_ANGLE_GAP;
      const r = squareR - LAYOUT.STALL_INSET;
      const sx = Math.floor(plazaX + Math.cos(a) * r), sz = Math.floor(plazaZ + Math.sin(a) * r);
      all.push({ kind: StructureKind.Stall, tx: sx, tz: sz, hw: 0, hd: 0, level, rot: a + Math.PI, biome, path: [] });
      pitches.push([sx + 0.5, sz + 0.5]);
    }
    return pitches;
  };

  /** A house's door tile, with a sign raised one tile beside it along the wall. */
  const signedDoor = (h: Structure, biome: Biome): [number, number] => {
    const fx = Math.round(Math.cos(h.rot)), fz = Math.round(Math.sin(h.rot));
    const door = h.path[0] ?? [h.tx + fx * 2, h.tz + fz * 2];
    const sx = h.tx + fx * 2 + (fz !== 0 ? 1 : 0), sz = h.tz + fz * 2 + (fx !== 0 ? 1 : 0);
    all.push({ kind: StructureKind.Sign, tx: sx, tz: sz, hw: 0, hd: 0, level: h.level, rot: h.rot, biome, path: [] });
    return [door[0], door[1]];
  };

  /** The first few houses become shops (store, smith, inn, apothecary in turn); a sign stands beside each door. */
  const assignShops = (houses: Structure[], biome: Biome): Shop[] => {
    const shops: Shop[] = [];
    for (let i = 0; i < shopCount(houses.length); i++) {
      const [doorX, doorZ] = signedDoor(houses[i], biome);
      shops.push({ type: SHOP_ORDER[i % SHOP_ORDER.length], house: houses[i], doorX, doorZ });
    }
    return shops;
  };

  /**
   * The pub takes the first house the shops did not, so a village that is big enough to keep one
   * always has it on the same street as its trade. It hangs a sign like a shop does, because from
   * the road that is the only way to tell either of them from a home.
   */
  const assignPub = (houses: Structure[], biome: Biome): Pub | null => {
    if (houses.length < LAYOUT.PUB_HOUSES) return null;
    const house = houses[shopCount(houses.length)];
    if (!house) return null;
    const [doorX, doorZ] = signedDoor(house, biome);
    return { house, doorX, doorZ };
  };

  /**
   * The station takes the house after the pub's, so the law stands on the same street as the
   * trade and the drink, which is where it is wanted on a Friday night. A village of a few
   * cottages never gets one: everybody there knows who did it, and a cell that is never filled is
   * a cell nobody would have built.
   */
  const assignStation = (houses: Structure[], biome: Biome): Station | null => {
    if (houses.length < LAYOUT.STATION_HOUSES) return null;
    const house = houses[shopCount(houses.length) + 1];
    if (!house) return null;
    const [doorX, doorZ] = signedDoor(house, biome);
    return { house, doorX, doorZ };
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

    const nx = -probe.uz, nz = probe.ux;
    const { church, churchDoor } = placeChurch(squareR, level, biome, Math.atan2(nz, nx));

    const houses: Structure[] = [];
    for (let attempt = 0; attempt < LAYOUT.HOUSE_ATTEMPTS && houses.length < maxHouses; attempt++) {
      const side = rng() < 0.5 ? -1 : 1;
      const along = (rng() - 0.5) * 2 * spread;
      const lat = probe.roadWidth + LAYOUT.HOUSE_LATERAL_MIN + rng() * LAYOUT.HOUSE_LATERAL_RANGE;
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
    // a notice board at the edge of the square, facing the well
    let board: [number, number] | null = null;
    for (let attempt = 0; attempt < 8 && !board; attempt++) {
      const a = rng() * Math.PI * 2;
      const bx = Math.floor(plazaX + Math.cos(a) * (squareR - 0.8)), bz = Math.floor(plazaZ + Math.sin(a) * (squareR - 0.8));
      if (all.some((s) => s.tx === bx && s.tz === bz)) continue;
      all.push({ kind: StructureKind.NoticeBoard, tx: bx, tz: bz, hw: 0, hd: 0, level, rot: a + Math.PI, biome, path: [] });
      board = [bx + 0.5, bz + 0.5];
    }

    const stalls = placeStalls(squareR, level, biome);
    const shops = assignShops(houses, biome);
    const pub = assignPub(houses, biome);
    const station = assignStation(houses, biome);
    plazaR = 0;
    return { name: villageName(), x: n.x, z: n.z, radius: spread + 8, level, biome, houses, shops, pub, station, church, churchDoor, board, stalls };
  };

  // --- hub town ---
  const hub = buildVillage(0, LAYOUT.HUB.spread, LAYOUT.HUB.maxHouses, LAYOUT.HUB.minHouses, LAYOUT.HUB.squareR);
  if (hub) { hub.name = 'Crossroads Town'; villages.push(hub); }

  // --- towns: the secondary hubs the road graph grew webs around ---
  for (const t of graph.towns) {
    const n = graph.nodes[t];
    if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < LAYOUT.TOWN_SPACING)) continue;
    const v = buildVillage(t, LAYOUT.TOWN.spread, LAYOUT.TOWN.maxHouses, LAYOUT.TOWN.minHouses, LAYOUT.TOWN.squareR);
    if (v) villages.push(v);
  }

  // --- smaller villages on wide, deep branches ---
  const sites = graph.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.depth >= 3 && n.size >= 10 && Math.hypot(n.x, n.z) > GRAPH.HUB_RADIUS * 1.6);
  shuffle(rng, sites);
  for (const { n, i } of sites) {
    if (villages.length >= VILLAGES + 1) break;
    if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < LAYOUT.VILLAGE_SPACING)) continue;
    const v = buildVillage(i, LAYOUT.VILLAGE.spread, LAYOUT.VILLAGE.maxHouses, LAYOUT.VILLAGE.minHouses, LAYOUT.VILLAGE.squareR);
    if (v) villages.push(v);
  }

  // --- points of interest off the road ---
  const poiKinds = [StructureKind.Shrine, StructureKind.Ruins, StructureKind.Tower, StructureKind.Campfire, StructureKind.GiantTree];
  const spots = graph.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.depth >= 2);
  shuffle(rng, spots);
  for (const { n } of spots) {
    if (pois.length >= POIS) break;
    if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < v.radius + LAYOUT.POI_VILLAGE_CLEARANCE)) continue;
    if (pois.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < LAYOUT.POI_SPACING)) continue;
    const probe = sampler.landProbe(n.x, n.z);
    if (!probe) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const lat = probe.roadWidth + LAYOUT.POI_LATERAL_MIN + rng() * Math.max(2, probe.landWidth - probe.roadWidth - 8);
    const cx = n.x - probe.uz * lat * side, cz = n.z + probe.ux * lat * side;
    const tx = Math.floor(cx), tz = Math.floor(cz);
    const kind = poiKinds[Math.floor(rng() * poiKinds.length)];
    const half = kind === StructureKind.Campfire ? 1 : kind === StructureKind.Tower ? 1 : 2;
    const level = footprintOk(tx, tz, half, half, null);
    if (level === null) continue;
    // and somewhere the hero can actually get to, now that highlands have faces you cannot climb
    if (!walkableFrom(n.x, n.z, tx + 0.5, tz + 0.5)) continue;
    const biome = sampler.biomeOf(cx, cz);
    const s: Structure = { kind, tx, tz, hw: half, hd: half, level, rot: rng() * Math.PI * 2, biome, path: [] };
    all.push(s);
    const names = POI_NAMES[kind].filter((n) => !usedNames.has(n));
    if (names.length === 0) { all.pop(); continue; }
    const name = names[Math.floor(rng() * names.length)];
    usedNames.add(name);
    pois.push({ name, kind, x: tx + 0.5, z: tz + 0.5, structure: s });
  }

  // --- piers: one on each shore per island, pointing at each other ---
  for (const isl of graph.islands) {
    let nearest = 0, nearestD = Infinity;
    for (let n = 0; n < graph.mainlandNodes; n++) {
      const d = Math.hypot(graph.nodes[n].x - isl.x, graph.nodes[n].z - isl.z);
      if (d < nearestD) { nearestD = d; nearest = n; }
    }
    const m = graph.nodes[nearest];
    const islandPier = planPier(sampler, sample, isl.id, 'island', isl.x, isl.z, m.x - isl.x, m.z - isl.z);
    const mainPier = planPier(sampler, sample, isl.id, 'mainland', m.x, m.z, isl.x - m.x, isl.z - m.z);
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

  // --- doorways: every house, shop and chapel can be walked into ---
  for (const v of villages) {
    const shopOf = new Map(v.shops.map((s) => [s.house, s.type]));
    for (const house of v.houses) {
      const [dx, dz] = doorTile(house);
      // the room behind the pub's door is an inn's room: a bar, and somebody stood behind it
      const kind = shopOf.get(house) ?? (house === v.pub?.house ? 'inn' : 'house');
      doors.push({ x: dx + 0.5, z: dz + 0.5, kind, village: v.name, bx: house.tx, bz: house.tz });
    }
    if (v.church && v.churchDoor) {
      doors.push({ x: v.churchDoor[0] + 0.5, z: v.churchDoor[1] + 0.5, kind: 'church', village: v.name, bx: v.church.tx, bz: v.church.tz });
    }
  }

  return { doors, villages, pois, all, piers, signposts, caves, wrecks };
}

/** The tile just outside a building's door. */
export function doorTile(s: Structure): [number, number] {
  const first = s.path[0];
  if (first) return first;
  const fx = Math.round(Math.cos(s.rot)), fz = Math.round(Math.sin(s.rot));
  return [s.tx + fx * 2, s.tz + fz * 2];
}

export const CAVES = 10;
export const WRECKS = 8;
const SITE_SPACING = 60;
const CAVE_NAMES = ['Weeping Cave', 'Bat Hollow', 'Deep Crack', 'Smugglers\' Cave', 'Blackmouth Cave', 'Echo Cave', 'Cold Crawl', 'Miner\'s Fault', 'Rattling Cave', 'Hermit\'s Cave'];
const WRECK_NAMES = ['Wreck of the Marigold', 'Broken Keel', 'Wreck of the Tern', 'Salt Bones', 'Wreck of the Gull', 'Old Hull', 'Wreck of the Wren', 'Storm\'s Toll'];

export const SIGNPOSTS = 22;
const SIGNPOST_SPACING = 90;

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
export function compassDir(dx: number, dz: number): string {
  return COMPASS[Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) & 7];
}

const PIER_LENGTH = 6;
const PIER_WALK_MAX = 260;

/**
 * Walk from a start point toward a direction (snapped to an axis) until the land ends, then lay
 * PIER_LENGTH deck tiles into the sea. Null if the walk never reaches a coast.
 */
function planPier(
  sampler: TerrainSampler, sample: TileSample, island: string, side: Pier['side'],
  fromX: number, fromZ: number, dirX: number, dirZ: number,
): Pier | null {
  const dx = Math.abs(dirX) >= Math.abs(dirZ) ? Math.sign(dirX) : 0;
  const dz = dx === 0 ? Math.sign(dirZ) || 1 : 0;
  let x = Math.floor(fromX), z = Math.floor(fromZ);
  let lastLandLevel = 1;
  for (let i = 0; i < PIER_WALK_MAX; i++) {
    sampler.sampleTile(x, z, sample);
    const land = sample.type !== TileType.Skip && sample.type !== TileType.Seabed;
    if (!land) {
      if (i === 0) return null;
      const tiles: Array<[number, number]> = [];
      for (let k = 0; k < PIER_LENGTH; k++) tiles.push([x + dx * k, z + dz * k]);
      return { island, side, tiles, dx, dz, level: lastLandLevel, dockX: x + dx * PIER_LENGTH, dockZ: z + dz * PIER_LENGTH };
    }
    if (sample.type !== TileType.Water && sample.type !== TileType.Bridge) lastLandLevel = Math.max(1, Math.round(sample.level));
    x += dx; z += dz;
  }
  return null;
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

