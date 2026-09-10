import { mulberry32, type Rng } from '../core/rng';
import { SALT } from '../core/salts';
import { PropKind } from '../world/biomes';
import type { ShopType } from '../world/structures';
import { Solids, boxesFrom, type Body } from '../world/solids';
import { FURNITURE_BLOCKS, blocking, type Footprints } from '../world/footprints';

/**
 * A building's inside: a walled room laid out from the building's own seed, so the same house
 * always has the same furniture in the same corners. Interiors are their own little worlds,
 * larger than the shell outside, the way they always are in games of this kind.
 */
export type InteriorKind = 'house' | 'church' | 'townhall' | 'watchhouse' | ShopType;

export const enum ITile { Wall = 0, Floor = 1, Door = 2, Counter = 3, Rug = 4 }

export interface Furniture {
  kind: PropKind;
  x: number;
  z: number;
  rot: number;
}

export interface InteriorMap {
  kind: InteriorKind;
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Doorway tile: where you come in and where you leave. */
  door: [number, number];
  /** Where the hero stands on arrival, just inside. */
  entry: [number, number];
  furniture: Furniture[];
  /** Where the shopkeeper or priest stands, if this building has one. */
  keeper: [number, number] | null;
  name: string;
}

const SIZES: Record<InteriorKind, [number, number]> = {
  house: [11, 9],
  store: [13, 10],
  smith: [13, 11],
  inn: [15, 11],
  apothecary: [12, 10],
  church: [13, 15],
  // wide, because the counter has to cross it and still leave the village room to stand at it
  townhall: [15, 12],
  // and small, because the room you are held in should not be a hall
  watchhouse: [13, 11],
};

const TITLES: Record<InteriorKind, string> = {
  house: 'Cottage', store: 'General Store', smith: 'Forge', inn: 'Inn', apothecary: 'Apothecary', church: 'Chapel',
  townhall: 'Town Hall', watchhouse: 'Watch House',
};

export function interiorTitle(kind: InteriorKind, village: string): string {
  return kind === 'house' ? `A ${TITLES.house.toLowerCase()} in ${village}` : `${TITLES[kind]}, ${village}`;
}

export function generateInterior(seed: number, kind: InteriorKind, name: string): InteriorMap {
  const rng = mulberry32(seed);
  const [w, h] = SIZES[kind];
  const tiles = new Uint8Array(w * h);
  const at = (x: number, z: number) => z * w + x;
  for (let z = 1; z < h - 1; z++) for (let x = 1; x < w - 1; x++) tiles[at(x, z)] = ITile.Floor;

  // the door is always in the middle of the south wall, so leaving is never a hunt
  const doorX = Math.floor(w / 2);
  const door: [number, number] = [doorX, h - 1];
  tiles[at(doorX, h - 1)] = ITile.Door;
  const entry: [number, number] = [doorX, h - 2];

  const furniture: Furniture[] = [];
  let keeper: [number, number] | null = null;
  const put = (pkind: PropKind, x: number, z: number, rot = 0) => {
    if (x < 1 || z < 1 || x > w - 2 || z > h - 2) return;
    furniture.push({ kind: pkind, x, z, rot });
  };
  /** Lay a counter across the room and stand the keeper directly behind its middle. */
  const layCounter = (z: number, from: number, to: number): [number, number] => {
    for (let x = from; x <= to; x++) tiles[at(x, z)] = ITile.Counter;
    return [Math.floor((from + to) / 2), z - 1];
  };

  const floor = (x: number, z: number, tile: ITile) => {
    if (x > 0 && z > 0 && x < w - 1 && z < h - 1) tiles[at(x, z)] = tile;
  };
  keeper = FURNISH[kind]({ w, h, rng, put, layCounter, doorX, floor });

  return { kind, w, h, tiles, door, entry, furniture, keeper, name };
}

/** Furniture and counters block the way; floor, rug and the doorway do not. */
/**
 * What stops you inside a building.
 *
 * The room itself is a grid and stays one: a wall is a whole tile and a counter is a whole tile.
 * The furniture is not, and pretending it was is what let you walk through half of every bed — a
 * bed is drawn 1.9 tiles long and blocked the one tile it stood on, so the foot of it was scenery.
 * So furniture is boxed the way everything outside is boxed, off the same measurements of the same
 * meshes, turned the way the piece is turned.
 */
export function blocksAt(map: InteriorMap, x: number, z: number, furniture?: Solids, body?: Body): boolean {
  const tx = Math.floor(x), tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= map.w || tz >= map.h) return true;
  const t = map.tiles[tz * map.w + tx] as ITile;
  if (t === ITile.Wall || t === ITile.Counter) return true;
  if (furniture) return furniture.at(x, z, body);
  // without the measured boxes to hand this is the old tile answer, which is better than none
  return map.furniture.some((f) => f.x === tx && f.z === tz && FURNITURE_BLOCKS.has(f.kind));
}

/** The furniture of a room as boxes, from the same measurements the world outside uses. */
export function furnitureBoxes(map: InteriorMap, footprints: Footprints): Solids {
  const stops = blocking(footprints, FURNITURE_BLOCKS);
  const solids = new Solids();
  solids.put('room', boxesFrom(
    map.furniture.map((f) => ({ kind: f.kind, x: f.x + 0.5, z: f.z + 0.5, rot: f.rot })),
    stops,
  ));
  return solids;
}

/** Deterministic seed for one building from its position, so its inside never changes. */
export function interiorSeed(worldSeed: number, tx: number, tz: number): number {
  let h = (worldSeed ^ SALT.INTERIOR) >>> 0;
  h = Math.imul(h ^ tx, 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ tz, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}


/** What each trade needs to lay out its room. */
interface Furnishing {
  w: number;
  h: number;
  rng: Rng;
  put: (kind: PropKind, x: number, z: number, rot?: number) => void;
  /** Paint a floor tile: a carpet down the aisle, say. */
  floor: (x: number, z: number, tile: ITile) => void;
  /** Lay a counter across the room; returns where the keeper stands behind it. */
  layCounter: (z: number, from: number, to: number) => [number, number];
  doorX: number;
}

/** One furnisher per kind of building. Each returns the keeper's spot, or null if nobody works here. */
const FURNISH: Record<InteriorKind, (f: Furnishing) => [number, number] | null> = {
  house: ({ w, h, rng, put, doorX }) => {
    put(PropKind.Bed, 2, 2, rng() < 0.5 ? 0 : Math.PI / 2);
    put(PropKind.Table, w - 4, 3);
    put(PropKind.Chair, w - 5, 3, Math.PI / 2);
    put(PropKind.Chair, w - 3, 3, -Math.PI / 2);
    put(PropKind.Hearth, Math.floor(w / 2), 1);
    put(PropKind.Shelf, 1, h - 3);
    put(PropKind.Barrel, w - 2, h - 3);
    if (rng() < 0.5) put(PropKind.Rug, doorX, h - 4);
    return null;
  },
  store: ({ w, h, put, layCounter }) => {
    const keeper = layCounter(3, 2, w - 3);
    put(PropKind.Shelf, 1, 1);
    put(PropKind.Shelf, 2, 1);
    put(PropKind.Shelf, w - 2, 1);
    put(PropKind.Crate, 2, h - 3);
    put(PropKind.Crate, 3, h - 4);
    put(PropKind.Barrel, w - 3, h - 3);
    put(PropKind.Barrel, w - 2, h - 4);
    return keeper;
  },
  smith: ({ w, h, put, layCounter }) => {
    const keeper = layCounter(4, 2, w - 4);
    put(PropKind.Forge, 2, 1);
    put(PropKind.Anvil, w - 4, 2);
    put(PropKind.Barrel, w - 2, 2);
    put(PropKind.Crate, 1, h - 3);
    put(PropKind.WeaponRack, w - 2, h - 4, -Math.PI / 2);
    return keeper;
  },
  inn: ({ w, h, put, layCounter }) => {
    const keeper = layCounter(3, 2, Math.floor(w / 2) + 1);
    put(PropKind.Barrel, 1, 1);
    put(PropKind.Barrel, 2, 1);
    put(PropKind.Hearth, w - 2, 2);
    for (const [tx, tz] of [[3, h - 4], [w - 4, h - 4], [w - 4, h - 7]] as const) {
      put(PropKind.Table, tx, tz);
      put(PropKind.Chair, tx - 1, tz, Math.PI / 2);
      put(PropKind.Chair, tx + 1, tz, -Math.PI / 2);
    }
    put(PropKind.Bed, 1, h - 3);
    return keeper;
  },
  apothecary: ({ w, h, put, layCounter }) => {
    const keeper = layCounter(3, 2, w - 4);
    put(PropKind.Shelf, 1, 1);
    put(PropKind.Shelf, w - 2, 1);
    put(PropKind.Cauldron, w - 3, h - 3);
    put(PropKind.Crate, 2, h - 3);
    put(PropKind.Shelf, 1, h - 4);
    return keeper;
  },
  /**
   * The town hall: a counter across the width of it, the ledgers on the wall behind, and the half
   * of the room the village stands in when it is called together.
   *
   * Laid out like a shop on purpose. Whatever the building is for, what happens in it is somebody
   * on one side of a counter asking somebody on the other side for something, and a room that said
   * otherwise would be a room you had to work out how to use.
   */
  townhall: ({ w, h, put, layCounter, floor, doorX }) => {
    const keeper = layCounter(4, 2, w - 3);
    // the ledgers, down both flanks behind the counter rather than along the back wall, where the
    // camera looks at them end-on and they might as well not be there
    for (const z of [1, 2]) {
      put(PropKind.Shelf, 1, z);
      put(PropKind.Shelf, w - 2, z);
    }
    put(PropKind.Hearth, Math.floor(w / 2), 1);
    put(PropKind.Candle, 2, 3);
    put(PropKind.Candle, w - 3, 3);
    for (const tx of [3, w - 4]) {
      put(PropKind.Table, tx, h - 5);
      put(PropKind.Chair, tx - 1, h - 5, Math.PI / 2);
      put(PropKind.Chair, tx + 1, h - 5, -Math.PI / 2);
    }
    // a strip of carpet from the door to the counter, which is the one thing in the room that says
    // the walk up to it is meant to feel like a walk up to it
    for (let z = 5; z < h - 1; z++) floor(doorX, z, ITile.Rug);
    return keeper;
  },
  /**
   * The watch house: a counter, and the cell taking the back corner of the same room.
   *
   * The cell is barred rather than walled because the room has to show what it is for. A wall
   * would have been a tile of the same colour as every other wall, and the building would have
   * been a shop with a weapon rack in it.
   */
  watchhouse: ({ w, h, put, layCounter, floor, doorX }) => {
    const keeper = layCounter(5, 2, w - 3);
    for (let z = 1; z <= 3; z++) put(PropKind.Bars, 5, z, Math.PI / 2);
    for (let x = 1; x <= 4; x++) put(PropKind.Bars, x, 4);
    put(PropKind.Bed, 2, 2, Math.PI / 2);
    put(PropKind.WeaponRack, w - 2, 1, -Math.PI / 2);
    put(PropKind.Barrel, w - 4, 1);
    put(PropKind.Crate, 1, h - 3);
    put(PropKind.Candle, w - 3, 4);
    floor(doorX, h - 3, ITile.Rug);
    return keeper;
  },
  church: ({ w, h, put, floor }) => {
    const aisle = Math.floor(w / 2);
    put(PropKind.Altar, aisle, 2);
    for (let z = 4; z < h - 1; z++) floor(aisle, z, ITile.Rug);
    for (let z = 5; z < h - 2; z += 2) {
      put(PropKind.Pew, aisle - 2, z, Math.PI / 2);
      put(PropKind.Pew, aisle + 2, z, Math.PI / 2);
    }
    put(PropKind.Candle, aisle - 3, 2);
    put(PropKind.Candle, aisle + 3, 2);
    return [aisle, 3];
  },
};
