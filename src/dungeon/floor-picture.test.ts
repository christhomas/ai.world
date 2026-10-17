import { describe, expect, it } from 'vitest';
import { DTile, type DungeonMap } from './map';
import { FloorSight, floorPicture } from './floor-picture';

/**
 * A floor twelve tiles across: rock round the edge, floor inside, a pool, a door, a raised gallery
 * along one row, the way in at (2, 2), and two chests — one far off in the corner.
 */
function floor(): DungeonMap {
  const size = 12;
  const tiles = new Uint8Array(size * size);
  const levels = new Uint8Array(size * size);
  for (let z = 1; z < size - 1; z++) for (let x = 1; x < size - 1; x++) tiles[z * size + x] = DTile.Floor;
  tiles[3 * size + 4] = DTile.Water;
  tiles[2 * size + 5] = DTile.Door;
  for (let x = 1; x < size - 1; x++) levels[1 * size + x] = 3;
  return { size, tiles, levels, entrance: [2, 2], chests: [{ x: 3, z: 3, big: false }, { x: 10, z: 10, big: false, key: true }],
    rooms: [], torches: [], doors: [], monsterSpots: [], floor: 1, descent: null, boss: null, furniture: [] } as unknown as DungeonMap;
}

/** The colour of a cell as an app decodes the picture. */
function at(picture: ReturnType<typeof floorPicture>, x: number, z: number): number {
  let cell = z * picture.size + x;
  for (let i = 0; i < picture.runs.length; i += 2) {
    if (cell < picture.runs[i + 1]) return picture.colours[picture.runs[i]];
    cell -= picture.runs[i + 1];
  }
  throw new Error('off the floor');
}

describe('a floor\'s map, wherever it is drawn', () => {
  it('lights only what has been seen, round where the hero stood, and nothing of the rock', () => {
    const sight = new FloorSight(floor());
    expect(sight.known).toBe(0);
    sight.reveal(2.5, 2.5);
    const seen = sight.known;
    expect(seen).toBeGreaterThan(20);
    sight.reveal(2.5, 2.5);
    expect(sight.known, 'standing in the same place sees nothing new').toBe(seen);
    expect(sight.cell(2, 2, false)).toBe(0x6a5a48);
    expect(sight.cell(0, 0, false), 'rock is never drawn').toBeNull();
    expect(sight.cell(10, 10, false), 'not seen yet').toBeNull();
    expect(sight.cell(4, 3, false)).toBe(0x2f6f9f);
    expect(sight.cell(5, 2, false), 'a door is red until the floor is unlocked').toBe(0xc0392b);
    expect(sight.cell(5, 2, true)).toBe(0x8a6a3d);
    expect(sight.cell(2, 1, false), 'a gallery above the floor is drawn paler').not.toBe(0x6a5a48);
  });

  it('sends an app the same cells, with the way in and only the chests that have been seen', () => {
    const sight = new FloorSight(floor());
    sight.reveal(2.5, 2.5);
    const picture = floorPicture(sight, (i) => i === 0, false);
    for (const [x, z] of [[2, 2], [4, 3], [5, 2], [2, 1], [0, 0], [10, 10]]) {
      expect(at(picture, x, z), `${x},${z}`).toBe(sight.cell(x, z, false) ?? 0x05060c);
    }
    expect(picture.entrance).toEqual([2, 2]);
    expect(picture.chests, 'the far chest is not on the map until somebody sees it').toEqual([{ x: 3, z: 3, colour: 0x7f7f5a }]);
    sight.reveal(10, 10);
    expect(floorPicture(sight, () => false, false).chests.map((c) => c.colour)).toEqual([0xf1c40f, 0xe8e8e8]);
  });
});
