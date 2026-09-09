import { footprintLevel } from './footprint';
import { GRAPH } from '../core/config';
import { markTheWay } from './landmarks';
import type { RoadNode } from './graph';
import { POI_NAMES, PREFIX, SUFFIX } from './names';
import { StructureKind } from './kinds';
import { KEEPS, PADDOCK, planPaddock, railsFor, type Stabling } from './paddock';

export type { Stabling } from './paddock';

export { StructureKind } from './kinds';
import { mulberry32, shuffle } from '../core/rng';
import { SALT, derive } from '../core/salts';
import type { Biome } from './biomes';
import type { TerrainSampler, TileSample } from './terrain';
import { TileType } from './terrain';

/**
 * Villages and points of interest. Houses are placed on flat land beside roads, get a door path
 * back to the road, and are rendered as instanced props. POIs sit off the road as things to find.
 */

/**
 * What to call a kind of place out loud.
 *
 * `StructureKind` is a const enum, so it has no names at runtime to reverse-map — and that is the
 * right trade for something read on every tile of every chunk. This is the small table for the few
 * places that are ever named to a person: the landmarks, not the houses.
 */
export function placeKindName(kind: StructureKind): string {
  switch (kind) {
    case StructureKind.Shrine: return 'shrine';
    case StructureKind.Ruins: return 'ruins';
    case StructureKind.Tower: return 'tower';
    case StructureKind.GiantTree: return 'giant tree';
    case StructureKind.Church: return 'church';
    case StructureKind.Campfire: return 'camp';
    case StructureKind.Well: return 'well';
    case StructureKind.Pier: return 'pier';
    default: return 'landmark';
  }
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
  /** The stable and its paddock, in the villages with the ground and the people to keep one. */
  stable: Stabling | null;
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
const POIS = 28;
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

/** A place's name as a number, so the village standing on it can be drawn from it. */
function hashOfPlace(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** How many of a village's houses are shops: two, plus one each at six and eight houses. */
function shopCount(houses: number): number {
  return Math.min(houses - 1, 2 + (houses >= 6 ? 1 : 0) + (houses >= 8 ? 1 : 0));
}

/** Snap an angle to the nearest quarter turn and return it with its unit step. */
function facing(angle: number): { rot: number; fx: number; fz: number } {
  const rot = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  return { rot, fx: Math.round(Math.cos(rot)), fz: Math.round(Math.sin(rot)) };
}


/**
 * Could a village stand on this node? A wide, deep branch, a good way out from the middle.
 *
 * Asked of the graph because the terrain needs the answer before the villages exist: a road is
 * drawn leaning off its surveyed line, and must not where houses will be set out against that line.
 */
export function couldHoldAVillage(node: RoadNode): boolean {
  return node.depth >= 3 && node.size >= 10 && Math.hypot(node.x, node.z) > GRAPH.HUB_RADIUS * 1.6;
}

/**
 * Where a village stands, when it is not the road tree that says so.
 *
 * A place with a name of its own. That name is what makes a village a function of itself rather
 * than of everything founded before it: it names the village, and it seeds the randomness the
 * layout is drawn from, so the same town builds the same village whether it is the first of a
 * hundred or the only one anybody asked about.
 */
export interface Founding {
  id: string;
  name: string;
  x: number;
  z: number;
  level: number;
  /** How much village: a market town, an ordinary one, or a few cottages. */
  size: 'hub' | 'town' | 'village';
}

/**
 * How a world's settlements are founded, when the default will not do.
 *
 * The default is the road tree: villages at the towns it grew, laid out from one stream of
 * randomness in the order the tree is walked, with a fixed number of them in the world and no two
 * sharing a name. Every one of those is an answer about a whole world, and an endless one cannot
 * give any of them — so it hands over its own list instead, and asks that each village be drawn
 * from its own name.
 */
export interface Settling {
  /** The places to build. Given these, nothing is founded from the road tree at all. */
  towns: Founding[];
}

export function generateStructures(sampler: TerrainSampler, settling?: Settling): Structures {
  const graph = sampler.graph;
  /**
   * The randomness a village is laid out from.
   *
   * One stream for the whole world when the road tree founds them, which is what it has always
   * been and what every existing world's houses stand on. One stream per place when a list is
   * handed in, so that a village is a function of its own name and of nothing else — which is the
   * only version of this an endless world can have.
   */
  let rng = mulberry32(derive(graph.seed, SALT.STRUCTURES));
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

  /**
   * What each country's stables keep. A village keeps what the country round it rides, which is why
   * you go to the desert for a camel rather than shopping for one at home.
   */
  /**
   * A stable: a house with a paddock fenced off beside it. `paddock.ts` finds the ground.
   *
   * Laid last of everything in a village, so the yard has to fit round what is already standing
   * rather than the other way about — and the sign only goes up once somewhere has been found,
   * because a sign is a thing that exists and hanging one for a stable that would not fit leaves a
   * board over a doorway with nothing behind it.
   */
  const assignStable = (houses: Structure[], biome: Biome): Stabling | null => {
    if (houses.length < PADDOCK.HOUSES) return null;
    const house = houses[shopCount(houses.length) + 2];
    if (!house) return null;
    const plan = planPaddock({ house, seed: graph.seed, all, sampler, sample, plaza: { x: plazaX, z: plazaZ, r: plazaR } });
    if (!plan) return null;
    const [doorX, doorZ] = signedDoor(house, biome);
    all.push(...railsFor(plan, biome));
    return { house, doorX, doorZ, x: plan.x, z: plan.z, half: plan.half, gate: plan.gate, stock: KEEPS[biome] };
  };

  const buildVillage = (n: { x: number; z: number; level: number }, spread: number, maxHouses: number, minHouses: number, squareR: number): Village | null => {
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
    // last, so that the paddock has to fit round everything else rather than the other way about
    const stable = assignStable(houses, biome);
    plazaR = 0;
    return { name: villageName(), x: n.x, z: n.z, radius: spread + 8, level, biome, houses, shops, pub, station, stable, church, churchDoor, board, stalls };
  };

  if (settling) {
    /*
     * Villages founded from a list, each drawn from its own name.
     *
     * No hub, because an endless world has no middle to put one in; no cap, because a cap is a
     * fact about a whole world; no spacing against what was built already, because that is the
     * order dependence this exists to end — the places handed in were kept apart before they got
     * here, by a rule that does not care what else exists.
     *
     * `all` is not cleared between them and does not need to be: the only thing that reads it is
     * the check that two buildings do not stand on each other, and two villages far enough apart
     * to be two villages cannot.
     */
    for (const town of settling.towns) {
      rng = mulberry32(derive(graph.seed, SALT.STRUCTURES ^ hashOfPlace(town.id)));
      const shape = town.size === 'hub' ? LAYOUT.HUB : town.size === 'town' ? LAYOUT.TOWN : LAYOUT.VILLAGE;
      const v = buildVillage(town, shape.spread, shape.maxHouses, shape.minHouses, shape.squareR);
      if (!v) continue;
      v.name = town.name;
      villages.push(v);
    }
  } else {
    // --- hub town ---
    const hub = buildVillage(graph.nodes[0], LAYOUT.HUB.spread, LAYOUT.HUB.maxHouses, LAYOUT.HUB.minHouses, LAYOUT.HUB.squareR);
    if (hub) { hub.name = 'Crossroads Town'; villages.push(hub); }

    // --- towns: the secondary hubs the road graph grew webs around ---
    for (const t of graph.towns) {
      const n = graph.nodes[t];
      if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < LAYOUT.TOWN_SPACING)) continue;
      const v = buildVillage(n, LAYOUT.TOWN.spread, LAYOUT.TOWN.maxHouses, LAYOUT.TOWN.minHouses, LAYOUT.TOWN.squareR);
      if (v) villages.push(v);
    }

    // --- smaller villages on wide, deep branches ---
    const sites = graph.nodes.map((n, i) => ({ n, i })).filter(({ n }) => couldHoldAVillage(n));
    shuffle(rng, sites);
    for (const { n } of sites) {
      if (villages.length >= VILLAGES + 1) break;
      if (villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < LAYOUT.VILLAGE_SPACING)) continue;
      const v = buildVillage(n, LAYOUT.VILLAGE.spread, LAYOUT.VILLAGE.maxHouses, LAYOUT.VILLAGE.minHouses, LAYOUT.VILLAGE.squareR);
      if (v) villages.push(v);
    }
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

  /*
   * The things that stand between the villages: jetties, signposts, caves and wrecks.
   *
   * Not yet in a world that was handed its own list of places. All four are laid out by walking the
   * road tree's nodes in a shuffled order — a signpost at every third junction until there are
   * twenty-two of them, a cave in the first cliff a deep node finds — and both the count and the
   * order are facts about a whole world. Two patches of an endless one put their signposts in
   * different places, which is a signpost that exists depending on where you came from.
   *
   * They are their own piece of work, and each has a local shape waiting for it: a signpost knows
   * the villages within a day's walk, a cave belongs to the cliff it is in.
   */
  const between = settling ? { piers: [], signposts: [], caves: [], wrecks: [] } : markTheWay({
    sampler, graph, sample, rng, all, villages, footprintOk,
  });
  piers.push(...between.piers);
  signposts.push(...between.signposts);
  caves.push(...between.caves);
  wrecks.push(...between.wrecks);

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


const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
export function compassDir(dx: number, dz: number): string {
  return COMPASS[Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) & 7];
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

