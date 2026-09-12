import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { PropKind } from '../world/biomes';
import { FURNITURE_BLOCKS } from '../world/footprints';
import { KINDS } from '../entities/animals';
import { canStand } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { Roster } from '../entities/roster';
import { CASTLE, generateCastle } from './castle';
import { floorThePlanOffers } from './castlefit';
import { GHOST, HANGS_ON_WALLS, HAUNTS_AT_MOST } from './castlerooms';
import { generateDungeon, DUNGEON } from './generate';
import { BASE_LEVEL, DTile, levelAt, reachable, type DungeonMap } from './map';
import { DungeonWorld } from './world';

/**
 * A castle is a place that has to be finishable.
 *
 * Everything below is one worry written four ways. A generated building can be beautiful and
 * still be broken, and the ways it breaks are all silent: a room whose only door is barred by the
 * key that is inside it, a gallery you can see the chest on and cannot reach, a floor whose stair
 * up is walled off, a seed that builds a different castle on the machine next door. None of those
 * shows up as an error. Each of them shows up as a player walking round a castle for ten minutes
 * and then closing the game.
 *
 * So the tests walk it. Where it matters they walk it as the hero actually is — `canStand` with
 * `KINDS.hero`, so the climb, the collision box and the water are the real ones and not a second
 * opinion about them.
 */

/** Every tile the hero could get to from where they arrive, walking as the hero really walks. */
function walked(map: DungeonMap, unlocked: boolean): Uint8Array {
  const world = new DungeonWorld(map, 'test', 'castle');
  world.unlocked = unlocked;
  const seen = new Uint8Array(map.size * map.size);
  const [ex, ez] = map.entrance;
  const stack = [ez * map.size + ex];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % map.size, z = (i - x) / map.size;
    const from = world.heightAt(x + 0.5, z + 0.5);
    if (from === null) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= map.size || nz >= map.size) continue;
      const j = nz * map.size + nx;
      if (seen[j]) continue;
      if (!canStand(world, KINDS.hero, nx + 0.5, nz + 0.5, from)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

/** True where the hero can stand on, or beside, a given tile — which is how a chest is opened. */
function within(seen: Uint8Array, map: DungeonMap, x: number, z: number): boolean {
  const at = (px: number, pz: number) => px >= 0 && pz >= 0 && px < map.size && pz < map.size && seen[pz * map.size + px] === 1;
  return at(x, z) || at(x + 1, z) || at(x - 1, z) || at(x, z + 1) || at(x, z - 1);
}

/** Every tile of the minstrels' gallery: floor standing a full `GALLERY_RISE` above the rest. */
function galleryOf(map: DungeonMap): number[] {
  const out: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    const x = i % map.size, z = (i - x) / map.size;
    if (map.tiles[i] === DTile.Floor && levelAt(map, x, z) === BASE_LEVEL + CASTLE.GALLERY_RISE) out.push(i);
  }
  return out;
}

const everyFloor = <T>(f: (floor: number) => T): T[] =>
  Array.from({ length: CASTLE.FLOORS }, (_, n) => f(n + 1));

describe('a castle', () => {
  it('is the same castle from the same seed, and a different one from a different seed', () => {
    for (const seed of [1, 2, 77, 4242, 100000]) {
      for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
        const a = generateCastle(seed, floor), b = generateCastle(seed, floor);
        const picture = (m: DungeonMap) => JSON.stringify([
          Array.from(m.tiles), Array.from(m.levels ?? []), m.rooms, m.entrance, m.chests,
          m.torches, m.doors, m.monsterSpots, m.furniture, m.descent, m.boss,
        ]);
        expect(picture(a), `seed ${seed} floor ${floor} built two different castles`).toBe(picture(b));
      }
    }
    expect(
      Array.from(generateCastle(1, 1).tiles),
      'two seeds built the same castle, so every castle in the world is this one',
    ).not.toEqual(Array.from(generateCastle(2, 1).tiles));
    expect(
      Array.from(generateCastle(1, 1).tiles),
      'two floors of the same castle came out identical, so climbing it shows you nothing new',
    ).not.toEqual(Array.from(generateCastle(1, 2).tiles));
  });

  it('is a building: a curtain walk, four corner towers, a gate and rooms off galleries', () => {
    const map = generateCastle(4242, 1);
    expect(map.size, 'a castle should be bigger than the vault under a shrine').toBeGreaterThan(DUNGEON.SIZE);
    expect(
      map.rooms.length,
      'a castle with fewer rooms than a vault is a vault with thicker walls',
    ).toBeGreaterThan(DUNGEON.ROOMS_MAX);
    // the outer ring of the map stays solid rock, so nothing is built off the edge of the world
    for (let i = 0; i < map.size; i++) {
      expect(map.tiles[i]).toBe(DTile.Rock);
      expect(map.tiles[(map.size - 1) * map.size + i]).toBe(DTile.Rock);
      expect(map.tiles[i * map.size]).toBe(DTile.Rock);
      expect(map.tiles[i * map.size + map.size - 1]).toBe(DTile.Rock);
    }
    // torches are brackets on walls and chests stand on floors, in a castle as in a barrow
    for (const t of map.torches) expect(map.tiles[t.z * map.size + t.x], `a torch at ${t.x},${t.z} is floating in a room`).toBe(DTile.Rock);
    for (const c of map.chests) expect(map.tiles[c.z * map.size + c.x], `a chest at ${c.x},${c.z} is standing in the rock`).toBe(DTile.Floor);
    for (const f of map.furniture) {
      // a banner, a tapestry and a window are fixed to rock the way a torch is, so the tile under
      // one is a wall on purpose — reported as "inside a wall" it is the hanging doing its job
      const on = HANGS_ON_WALLS.has(f.kind) ? DTile.Rock : DTile.Floor;
      expect(map.tiles[f.z * map.size + f.x],
        `${HANGS_ON_WALLS.has(f.kind) ? 'a hanging' : 'furniture'} at ${f.x},${f.z} is on the wrong sort of tile`).toBe(on);
    }
  });

  it('can be walked from the gate to every room on every floor', () => {
    for (const seed of [3, 11, 29, 58, 601, 4242]) {
      for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
        const map = generateCastle(seed, floor);
        const seen = walked(map, true);
        /*
         * What the plan itself offers, which is what the dressing is held to.
         *
         * Asked of `castlefit.ts` rather than worked out again here, and that matters: it is the
         * same answer the settle charges the furniture against, so this test states exactly the
         * promise that code makes. The promise is that a table, a barrel or a weapon rack costs
         * the floor nothing — but that a cell may, because bars are solid on purpose and a gaol
         * you can walk out of is a corner of a room.
         */
        const offered = floorThePlanOffers(map, CASTLE.HERO_CLIMB);
        const stranded: string[] = [];
        for (let i = 0; i < map.tiles.length; i++) {
          const t = map.tiles[i] as DTile;
          if (t === DTile.Rock || t === DTile.Water || seen[i]) continue;
          const x = i % map.size, z = (i - x) / map.size;
          // A chest fills its own tile, so the tile under one is never walked on — reaching a
          // chest means standing beside it, which the chest test measures. Furniture fills its
          // tile for exactly the same reason, and a barrel standing in a corner is not a room
          // nobody can reach: it is a barrel. And the false stepping stones in the drowned
          // undercroft are meant to be out of reach: that is the puzzle.
          // Anything else out of reach is a room nobody will ever see.
          if (map.chests.some((c) => c.x === x && c.z === z)) continue;
          if (map.furniture.some((f) => f.x === x && f.z === z && FURNITURE_BLOCKS.has(f.kind))) continue;
          if (!offered[i]) continue;                      // shut in by the plan or by a cell's bars
          const island = [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .every(([dx, dz]) => map.tiles[(z + dz) * map.size + (x + dx)] === DTile.Water);
          if (!island) stranded.push(`${x},${z}`);
        }
        expect(stranded, `seed ${seed} floor ${floor}: floor tiles nobody can reach at ${stranded.slice(0, 8).join(' ')}`).toEqual([]);
      }
    }
  });

  it('never hides the warden\'s key behind the door it opens', () => {
    for (const seed of [3, 11, 29, 58, 601, 4242]) {
      for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
        const map = generateCastle(seed, floor);
        const key = map.chests.find((c) => c.key);
        expect(key, `seed ${seed} floor ${floor} has a barred stair and no key anywhere`).toBeDefined();
        const barred = walked(map, false);
        expect(
          within(barred, map, key!.x, key!.z),
          `seed ${seed} floor ${floor}: the key is inside the room it unlocks, so the castle cannot be finished`,
        ).toBe(true);
      }
    }
  });

  it('bars the way on until the key is found, and opens it once it is', () => {
    for (const seed of [3, 11, 29, 58, 601, 4242]) {
      for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
        const map = generateCastle(seed, floor);
        const beyond = map.descent ?? map.boss;
        expect(beyond, 'every floor either goes on or ends in something').not.toBeNull();
        const [bx, bz] = beyond!;
        if (map.doors.length > 0) {
          expect(
            within(walked(map, false), map, bx, bz),
            `seed ${seed} floor ${floor}: the way on is not actually behind the portcullis`,
          ).toBe(false);
        }
        expect(
          within(walked(map, true), map, bx, bz),
          `seed ${seed} floor ${floor}: the way on is still shut with the key in hand`,
        ).toBe(true);
      }
    }
  });

  it('puts every chest somewhere the hero can walk up to', () => {
    for (const seed of [3, 11, 29, 58, 601, 4242]) {
      for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
        const map = generateCastle(seed, floor);
        const seen = walked(map, true);
        map.chests.forEach((c, i) => {
          expect(
            within(seen, map, c.x, c.z),
            `seed ${seed} floor ${floor}: chest ${i} at ${c.x},${c.z} cannot be walked up to`,
          ).toBe(true);
        });
      }
    }
  });

  it('has a drowned undercroft on every floor that is swum rather than waded', () => {
    /*
     * This read "crossed on stones and not on water" until the 12th, and checked it by asking
     * whether `heightAt` was null over every flooded tile. That was the right check for as long as
     * deep water was a wall — and the hero learned to swim that evening, which does not consult
     * `heightAt` at all. So the test went on passing while the thing it was written to protect
     * quietly stopped being true.
     *
     * What is true now is better, and it is the same bargain the wreck's flooded hold makes: the
     * stones are the free way across, and the water is the short way at a price. Breath drains
     * while a hero is out of his depth and none of it comes back until he is out, so swimming to
     * the island costs him the guard he would want when he gets there. The puzzle stopped being
     * "find the real stones" and became "is it worth the crossing", which is a better question.
     *
     * So what is checked here is what actually holds: there is water, nothing *walks* on it, and it
     * is genuinely water rather than a hole in the floor — because a hole is a wall to everybody,
     * and that is the version of this room nobody should ship by accident.
     */
    for (const seed of [3, 11, 29, 58, 601, 4242]) {
      for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
        const map = generateCastle(seed, floor);
        const water = map.tiles.reduce((n, t) => n + (t === DTile.Water ? 1 : 0), 0);
        expect(water, `seed ${seed} floor ${floor} has nothing flooded on it`).toBeGreaterThan(20);
        const world = new DungeonWorld(map, 'test', 'castle');
        for (let i = 0; i < map.tiles.length; i++) {
          if (map.tiles[i] !== DTile.Water) continue;
          const x = i % map.size, z = (i - x) / map.size;
          expect(world.heightAt(x + 0.5, z + 0.5), 'somebody can walk on the water').toBeNull();
          expect(world.waterAt(x + 0.5, z + 0.5), 'the flooded room is a pit rather than a pool')
            .not.toBeNull();
        }
      }
    }
  });

  it('puts the minstrels\' gallery out of reach of everything but its own stair', () => {
    for (const seed of [3, 11, 29, 58, 601, 4242]) {
      for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
        const map = generateCastle(seed, floor);
        const gallery = galleryOf(map);
        expect(gallery.length, `seed ${seed} floor ${floor} has no gallery over its great hall`).toBeGreaterThan(6);
        const seen = walked(map, true);
        expect(
          gallery.some((i) => seen[i] === 1),
          `seed ${seed} floor ${floor}: the gallery is decoration, because nothing can get onto it`,
        ).toBe(true);

        // Take the treads away and it must become unreachable — to a hero with a climbing rope as
        // well, whose 1.06 clears two terraces. That is what makes three the right rise: without
        // it, the room's answer is "walk at the wall harder" and the stair is scenery.
        const tiles = Uint8Array.from(map.tiles);
        for (let i = 0; i < map.levels!.length; i++) {
          const l = map.levels![i];
          if (l > BASE_LEVEL && l < BASE_LEVEL + CASTLE.GALLERY_RISE) tiles[i] = DTile.Rock;
        }
        const noStair: DungeonMap = { ...map, tiles };
        const roped = reachable(noStair, noStair.entrance, true, 2);
        expect(
          gallery.filter((i) => roped[i] === 1),
          `seed ${seed} floor ${floor}: the gallery can be got onto without using its stair`,
        ).toEqual([]);
      }
    }
  });

  it('climbs four floors, each opening onto the next, with the lord at the top', () => {
    const built = everyFloor((floor) => generateCastle(4242, floor));
    built.forEach((map, n) => {
      const floor = n + 1;
      expect(map.floor).toBe(floor);
      if (floor < CASTLE.FLOORS) {
        expect(map.descent, `floor ${floor} of four has no way on`).not.toBeNull();
        expect(map.tiles[map.descent![1] * map.size + map.descent![0]]).toBe(DTile.Descent);
        expect(map.boss, `floor ${floor} is not the top and should not hold the lord of the place`).toBeNull();
      } else {
        expect(map.descent, 'the top floor of a castle has nowhere further up').toBeNull();
        expect(map.boss, 'the top floor has nothing waiting on it').not.toBeNull();
      }
      expect(map.chests.filter((c) => c.big).length, `floor ${floor} has the wrong number of great chests`).toBe(1);
      expect(map.monsterSpots.length, `floor ${floor} is empty`).toBeGreaterThan(0);
    });
    // deeper in is busier, the same way a vault is
    expect(built[CASTLE.FLOORS - 1].monsterSpots.length).toBeGreaterThan(built[0].monsterSpots.length);
  });

  it('keeps ghosts in the rooms a keep keeps ghosts in, and they are really raised', () => {
    for (let floor = 1; floor <= CASTLE.FLOORS; floor++) {
      const map = generateCastle(4242, floor);
      const ghosts = map.monsterSpots.filter((s) => s[2] === GHOST);
      expect(ghosts.length, `floor ${floor} of a castle is not haunted at all`).toBeGreaterThan(0);
      expect(
        ghosts.length,
        `floor ${floor} holds ${ghosts.length} wights, which is a floor you cannot afford to be on`,
      ).toBeLessThanOrEqual(HAUNTS_AT_MOST + floor);
      // nothing is waiting in arm's reach of the stair you arrive on, ghost or otherwise
      for (const [x, z] of map.monsterSpots) {
        expect(Math.hypot(x - map.entrance[0], z - map.entrance[1])).toBeGreaterThan(1);
      }

      // and the seam that makes any of that real: a named spot is spawned as what it names, while
      // the rooms that named nothing are still rolled against the table for the depth
      const world = new DungeonWorld(map, `castle:Test:${floor}`, 'castle');
      const manager = new EntityManager(new Roster(), world, { getTiles: () => null }, 7);
      const put = manager.spawnMonsters(map.monsterSpots, 7, floor);
      const raised = put.filter((e) => e.kind.id === GHOST).length;
      expect(raised, `floor ${floor}: the castle says it is haunted and nothing was raised`).toBe(ghosts.length);
      expect(put.length, `floor ${floor} is nothing but ghosts`).toBeGreaterThan(raised);
    }
  });

  it('is a castle the rest of the game already knows how to walk on', () => {
    const map = generateDungeon(4242, 'castle', 1);
    expect(map.size, 'asking `generateDungeon` for a castle got something else').toBe(CASTLE.SIZE);
    const world = new DungeonWorld(map, 'castle:Test:1', 'castle');
    const [ex, ez] = map.entrance;
    expect(world.heightAt(ex + 0.5, ez + 0.5), 'the hero would arrive inside a wall').not.toBeNull();
    expect(world.props(new Set()).length, 'a castle drawn with nothing in it').toBeGreaterThan(50);
    expect(world.chunksPerSide * WORLD.CHUNK_SIZE, 'the scene would not cover the whole castle').toBeGreaterThanOrEqual(map.size);
  });
});
