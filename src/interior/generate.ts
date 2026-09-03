import { mulberry32, type Rng } from '../core/rng';
import { SALT } from '../core/salts';
import { PropKind } from '../world/biomes';
import type { ShopType } from '../world/structures';

/**
 * A building's inside: a walled room laid out from the building's own seed, so the same house
 * always has the same furniture in the same corners. Interiors are their own little worlds,
 * larger than the shell outside, the way they always are in games of this kind.
 */
export type InteriorKind = 'house' | 'church' | ShopType;

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
};

const TITLES: Record<InteriorKind, string> = {
  house: 'Cottage', store: 'General Store', smith: 'Forge', inn: 'Inn', apothecary: 'Apothecary', church: 'Chapel',
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
  const put = (pkind: PropKind, x: number, z: number, rot = 0) => {
    if (x < 1 || z < 1 || x > w - 2 || z > h - 2) return;
    furniture.push({ kind: pkind, x, z, rot });
  };
  let keeper: [number, number] | null = null;

  /** Lay a counter across the room and stand the keeper directly behind its middle. */
  const layCounter = (z: number, from: number, to: number): [number, number] => {
    for (let x = from; x <= to; x++) tiles[at(x, z)] = ITile.Counter;
    return [Math.floor((from + to) / 2), z - 1];
  };

  switch (kind) {
    case 'house': {
      put(PropKind.Bed, 2, 2, rng() < 0.5 ? 0 : Math.PI / 2);
      put(PropKind.Table, w - 4, 3);
      put(PropKind.Chair, w - 5, 3, Math.PI / 2);
      put(PropKind.Chair, w - 3, 3, -Math.PI / 2);
      put(PropKind.Hearth, Math.floor(w / 2), 1);
      put(PropKind.Shelf, 1, h - 3);
      put(PropKind.Barrel, w - 2, h - 3);
      if (rng() < 0.5) put(PropKind.Rug, doorX, h - 4);
      break;
    }
    case 'store': {
      keeper = layCounter(3, 2, w - 3);
      put(PropKind.Shelf, 1, 1);
      put(PropKind.Shelf, 2, 1);
      put(PropKind.Shelf, w - 2, 1);
      put(PropKind.Crate, 2, h - 3);
      put(PropKind.Crate, 3, h - 4);
      put(PropKind.Barrel, w - 3, h - 3);
      put(PropKind.Barrel, w - 2, h - 4);
      break;
    }
    case 'smith': {
      keeper = layCounter(4, 2, w - 4);
      put(PropKind.Forge, 2, 1);
      put(PropKind.Anvil, w - 4, 2);
      put(PropKind.Barrel, w - 2, 2);
      put(PropKind.Crate, 1, h - 3);
      put(PropKind.WeaponRack, w - 2, h - 4, -Math.PI / 2);
      break;
    }
    case 'inn': {
      keeper = layCounter(3, 2, Math.floor(w / 2) + 1);
      put(PropKind.Barrel, 1, 1);
      put(PropKind.Barrel, 2, 1);
      put(PropKind.Hearth, w - 2, 2);
      for (const [tx, tz] of [[3, h - 4], [w - 4, h - 4], [w - 4, h - 7]] as const) {
        put(PropKind.Table, tx, tz);
        put(PropKind.Chair, tx - 1, tz, Math.PI / 2);
        put(PropKind.Chair, tx + 1, tz, -Math.PI / 2);
      }
      put(PropKind.Bed, 1, h - 3);
      break;
    }
    case 'apothecary': {
      keeper = layCounter(3, 2, w - 4);
      put(PropKind.Shelf, 1, 1);
      put(PropKind.Shelf, w - 2, 1);
      put(PropKind.Cauldron, w - 3, h - 3);
      put(PropKind.Crate, 2, h - 3);
      put(PropKind.Shelf, 1, h - 4);
      break;
    }
    case 'church': {
      put(PropKind.Altar, Math.floor(w / 2), 2);
      keeper = [Math.floor(w / 2), 3];
      const aisle = Math.floor(w / 2);
      for (let z = 5; z < h - 2; z += 2) {
        put(PropKind.Pew, aisle - 2, z, Math.PI / 2);
        put(PropKind.Pew, aisle + 2, z, Math.PI / 2);
      }
      for (let z = 4; z < h - 1; z++) tiles[at(aisle, z)] = ITile.Rug;
      put(PropKind.Candle, aisle - 3, 2);
      put(PropKind.Candle, aisle + 3, 2);
      break;
    }
  }

  return { kind, w, h, tiles, door, entry, furniture, keeper, name };
}

/** Furniture and counters block the way; floor, rug and the doorway do not. */
export function blocksAt(map: InteriorMap, x: number, z: number): boolean {
  const tx = Math.floor(x), tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= map.w || tz >= map.h) return true;
  const t = map.tiles[tz * map.w + tx] as ITile;
  if (t === ITile.Wall || t === ITile.Counter) return true;
  return map.furniture.some((f) => f.x === tx && f.z === tz && FURNITURE_BLOCKS.has(f.kind));
}

const FURNITURE_BLOCKS = new Set<PropKind>([
  PropKind.Bed, PropKind.Table, PropKind.Hearth, PropKind.Shelf, PropKind.Barrel, PropKind.Crate,
  PropKind.Forge, PropKind.Anvil, PropKind.WeaponRack, PropKind.Cauldron, PropKind.Altar, PropKind.Pew,
]);

/** Deterministic seed for one building from its position, so its inside never changes. */
export function interiorSeed(worldSeed: number, tx: number, tz: number): number {
  let h = (worldSeed ^ SALT.INTERIOR) >>> 0;
  h = Math.imul(h ^ tx, 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ tz, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
