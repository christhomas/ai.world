import { describe, expect, it } from 'vitest';
import { KINDS } from '../entities/animals';
import { DROWNED_MONSTERS, dungeonMonsters } from '../entities/spawns';
import {
  DTile, DUNGEON_STYLES, asDungeonStyle, generateDungeon,
  type DungeonMap, type Room,
} from '../dungeon/generate';
import { reachable } from '../dungeon/map';
import { CHEST, SALVAGE } from '../world/chests';
import { ITEMS } from './items';

/**
 * A wreck you can go down into, and what is waiting in it.
 *
 * A hull on a beach was a chest with a boat drawn round it: you pressed Enter, took the salvage,
 * and every time afterwards were told it was picked clean. It is a way in now. Below the waterline
 * she is flooded, and a flooded hold is a different place from a cave with water in it — it has a
 * roster of its own rather than a rung on the ladder of depths, because a wreck is one room deep
 * and that room is the only one there is.
 *
 * What is pinned here is the part that cannot be seen by looking at the screen: that the drowned
 * roster is made of creatures that actually exist, that a flooded floor draws from it rather than
 * from the depth table, and that the two halves of the game agree about what sort of floor it is.
 * That last one is the whole reason the style now travels over the wire — a world that grew a
 * wreck's hold as a vault while the page grew it as a flooded hold would put every creature in it
 * inside a wall, and it would look like a netcode bug rather than like a missing word.
 */

describe('what is waiting in a drowned hold', () => {
  it('is drawn from the drowned roster rather than from how deep you are', () => {
    expect(dungeonMonsters(1, 'sunken')).toBe(DROWNED_MONSTERS);
    expect(dungeonMonsters(3, 'sunken'), 'a wreck got deeper the further down the ladder it was').toBe(DROWNED_MONSTERS);
  });

  it('leaves every other kind of floor exactly as it was', () => {
    expect(dungeonMonsters(1, 'cave')).toBe(dungeonMonsters(1));
    expect(dungeonMonsters(2, 'vault')).toBe(dungeonMonsters(2));
    expect(dungeonMonsters(2)).not.toBe(dungeonMonsters(1));
  });

  it('is made of creatures the game can actually draw', () => {
    // a name in a spawn table with no body behind it is a floor that silently has nothing in it
    for (const { kind } of DROWNED_MONSTERS) {
      expect(KINDS[kind], `the drowned roster asks for "${kind}" and nothing draws one`).toBeDefined();
    }
  });

  it('is mostly fish-folk, because a fight in waist-deep water wants numbers', () => {
    const share = (id: string): number => DROWNED_MONSTERS.find((m) => m.kind === id)?.weight ?? 0;
    expect(share('fishfolk')).toBeGreaterThan(share('squid'));
    expect(share('squid')).toBeGreaterThan(share('shark'));
  });

  it('holds the two new ones to the shape every other creature has', () => {
    for (const id of ['squid', 'fishfolk']) {
      const kind = KINDS[id];
      expect(kind.hp, `${id} cannot be killed`).toBeGreaterThan(0);
      expect(kind.damage, `${id} cannot hurt anybody`).toBeGreaterThan(0);
      expect(kind.timid, `${id} runs away, in a room you cannot back out of`).toBe(false);
      expect(kind.body.hw, `${id} stands on nothing`).toBeGreaterThan(0);
    }
  });
});

describe('the word that says what a floor is made of', () => {
  it('takes a style the generator knows', () => {
    for (const style of DUNGEON_STYLES) expect(asDungeonStyle(style, 'vault')).toBe(style);
  });

  it('falls back rather than growing something nobody asked for', () => {
    // a page from before the drowned places existed says nothing at all, and must get what it
    // has always got
    expect(asDungeonStyle(undefined, 'cave')).toBe('cave');
    expect(asDungeonStyle('flooded', 'vault')).toBe('vault');
    expect(asDungeonStyle(7, 'thicket')).toBe('thicket');
  });

  it('grows the same rooms on both sides when both sides say the same word', () => {
    /*
     * The failure this guards against, stated as arithmetic: the seed alone does not decide a
     * floor. A wreck's hold and a vault off the same anchor seed are different rooms, so a world
     * that was told only the seed would disagree with the page about where the walls are.
     */
    const flooded = generateDungeon(1234, 'sunken', 1);
    const vault = generateDungeon(1234, 'vault', 1);
    expect(flooded.tiles).not.toEqual(vault.tiles);
    expect(generateDungeon(1234, 'sunken', 1).tiles).toEqual(flooded.tiles);
  });

  it('is one room deep, because a wreck has no second storey below the keel', () => {
    expect(generateDungeon(99, 'sunken', 1).descent, 'a stair down out of a shipwreck').toBeNull();
  });

  it('puts the way out where the hero comes in', () => {
    const hold = generateDungeon(77, 'sunken', 1);
    const [ex, ez] = hold.entrance;
    expect(hold.tiles[ez * hold.size + ex]).not.toBe(DTile.Rock);
  });
});

/**
 * Every tile of the hold somebody could get to without going into the water.
 *
 * `reachable` is the dry-shod walk — `walkableTile` refuses water outright, on the grounds that
 * nobody swims in a cellar — and that is exactly the question these tests ask. The hero himself
 * paddles and can therefore go straight across, which is not a hole in the puzzle but the whole of
 * it: the stones are the way over that costs you nothing, and there is another way over that costs
 * you your breath. What has to be true is that the dry way exists, is single, and goes where the
 * salvage is; what it costs to ignore it is `breath.test.ts`'s business.
 *
 * The climb is one terrace, which is what a hero has. A hold is cut at one depth anyway, so
 * nothing here turns on it and stating it is cheaper than leaving a reader to wonder.
 */
const DRY_SHOD = (map: DungeonMap): Uint8Array => reachable(map, map.entrance, true, 1);

/** The room a tile is standing in, which is how the hold is found from the chest that is in it. */
function roomAround(map: DungeonMap, x: number, z: number): Room {
  return map.rooms.find((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.h) ?? map.rooms[0];
}

/**
 * The hold, and why there is anything to think about in it.
 *
 * Every other room on a flooded floor is a fight: the drowned roster comes at you and you have the
 * hearts for it or you do not. That is a reason to be afraid of a wreck and it is not a reason to
 * go into one, and a room whose only question is how fast you can press a key is a room you swim
 * through rather than one you read.
 *
 * So the salvage is put where you have to get to it. The compartment it is in is flooded but for a
 * line of stones laid from the doorway to an island of decking in the middle, with crate-tops
 * floating either side that turn out to bear nothing — the drowned undercroft in `castle.ts`, said
 * again for the generator that grows wrecks.
 *
 * It is a choice rather than a wall, and it has to be stated that way because the hero paddles: he
 * can swim straight over, and swimming costs breath that does not come back until he is out of the
 * water. So the room offers a long dry line and a short expensive one, with the fish-folk waiting
 * at the far end of both. The tests below are that arrangement said several ways, and the one that
 * matters most is that the dry line is *single* — a false crate-top that happened to touch the
 * crossing would quietly give the room a second answer, which would not fail anything and would
 * make the room unreadable.
 */
describe('the compartment a wreck keeps her cargo in', () => {
  const SEEDS = [1, 7, 23, 77, 601, 4242];

  it('floods the hold and leaves the strongbox standing on dry decking', () => {
    for (const seed of SEEDS) {
      const hold = generateDungeon(seed, 'sunken', 1);
      const strongbox = hold.chests.find((c) => c.big);
      expect(strongbox, `seed ${seed} has no strongbox`).toBeDefined();
      const room = roomAround(hold, strongbox!.x, strongbox!.z);
      let water = 0;
      for (let z = room.z; z < room.z + room.h; z++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          if (hold.tiles[z * hold.size + x] === DTile.Water) water++;
        }
      }
      expect(water, `seed ${seed}: the hold is dry`).toBeGreaterThan(20);
      expect(hold.tiles[strongbox!.z * hold.size + strongbox!.x], `seed ${seed}: the salvage is under water`)
        .not.toBe(DTile.Water);
    }
  });

  it('lays a dry line to every chest in the wreck, so nobody has to get wet to be paid', () => {
    // the crossing is a choice, and a choice needs both of its answers to exist. The expensive one
    // is the swim; this is the other one, and a hold where the salvage could only be swum to would
    // be a wall with a puzzle drawn on it
    for (const seed of SEEDS) {
      const hold = generateDungeon(seed, 'sunken', 1);
      const seen = DRY_SHOD(hold);
      for (const [i, chest] of hold.chests.entries()) {
        const at = (x: number, z: number) => seen[z * hold.size + x] === 1;
        expect(
          at(chest.x, chest.z) || at(chest.x + 1, chest.z) || at(chest.x - 1, chest.z)
            || at(chest.x, chest.z + 1) || at(chest.x, chest.z - 1),
          `seed ${seed}: chest ${i} at ${chest.x},${chest.z} cannot be walked up to`,
        ).toBe(true);
      }
    }
  });

  it('lays the crate-tops where no dry step reaches them, so one line is the only line', () => {
    /*
     * The whole of the puzzle stated as a count. Somewhere on a flooded floor there is floor that
     * no dry step reaches, and every tile of it has water on all four sides rather than being
     * joined to anything — a maze made of what you cannot step on rather than of walls. Anybody who
     * wants one badly enough can swim to it and find it holds nothing, which is the joke; what must
     * not happen is one of them touching the crossing and making the laid line ambiguous.
     */
    let adrift = 0;
    for (const seed of SEEDS) {
      const hold = generateDungeon(seed, 'sunken', 1);
      const seen = DRY_SHOD(hold);
      for (let i = 0; i < hold.tiles.length; i++) {
        if (hold.tiles[i] !== DTile.Floor || seen[i] === 1) continue;
        const x = i % hold.size, z = (i - x) / hold.size;
        // only the ones out in the hold: a room the corridors never reached is a different
        // complaint, and `fullyConnected` above is where it would be made
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => hold.tiles[(z + dz) * hold.size + (x + dx)] === DTile.Water)) continue;
        adrift++;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          expect(
            hold.tiles[(z + dz) * hold.size + (x + dx)],
            `seed ${seed}: a crate-top at ${x},${z} has something beside it that is not water`,
          ).toBe(DTile.Water);
        }
      }
    }
    expect(adrift, 'not one false crate-top in six wrecks').toBeGreaterThan(0);
  });

  it('leaves a dry walk round the wall, so a hold you pass through is not a hold you solve', () => {
    // the flooding stops a tile short of the wall on purpose. A wreck whose every doorway had to be
    // solved to get out of would be four puzzles rather than one, and the crossing is for the
    // salvage rather than for the way through
    for (const seed of SEEDS) {
      const hold = generateDungeon(seed, 'sunken', 1);
      const strongbox = hold.chests.find((c) => c.big)!;
      const room = roomAround(hold, strongbox.x, strongbox.z);
      for (let x = room.x; x < room.x + room.w; x++) {
        for (const z of [room.z, room.z + room.h - 1]) {
          expect(hold.tiles[z * hold.size + x], `seed ${seed}: the walk round the hold is flooded`)
            .not.toBe(DTile.Water);
        }
      }
      for (let z = room.z; z < room.z + room.h; z++) {
        for (const x of [room.x, room.x + room.w - 1]) {
          expect(hold.tiles[z * hold.size + x], `seed ${seed}: the walk round the hold is flooded`)
            .not.toBe(DTile.Water);
        }
      }
    }
  });
});

/**
 * And what is in the crates, which is the reason to make the crossing at all.
 *
 * `world/chests.test.ts` holds the rule — a crate carries cargo, a cave's purse does not, and the
 * strongbox on the island is worth what a merchant would insure. What that file cannot check is the
 * half of it that lives a layer up: the names in `SALVAGE` are strings to the world and have to be
 * things the game can actually put in somebody's hands. A cargo nobody has modelled would come up
 * out of the water as an exception in the corner of the screen.
 */
describe('the cargo a ship went down with', () => {
  it('is made of things the game can actually hand over', () => {
    for (const id of SALVAGE) {
      expect(ITEMS[id], `the hold offers "${id}" and no such thing exists`).toBeDefined();
    }
  });

  it('is worth carrying up the ladder', () => {
    // a crate of something worth five gold is a crate that was not worth the swim
    for (const id of SALVAGE) {
      expect(ITEMS[id].price, `${ITEMS[id].name} is not worth the dive`).toBeGreaterThan(CHEST.SMALL_GOLD);
    }
  });

  it('is goods rather than gear, because a wreck is where a cargo went down', () => {
    // the difference this whole idea rests on: you sell what comes out of a hold, you wear what
    // comes out of a vault. A sword in a crate would make a wreck a wetter vault
    for (const id of SALVAGE) {
      expect(ITEMS[id].slot, `${ITEMS[id].name} is something you put on`).toBeUndefined();
      expect(ITEMS[id].loot, `${ITEMS[id].name} is not a thing anybody trades`).toBe(true);
    }
  });

  it('marks every chest in a wreck as salvage, and nothing in a cave', () => {
    // the flag travels in the map, which is the only thing the page and the world are both certain
    // to have grown from the same seed — so neither has to be told what sort of place this is
    for (const chest of generateDungeon(4242, 'sunken', 1).chests) expect(chest.salvage).toBe(true);
    for (const chest of generateDungeon(4242, 'cave', 1).chests) expect(chest.salvage).toBeUndefined();
  });
});
