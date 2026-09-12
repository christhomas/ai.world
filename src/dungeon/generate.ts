import { mulberry32, type Rng } from '../core/rng';
import { generateCastle } from './castle';
import { DTile, type DungeonMap, type Chest, type Door, type Room, type Torch } from './map';

/**
 * Dungeon layout from one seed: rooms scattered on a grid, joined by L-shaped corridors in
 * nearest-first order so the whole thing is connected, stairs in the first room, the big chest in
 * the room farthest from the stairs, torches along the walls, a pool or two.
 *
 * One kind of floor gets more than that. A wreck's compartments are built rather than dug, so they
 * are bigger, and the one the salvage is in is flooded round it — see `floodTheHold` below, which
 * is the only place in this file that puts a room together rather than scattering things in one.
 *
 * What a floor *is* now lives in `map.ts`, and is re-exported here because half the game imports
 * these names from this file and a rename that changes nothing is churn other people have to read.
 */
export { DTile, fullyConnected } from './map';
export type { Chest, Door, DungeonMap, Furnishing, Levels, Room, Torch } from './map';
export type { SpawnSpot } from '../entities/spawns';

/** How deep a vault goes, and what waits at the bottom. */
export const DEPTH = {
  FLOORS: 3,
  /** Monsters per room rise with depth. */
  EXTRA_PACKS_PER_FLOOR: 1,
} as const;

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
  /**
   * How big a compartment below the waterline is, which is much bigger than anything else here.
   *
   * A cave is cramped because it was never meant for anybody; a hold is not, because it was built
   * to put cargo in. But the size is arithmetic rather than atmosphere, and the arithmetic is
   * `floodTheHold` below: three tiles of decking in the middle with the strongbox on it, and a
   * band of water either side wide enough that a crate-top out in it can have water on all four
   * sides. Three and three and three is nine, and two more for the dry walk round the wall makes
   * eleven — so a hold eleven tiles across is the smallest one where a false stone can float free
   * of everything, and a room where none can is a crossing with only one line drawn on it.
   *
   * Fixing it here rather than testing for it afterwards is what makes the puzzle always exist
   * rather than usually: every compartment in a wreck is big enough, so whichever one the salvage
   * lands in is one that can be flooded properly.
   */
  HOLD_ROOM_MIN: 11,
  HOLD_ROOM_MAX: 13,
  /**
   * How much of a flooded compartment is crate-tops that turn out not to bear your weight.
   *
   * Low on purpose. These are the wrong answers, and a room with more wrong answers than water is
   * not a harder crossing, it is a confusing one — what the player is meant to see from above is a
   * line that goes somewhere and some things that do not.
   */
  FALSE_STONE_CHANCE: 0.16,
} as const;

/** Shrine vaults are roomy and locked; caves are cramped, winding and open. */
/**
 * What kind of hole this is.
 *
 * A vault was built and has rooms and corridors; a cave and a thicket both grew, so they share
 * their layout entirely. What separates a thicket is only where you find it and what it is made
 * of: you walk into it through a gap under a great tree rather than down a hole, and it is wood
 * rather than rock all the way through.
 *
 * A castle is the odd one and does not come out of this function at all. The other three are one
 * algorithm with the numbers turned up or down, and a keep is not: it is rooms that share walls,
 * galleries that go somewhere, towers on the corners and a floor that is not all one height. That
 * is a different program, and it lives in `castle.ts`. What it is *not* is a different kind of
 * place — it comes back as the same `DungeonMap`, and is walked, drawn and mapped by the same
 * three files as everything else down here.
 */
/** The five kinds of floor there are. One list, because two lists of these would disagree. */
export const DUNGEON_STYLES = ['vault', 'cave', 'thicket', 'castle', 'sunken'] as const;

export type DungeonStyle = (typeof DUNGEON_STYLES)[number];

/**
 * A style out of whatever came over the wire, or a stated fallback.
 *
 * Here rather than in the server because it is the generator that decides what a style *is*, and
 * the day a sixth one is added is the day a hand-written list of five in `sim.ts` stops matching
 * it. A world that grows a floor in a style the page did not ask for is monsters inside walls, and
 * nothing about that failure points at a list of strings.
 */
export function asDungeonStyle(said: unknown, fallback: DungeonStyle): DungeonStyle {
  return DUNGEON_STYLES.includes(said as DungeonStyle) ? said as DungeonStyle : fallback;
}

export function generateDungeon(seed: number, style: DungeonStyle = 'vault', floor = 1): DungeonMap {
  if (style === 'castle') return generateCastle(seed, floor);
  const rng = mulberry32(seed + floor * 7919);
  const cave = style !== 'vault';
  const size = DUNGEON.SIZE;
  const tiles = new Uint8Array(size * size); // Rock
  const idx = (x: number, z: number) => z * size + x;
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;

  const rooms = placeRooms(rng, style);
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
    /*
     * A drowned cavern is worth the swim, which is the whole of why anybody would sail into a
     * whirlpool on purpose.
     *
     * The way in costs half your hearts at least, and there is no way to know beforehand whether it
     * will cost all of them — so the thing on the other side has to be worth the gamble or the
     * gamble is simply a mistake with scenery. Twice the small chests of anywhere else.
     */
    if (rng() < DUNGEON.SMALL_CHEST_CHANCE * (style === 'sunken' ? 2 : 1)) {
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

  /*
   * And in a wreck, the hold itself, which is the one room down there worth thinking about.
   *
   * Everything else on a flooded floor is a fight: the drowned roster comes at you and you either
   * have the hearts for it or you do not. That is a reason to be afraid of the place and it is not
   * a reason to go into it, and a room whose only question is how fast you can press a key is a
   * room you swim through rather than one you read.
   *
   * So the salvage sits in the water. It is the last thing in this file that draws from the seeded
   * stream, and it draws only here — a wreck is the newest kind of floor and has nothing to keep
   * faith with, where a vault, a cave and a thicket are pinned tile for tile by `golden.test.ts`
   * and would move under anybody who took a number out of turn.
   */
  if (style === 'sunken') {
    for (const chest of chests) chest.salvage = true;
    // the island is struck round the middle of the hold, which is where the big chest already
    // stands — taking the tile back from the flooding rather than assuming it is how the two are
    // kept together if either ever moves, and a strongbox under water is a strongbox nobody opens
    const island = floodTheHold(tiles, size, rng, far);
    if (island) [chests[0].x, chests[0].z] = island;
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
    // A hole in the ground is cut at one depth and is furnished by whatever `DungeonWorld` decides
    // to stand in it. Both of these are the castle's, and saying so costs an empty array rather
    // than a branch in everything that reads a floor.
    levels: null, furniture: [],
  };
}

/**
 * Flood the hold, leaving the salvage on an island of decking and one way over to it.
 *
 * This is the castle's drowned undercroft — `castle.ts`, the second of the three puzzles there —
 * said again for a generator that has no `Plan` to say it with. It is the same room and it is the
 * same argument, which is worth restating because it is the only argument this game makes about
 * what a puzzle underground may be: there is no hint system here and there is not going to be one,
 * so a room has to say what it wants by being looked at. That rules out anything remembered and
 * leaves the one thing this camera always shows you, which is where the floor is.
 *
 * Four steps, and the order of them is the load-bearing part.
 *
 *  1. Only the inside of the room is flooded, so a dry walk runs round the wall. Every doorway
 *     still reaches every other doorway without getting wet, which keeps a hold you are only
 *     passing through from being a hold you have to solve.
 *  2. The route is laid before the water is poured, never carved out of it afterwards. A route cut
 *     back out of water is a route that can fail to exist, and a hold whose salvage cannot be
 *     reached is a dive wasted on a locked box.
 *  3. The island is three tiles square in the middle, which is enough decking for the strongbox
 *     and whatever came up out of the water to stand between you and it.
 *  4. The false stones go down last and only where all four of their neighbours are water. That is
 *     what makes them false — you can see them, you cannot get to them, and they cannot bridge to
 *     the island behind the generator's back and quietly give the room a second answer.
 *
 * Returns the tile in the middle of the island, or null if the compartment came out too small to
 * flood — which `DUNGEON.HOLD_ROOM_MIN` is there to prevent and this guards anyway, because a
 * number in a table is a promise and a check is a fact.
 */
function floodTheHold(tiles: Uint8Array, size: number, rng: Rng, r: Room): [number, number] | null {
  const inner = { x: r.x + 1, z: r.z + 1, w: r.w - 2, h: r.h - 2 };
  if (inner.w < 5 || inner.h < 5) return null;
  const idx = (x: number, z: number) => z * size + x;
  const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

  // where each corridor comes in, brought to the nearest tile of the flooded part
  const banks = doorwaysOf(tiles, size, r).map(({ x, z }): [number, number] => [
    clamp(x, inner.x, inner.x + inner.w - 1), clamp(z, inner.z, inner.z + inner.h - 1),
  ]);
  if (banks.length === 0) return null;

  const [ix, iz] = centre(r);
  const dry = new Set<number>();
  for (let z = iz - 1; z <= iz + 1; z++) for (let x = ix - 1; x <= ix + 1; x++) dry.add(idx(x, z));
  // an L from each bank to the island: two straight runs, which is a line a person can read from
  // above and follow without counting tiles
  for (const [bx, bz] of banks) {
    dry.add(idx(bx, bz));
    for (let x = Math.min(bx, ix); x <= Math.max(bx, ix); x++) dry.add(idx(x, bz));
    for (let z = Math.min(bz, iz); z <= Math.max(bz, iz); z++) dry.add(idx(ix, z));
  }

  for (let z = inner.z; z < inner.z + inner.h; z++) {
    for (let x = inner.x; x < inner.x + inner.w; x++) {
      if (!dry.has(idx(x, z)) && tiles[idx(x, z)] === DTile.Floor) tiles[idx(x, z)] = DTile.Water;
    }
  }

  // crate-tops floating where nothing reaches them: the whole of the puzzle is which line is real
  for (let z = inner.z + 1; z < inner.z + inner.h - 1; z++) {
    for (let x = inner.x + 1; x < inner.x + inner.w - 1; x++) {
      if (tiles[idx(x, z)] !== DTile.Water) continue;
      if (rng() > DUNGEON.FALSE_STONE_CHANCE) continue;
      const adrift = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
        .every(([dx, dz]) => tiles[idx(x + dx, z + dz)] === DTile.Water);
      if (adrift) tiles[idx(x, z)] = DTile.Floor;
    }
  }
  return [ix, iz];
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

function placeRooms(rng: Rng, style: DungeonStyle): Room[] {
  const size = DUNGEON.SIZE, m = DUNGEON.MARGIN;
  const cave = style !== 'vault';
  const rooms: Room[] = [];
  // a hold is compartments rather than cells, and has to be: what makes the flooded one a crossing
  // rather than a puddle is that there is room for water on both sides of the way over it
  const minSide = style === 'sunken' ? DUNGEON.HOLD_ROOM_MIN : DUNGEON.ROOM_MIN;
  const maxSide = style === 'sunken' ? DUNGEON.HOLD_ROOM_MAX : cave ? DUNGEON.CAVE_ROOM_MAX : DUNGEON.ROOM_MAX;
  const maxRooms = cave ? DUNGEON.CAVE_ROOMS_MAX : DUNGEON.ROOMS_MAX;
  for (let attempt = 0; attempt < DUNGEON.ROOM_ATTEMPTS && rooms.length < maxRooms; attempt++) {
    const w = minSide + Math.floor(rng() * (maxSide - minSide + 1));
    const h = minSide + Math.floor(rng() * (maxSide - minSide + 1));
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
