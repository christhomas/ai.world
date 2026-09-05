import { mulberry32, type Rng } from '../core/rng';

/**
 * Dungeon layout from one seed: rooms scattered on a grid, joined by L-shaped corridors in
 * nearest-first order so the whole thing is connected, stairs in the first room, the big chest in
 * the room farthest from the stairs, torches along the walls, a pool or two.
 */
export const enum DTile { Rock = 0, Floor = 1, Water = 2, Stairs = 3, Door = 4, Descent = 5 }

export interface Room { x: number; z: number; w: number; h: number }
export interface Chest { x: number; z: number; big: boolean; key?: boolean }
export interface Door { x: number; z: number }
export interface Torch { x: number; z: number; /** yaw so the bracket faces into the room */ rot: number }

/** How deep a vault goes, and what waits at the bottom. */
export const DEPTH = {
  FLOORS: 3,
  /** Monsters per room rise with depth. */
  EXTRA_PACKS_PER_FLOOR: 1,
} as const;

export interface DungeonMap {
  size: number;
  tiles: Uint8Array;
  rooms: Room[];
  entrance: [number, number];
  chests: Chest[];
  torches: Torch[];
  /** Locked doors sealing the treasure room; opened by the key chest's key. */
  doors: Door[];
  /** Room centres where monsters wait. */
  monsterSpots: Array<[number, number]>;
  /** Which floor this is, counting from one at the entrance. */
  floor: number;
  /** Stairs further down, on every floor but the last. */
  descent: [number, number] | null;
  /** The boss stands here on the final floor. */
  boss: [number, number] | null;
}

export const DUNGEON = {
  SIZE: 56,
  ROOM_ATTEMPTS: 60,
  ROOMS_MAX: 12,
  ROOM_MIN: 4,
  ROOM_MAX: 9,
  MARGIN: 2,             // rock kept between rooms and the map edge
  WIDE_CORRIDOR_CHANCE: 0.3,
  SMALL_CHEST_CHANCE: 0.45,
  POOLS: 2,
  TORCH_SPACING: 4,
  PILLAR_ROOM_SIZE: 7,   // rooms at least this big on both sides get four pillars
  MONSTER_ROOM_CHANCE: 0.75,
  CAVE_ROOM_MAX: 6,
  CAVE_ROOMS_MAX: 16,
} as const;

/** Shrine vaults are roomy and locked; caves are cramped, winding and open. */
/**
 * What kind of hole this is.
 *
 * A vault was built and has rooms and corridors; a cave and a thicket both grew, so they share
 * their layout entirely. What separates a thicket is only where you find it and what it is made
 * of: you walk into it through a gap under a great tree rather than down a hole, and it is wood
 * rather than rock all the way through.
 */
export type DungeonStyle = 'vault' | 'cave' | 'thicket';

export function generateDungeon(seed: number, style: DungeonStyle = 'vault', floor = 1): DungeonMap {
  const rng = mulberry32(seed + floor * 7919);
  const cave = style !== 'vault';
  const size = DUNGEON.SIZE;
  const tiles = new Uint8Array(size * size); // Rock
  const idx = (x: number, z: number) => z * size + x;
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;

  const rooms = placeRooms(rng, cave);
  for (const r of rooms) carve(tiles, size, r);

  // connect each room to the nearest already-connected one
  const connected = [rooms[0]];
  const pending = rooms.slice(1);
  while (pending.length) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < pending.length; i++) {
      for (let j = 0; j < connected.length; j++) {
        const d = Math.hypot(centre(pending[i])[0] - centre(connected[j])[0], centre(pending[i])[1] - centre(connected[j])[1]);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    const from = centre(connected[bj]), to = centre(pending[bi]);
    corridor(tiles, size, from, to, !cave && rng() < DUNGEON.WIDE_CORRIDOR_CHANCE, rng() < 0.5);
    connected.push(pending.splice(bi, 1)[0]);
  }

  // pillars in big rooms
  for (const r of rooms) {
    if (r.w >= DUNGEON.PILLAR_ROOM_SIZE && r.h >= DUNGEON.PILLAR_ROOM_SIZE) {
      for (const [px, pz] of [[r.x + 1, r.z + 1], [r.x + r.w - 2, r.z + 1], [r.x + 1, r.z + r.h - 2], [r.x + r.w - 2, r.z + r.h - 2]]) tiles[idx(px, pz)] = DTile.Rock;
    }
  }

  const entrance = centre(rooms[0]);
  tiles[idx(entrance[0], entrance[1])] = DTile.Stairs;

  // treasure: the room farthest from the stairs
  let far = rooms[0], farD = -1;
  for (const r of rooms) {
    const d = Math.hypot(centre(r)[0] - entrance[0], centre(r)[1] - entrance[1]);
    if (d > farD) { farD = d; far = r; }
  }
  const chests: Chest[] = [{ x: centre(far)[0], z: centre(far)[1], big: true }];
  // vaults seal the treasure room behind locked doors; caves are open all through
  const doors: Door[] = cave ? [] : doorwaysOf(tiles, size, far);
  for (const d of doors) tiles[idx(d.x, d.z)] = DTile.Door;
  const pools: Room[] = [];
  for (const r of rooms) {
    if (r === rooms[0] || r === far) continue;
    if (pools.length < DUNGEON.POOLS && r.w >= 5 && r.h >= 5 && rng() < 0.5) { pools.push(r); continue; }
    if (rng() < DUNGEON.SMALL_CHEST_CHANCE) {
      const cx = r.x + 1 + Math.floor(rng() * (r.w - 2)), cz = r.z + 1 + Math.floor(rng() * (r.h - 2));
      if (tiles[idx(cx, cz)] === DTile.Floor) chests.push({ x: cx, z: cz, big: false });
    }
  }
  for (const r of pools) {
    const [cx, cz] = centre(r);
    const rx = (r.w - 2) / 2, rz = (r.h - 2) / 2;
    for (let z = r.z + 1; z < r.z + r.h - 1; z++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      const nx = (x + 0.5 - (cx + 0.5)) / rx, nz = (z + 0.5 - (cz + 0.5)) / rz;
      if (nx * nx + nz * nz < 0.6 && tiles[idx(x, z)] === DTile.Floor) tiles[idx(x, z)] = DTile.Water;
    }
  }

  // torches on wall tiles that face room floor, spaced along each wall
  const torches: Torch[] = [];
  for (const r of rooms) {
    for (let x = r.x; x < r.x + r.w; x += DUNGEON.TORCH_SPACING) {
      if (inside(x, r.z - 1) && tiles[idx(x, r.z - 1)] === DTile.Rock) torches.push({ x, z: r.z - 1, rot: -Math.PI / 2 });
      if (inside(x, r.z + r.h) && tiles[idx(x, r.z + r.h)] === DTile.Rock) torches.push({ x, z: r.z + r.h, rot: Math.PI / 2 });
    }
    for (let z = r.z + 2; z < r.z + r.h; z += DUNGEON.TORCH_SPACING) {
      if (inside(r.x - 1, z) && tiles[idx(r.x - 1, z)] === DTile.Rock) torches.push({ x: r.x - 1, z, rot: 0 });
      if (inside(r.x + r.w, z) && tiles[idx(r.x + r.w, z)] === DTile.Rock) torches.push({ x: r.x + r.w, z, rot: Math.PI });
    }
  }

  // one small chest away from the stairs holds the key; if there are none, put a key chest in
  if (doors.length > 0) {
    const small = chests.filter((c) => !c.big);
    let keyChest = small[small.length - 1];
    if (!keyChest) {
      const mid = rooms.find((r) => r !== rooms[0] && r !== far);
      if (mid) { keyChest = { x: centre(mid)[0], z: centre(mid)[1], big: false }; chests.push(keyChest); }
    }
    if (keyChest) keyChest.key = true;
    else for (const d of doors) tiles[idx(d.x, d.z)] = DTile.Floor; // no way to hold a key: unlock
  }

  // monsters in every room except the one you arrive in
  const monsterSpots: Array<[number, number]> = [];
  for (const r of rooms) {
    if (r === rooms[0]) continue;
    if (rng() < DUNGEON.MONSTER_ROOM_CHANCE) monsterSpots.push(centre(r));
    // deeper floors are busier
    for (let extra = 1; extra < floor; extra++) {
      if (rng() < DUNGEON.MONSTER_ROOM_CHANCE * 0.6) monsterSpots.push([centre(r)[0] + 1, centre(r)[1] + 1]);
    }
  }

  // the way down sits in the treasure room; the last floor has a boss instead
  const deepest = style === 'vault' ? DEPTH.FLOORS : 1;
  const isLast = floor >= deepest;
  const descent: [number, number] | null = isLast ? null : [centre(far)[0] + 1, centre(far)[1]];
  if (descent && tiles[idx(descent[0], descent[1])] === DTile.Floor) tiles[idx(descent[0], descent[1])] = DTile.Descent;
  const boss: [number, number] | null = isLast && style === 'vault' ? [centre(far)[0] - 1, centre(far)[1]] : null;

  return {
    size, tiles, rooms, entrance, chests, torches,
    doors: doors.filter((d) => tiles[idx(d.x, d.z)] === DTile.Door),
    monsterSpots, floor, descent, boss,
  };
}

/** Floor tiles on the room's boundary ring that lead out of it: the corridor mouths. */
function doorwaysOf(tiles: Uint8Array, size: number, r: Room): Door[] {
  const out: Door[] = [];
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= size || z >= size ? DTile.Rock : (tiles[z * size + x] as DTile));
  for (let x = r.x; x < r.x + r.w; x++) {
    if (at(x, r.z - 1) === DTile.Floor) out.push({ x, z: r.z - 1 });
    if (at(x, r.z + r.h) === DTile.Floor) out.push({ x, z: r.z + r.h });
  }
  for (let z = r.z; z < r.z + r.h; z++) {
    if (at(r.x - 1, z) === DTile.Floor) out.push({ x: r.x - 1, z });
    if (at(r.x + r.w, z) === DTile.Floor) out.push({ x: r.x + r.w, z });
  }
  return out;
}

function placeRooms(rng: Rng, cave: boolean): Room[] {
  const size = DUNGEON.SIZE, m = DUNGEON.MARGIN;
  const rooms: Room[] = [];
  const maxSide = cave ? DUNGEON.CAVE_ROOM_MAX : DUNGEON.ROOM_MAX;
  const maxRooms = cave ? DUNGEON.CAVE_ROOMS_MAX : DUNGEON.ROOMS_MAX;
  for (let attempt = 0; attempt < DUNGEON.ROOM_ATTEMPTS && rooms.length < maxRooms; attempt++) {
    const w = DUNGEON.ROOM_MIN + Math.floor(rng() * (maxSide - DUNGEON.ROOM_MIN + 1));
    const h = DUNGEON.ROOM_MIN + Math.floor(rng() * (maxSide - DUNGEON.ROOM_MIN + 1));
    const x = m + Math.floor(rng() * (size - w - 2 * m));
    const z = m + Math.floor(rng() * (size - h - 2 * m));
    const r = { x, z, w, h };
    if (rooms.some((o) => x < o.x + o.w + m && x + w + m > o.x && z < o.z + o.h + m && z + h + m > o.z)) continue;
    rooms.push(r);
  }
  return rooms;
}

function carve(tiles: Uint8Array, size: number, r: Room): void {
  for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) tiles[z * size + x] = DTile.Floor;
}

function centre(r: Room): [number, number] {
  return [r.x + Math.floor(r.w / 2), r.z + Math.floor(r.h / 2)];
}

/** L-shaped corridor, horizontal-first or vertical-first, one or two tiles wide. Only carves rock. */
function corridor(tiles: Uint8Array, size: number, from: [number, number], to: [number, number], wide: boolean, horizontalFirst: boolean): void {
  const dig = (x: number, z: number) => {
    for (let k = 0; k < (wide ? 2 : 1); k++) {
      const xx = x, zz = z + k;
      if (xx >= 1 && zz >= 1 && xx < size - 1 && zz < size - 1 && tiles[zz * size + xx] === DTile.Rock) tiles[zz * size + xx] = DTile.Floor;
    }
  };
  const [x0, z0] = from, [x1, z1] = to;
  if (horizontalFirst) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) dig(x, z0);
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) dig(x1, z);
  } else {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) dig(x0, z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) dig(x, z1);
  }
}

/** Flood fill from the stairs; true if every floor/water/stairs tile is reachable (used by tests). */
export function fullyConnected(map: DungeonMap): boolean {
  const { size, tiles } = map;
  const seen = new Uint8Array(size * size);
  const stack: number[] = [map.entrance[1] * size + map.entrance[0]];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % size, z = Math.floor(i / size);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const j = nz * size + nx;
      if (seen[j] || tiles[j] === DTile.Rock) continue;   // doors count as passable: the key is always reachable first
      seen[j] = 1; stack.push(j);
    }
  }
  for (let i = 0; i < tiles.length; i++) if (tiles[i] !== DTile.Rock && !seen[i]) return false;
  return true;
}
