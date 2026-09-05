import { describe, expect, it } from 'vitest';
import { Standing } from './standing';

/**
 * A house the player commissioned is put up long after the ground under it was made, and a chunk's
 * blocked flags are baked when that ground is generated. So the first house anybody built could be
 * walked straight through.
 */
describe('what is standing that the ground does not know about', () => {
  it('has nothing on it until something is built', () => {
    const standing = new Standing();
    expect(standing.at(4, 4)).toBe(false);
    expect(standing.count).toBe(0);
  });

  it('holds the tile something was put on', () => {
    const standing = new Standing();
    standing.replace([{ x: 12, z: -7 }]);
    expect(standing.at(12, -7)).toBe(true);
  });

  it('holds the whole tile, not just its corner', () => {
    const standing = new Standing();
    standing.replace([{ x: 12, z: -7 }]);
    expect(standing.at(12.9, -6.1), 'a wall you can stand in the corner of').toBe(true);
    expect(standing.at(13.1, -7), 'a wall that spread into the next tile').toBe(false);
  });

  it('leaves the ground either side of it alone', () => {
    const standing = new Standing();
    standing.replace([{ x: 0, z: 0 }]);
    expect(standing.at(1, 0)).toBe(false);
    expect(standing.at(-1, 0)).toBe(false);
    expect(standing.at(0, 1)).toBe(false);
    expect(standing.at(0, -1)).toBe(false);
  });

  it('is replaced whole, so an abandoned house does not leave its walls behind', () => {
    const standing = new Standing();
    standing.replace([{ x: 3, z: 3 }]);
    standing.replace([{ x: 90, z: 90 }]);
    expect(standing.at(3, 3), 'the old walls are still standing').toBe(false);
    expect(standing.at(90, 90)).toBe(true);
  });

  it('never confuses one tile for another, however far apart they are', () => {
    // a collision would wall off somewhere nobody had built anything, which is close to impossible
    // to diagnose from inside the game. The stride is wider than any coordinate the world uses.
    const standing = new Standing();
    const far = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 },
      { x: 500000, z: -500000 }, { x: -500000, z: 500000 }, { x: 262144, z: 3 },
    ];
    standing.replace(far);
    expect(standing.count, 'two different tiles landed on the same key').toBe(far.length);
    for (const tile of far) expect(standing.at(tile.x, tile.z), `${tile.x},${tile.z}`).toBe(true);
    expect(standing.at(7, 7)).toBe(false);
  });
});
