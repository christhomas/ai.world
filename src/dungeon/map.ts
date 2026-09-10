import { PropKind } from '../world/biomes';
import type { SpawnSpot } from '../entities/spawns';

/**
 * What a floor underground is, whoever grew it.
 *
 * Two generators fill this in — `generate.ts`, which grows vaults, caves and thickets, and
 * `castle.ts`, which builds a keep — and the shape they agree on lives here rather than in either
 * of them. Partly because a generator that has to import the other one to say what it returns is a
 * cycle waiting to be discovered by a bundler, and partly because the three things that *read* a
 * floor — the world it is walked on, the scene it is drawn in, the map in the corner — should not
 * have to know which of them made it. A castle is a dungeon from every angle but its own.
 */

export const enum DTile { Rock = 0, Floor = 1, Water = 2, Stairs = 3, Door = 4, Descent = 5 }

export interface Room { x: number; z: number; w: number; h: number }
export interface Chest { x: number; z: number; big: boolean; key?: boolean }
export interface Door { x: number; z: number }
export interface Torch { x: number; z: number; /** yaw so the bracket faces into the room */ rot: number }

/** One piece of furniture the generator chose to stand somewhere. */
export interface Furnishing {
  kind: PropKind;
  x: number;
  z: number;
  rot: number;
  /**
   * Which terrace it stands on, when the floor is not all one height. Left out means the tile's
   * own level, which is what everything on a flat floor wants; a banner or a torch on a wall face
   * needs to say so itself, because the tile it hangs over is rock and rock has no level.
   */
  level?: number;
}

/**
 * The level every walkable tile sits on, where a floor is not all one height, or null where it is.
 *
 * A vault, a cave and a thicket are each cut at one depth and have no use for this; a castle has a
 * dais at one end of its hall and a gallery running round above it, and both of those are the
 * whole point of being inside a building rather than inside a hole. Null rather than an array of
 * the same number sixty thousand times, so that the three older kinds cost nothing at all for a
 * feature they do not use.
 */
export type Levels = Uint8Array | null;

export interface DungeonMap {
  size: number;
  tiles: Uint8Array;
  rooms: Room[];
  entrance: [number, number];
  chests: Chest[];
  torches: Torch[];
  /** Locked doors sealing the treasure room; opened by the key chest's key. */
  doors: Door[];
  /**
   * Room centres where something waits, and what it is in the rooms that get to say.
   *
   * A hole in the ground never says. Its spots are rolled against the table for the depth, so what
   * you meet on the second floor of a vault is whatever the second band holds, and that is right
   * for somewhere nobody built: a barrow does not have a chapel. A castle does, and the wight in
   * it is a fact about the chapel rather than a roll — the same on the fortieth visit as on the
   * first, and the same for everybody, which is exactly the argument `game/haunts.ts` makes about
   * anything that keeps a place. Naming the occupant is how a floor says so, and it is the only
   * way it can: `spawnMonsters` is the one thing that puts creatures on a floor.
   */
  monsterSpots: SpawnSpot[];
  /** Which floor this is, counting from one at the entrance. */
  floor: number;
  /** Stairs further down, on every floor but the last. */
  descent: [number, number] | null;
  /** The boss stands here on the final floor. */
  boss: [number, number] | null;
  /** @see Levels */
  levels: Levels;
  /** Furniture the generator stood in the rooms. Empty where a place furnishes itself. */
  furniture: Furnishing[];
}

/** The floor level a tile sits on: its own, where the floor has levels, and one everywhere else. */
export function levelAt(map: DungeonMap, x: number, z: number): number {
  if (!map.levels) return BASE_LEVEL;
  const l = map.levels[z * map.size + x];
  return l === 0 ? BASE_LEVEL : l;
}

/**
 * The terrace an ordinary floor tile sits on.
 *
 * One rather than nought so a pool cut into it — bed at nought — reads as sunk rather than as
 * paint. Everything a castle raises is measured up from here.
 */
export const BASE_LEVEL = 1;

/**
 * The terrace the top of the rock sits on, which is where anything fixed to a wall hangs from.
 *
 * Five, chosen against the isometric camera in `dungeon/world.ts` — enough that a wall is a wall,
 * not so much that the room you are standing in is hidden behind the one in front of it. It lives
 * here rather than there because two different things need it and only one of them draws walls: a
 * torch is put on a wall face by the mesher, and a banner is put on one by the dressing, which
 * knows nothing about meshes and has to say what terrace it hangs from in the map itself.
 *
 * Getting that wrong is not subtle and went unnoticed anyway. A hanging with no level on it falls
 * back to the level of the tile it is over, that tile is rock, and rock reads as `BASE_LEVEL` — so
 * every banner, tapestry and stained window in every castle was drawn hanging from the floor
 * downwards, with an inch of pole showing above the flagstones. From above they read as rugs
 * somebody had dropped against the wall, which is exactly what the note on `Furnishing.level`
 * below warns about and exactly what happened.
 */
export const WALL_LEVEL = 5;

/** Can you walk on this tile at all, doors aside? Water is a barrier underground: nobody swims in a cellar. */
export function walkableTile(t: DTile, throughDoors: boolean): boolean {
  return t === DTile.Floor || t === DTile.Stairs || t === DTile.Descent || (throughDoors && t === DTile.Door);
}

/**
 * Every tile you can get to from somewhere, obeying doors and the height of a step.
 *
 * `climb` is in terraces, because that is the unit a floor is built in. The hero's own is one: his
 * `climb` in `properties/people.json` is 0.56 against a `WORLD.STEP` of 0.5, which clears exactly
 * one terrace and no more, and a climbing rope makes it two. So a lip three terraces high is a
 * wall to everybody, which is what a castle's gallery is built out of.
 *
 * This is the tool both the castle generator and its tests reason with: a room you cannot reach is
 * a room nobody will ever see, and a key behind the door it opens is a castle nobody can finish.
 */
export function reachable(
  map: DungeonMap,
  from: [number, number],
  throughDoors: boolean,
  climb: number,
  /**
   * Tiles nothing may stand on, as flat indices. Chests, in practice: `DungeonWorld.blocked` says
   * a chest fills its tile, so a chest set down in the one doorway of a room seals that room and
   * the map still says it is connected. That was a real castle — the treasure on the dais happened
   * to line up with the door — and nothing but a walk that knows chests are solid would have
   * caught it.
   */
  blocked?: ReadonlySet<number>,
): Uint8Array {
  const { size, tiles } = map;
  const seen = new Uint8Array(size * size);
  const start = from[1] * size + from[0];
  if (!walkableTile(tiles[start] as DTile, throughDoors)) return seen;
  seen[start] = 1;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % size, z = (i - x) / size;
    const here = levelAt(map, x, z);
    for (const [dx, dz] of STEPS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const j = nz * size + nx;
      if (seen[j] || blocked?.has(j) || !walkableTile(tiles[j] as DTile, throughDoors)) continue;
      if (Math.abs(levelAt(map, nx, nz) - here) > climb) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

const STEPS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Flood fill from the stairs; true if every floor/water/stairs tile is reachable (used by tests). */
export function fullyConnected(map: DungeonMap): boolean {
  const { size, tiles } = map;
  const seen = new Uint8Array(size * size);
  const stack: number[] = [map.entrance[1] * size + map.entrance[0]];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % size, z = Math.floor(i / size);
    for (const [dx, dz] of STEPS) {
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
