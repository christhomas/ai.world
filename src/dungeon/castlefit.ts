import { DTile, reachable, type DungeonMap } from './map';

/**
 * The last check a generated castle goes through: can it still be finished?
 *
 * A plan can be correct and a castle still be broken, because a plan is about walls and a castle
 * is about what is standing between them. This file is the one thing standing between that fills
 * a tile, and the trouble it causes.
 */

/** Every tile a chest is standing on, as flat indices. */
export const chestTiles = (map: DungeonMap): Set<number> =>
  new Set(map.chests.map((c) => c.z * map.size + c.x));

/** Can the hero stand on, or next to, a tile? Standing next to one is how a chest is opened. */
export function beside(seen: Uint8Array, map: DungeonMap, x: number, z: number): boolean {
  const at = (px: number, pz: number) =>
    px >= 0 && pz >= 0 && px < map.size && pz < map.size && seen[pz * map.size + px] === 1;
  return at(x, z) || at(x + 1, z) || at(x - 1, z) || at(x, z + 1) || at(x, z - 1);
}

/**
 * Shuffle any chest that has walled something off, or walled itself in, onto a neighbouring tile.
 *
 * A chest fills its tile — `DungeonWorld.blocked` says so, and it has to, or you could stand
 * inside the treasure. That makes a chest a wall, and a wall dropped in the wrong place is a room
 * nobody can enter. It happened on the very first castle built: the great chest goes at the middle
 * of the throne room's dais, the dais runs the width of the room, and on a room whose one doorway
 * came out on the middle of that wall the chest sat squarely in the gap. The throne room, the boss
 * and the treasure were all behind it, and the floor plan looked perfectly connected.
 *
 * The first attempt at this only asked whether each chest could be walked up to, which that castle
 * passed: you could stand in the doorway and open it. What you could not do was get past it. So the
 * measure is what the chests cost the floor — how much of it they shut off, and how many of them
 * nobody can reach — and a chest is nudged one tile at a time for as long as that number goes down.
 *
 * `climb` is in terraces and belongs to whoever is walking; it is a parameter rather than a
 * constant here because this file is about chests and not about the hero.
 */
export function settleChests(map: DungeonMap, climb: number): void {
  // what the floor would be with nothing standing on it: the baseline the chests are charged against
  const free = reachable(map, map.entrance, true, climb);
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    const taken = chestTiles(map);
    const cost = damage(map, free, reachable(map, map.entrance, true, climb, taken), taken);
    if (cost === 0) return;
    if (!nudge(map, free, taken, cost, climb)) return;
  }
}

/** Move whichever chest can be improved by a step, and say whether any could. */
function nudge(map: DungeonMap, free: Uint8Array, taken: Set<number>, cost: number, climb: number): boolean {
  for (const c of map.chests) {
    const home = c.z * map.size + c.x;
    for (const [dx, dz] of ROUND_ABOUT) {
      const nx = c.x + dx, nz = c.z + dz, i = nz * map.size + nx;
      if (nx < 1 || nz < 1 || nx >= map.size - 1 || nz >= map.size - 1) continue;
      if (map.tiles[i] !== DTile.Floor || taken.has(i)) continue;
      const trial = new Set(taken);
      trial.delete(home);
      trial.add(i);
      const after = damage(map, free, reachable(map, map.entrance, true, climb, trial), trial);
      if (after < cost) { c.x = nx; c.z = nz; return true; }
    }
  }
  return false;
}

/**
 * What the chests cost this floor: every tile shut off behind one, and a heavy price for any chest
 * that cannot be walked up to at all. The price is heavy on purpose — a chest nobody can open is
 * worse than any amount of floor nobody can reach, because the floor is at least still a castle.
 */
function damage(map: DungeonMap, free: Uint8Array, held: Uint8Array, taken: ReadonlySet<number>): number {
  let n = 0;
  for (let i = 0; i < free.length; i++) if (free[i] === 1 && held[i] === 0 && !taken.has(i)) n++;
  for (const i of taken) {
    const x = i % map.size, z = (i - x) / map.size;
    if (!beside(held, map, x, z)) n += SHUT_IN;
  }
  return n;
}

/** Tiles a chest may be shuffled onto, nearest first. */
const ROUND_ABOUT: ReadonlyArray<readonly [number, number]> =
  [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/** How many single-tile moves are allowed before the arrangement is accepted as it stands. */
const SETTLE_PASSES = 6;

/** What one unopenable chest is worth in tiles of shut-off floor: more than a floor could hold. */
const SHUT_IN = 10000;
