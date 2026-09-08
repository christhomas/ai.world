import { PropKind } from './biomes';

/**
 * How much ground each kind of prop actually takes up.
 *
 * Collision used to be a bit per tile: a prop stood on a tile, and that whole tile was solid.
 * Nothing in this world is tile-shaped, so it was wrong in both directions at once — a market stall
 * drawn two and a half tiles across blocked one, and you walked through the counter; a cottage's
 * three-tile footprint against 2.4 of wall left a ring of invisible wall round every house.
 *
 * These are half-extents, in tiles, along the prop's own axes before it is turned. They are
 * measured off the meshes the game draws — not estimated — by `footprints.test.ts`, which builds
 * every prop and fails if any of these has drifted from its geometry. So they are numbers here,
 * where a world with no graphics can read them, and the geometry is still the authority.
 *
 * They have to be plain data because the three worlds that need them are not alike. The game's
 * `ChunkManager` draws and walks; `GroundWorld` walks heroes and creatures on the server and has
 * never seen a mesh; and a worker does the same beside a game somebody is playing alone. Only the
 * first could measure anything.
 */

/**
 * The band a walker meets, in world units: mid-shin to chest.
 *
 * This is what makes boxes usable rather than merely accurate. Below it are the things you step
 * onto — a doorstep, a plinth, a flagstone — and taking those would seal every door in the game,
 * which the first measurement duly did. Above it are the things you walk under: a tree's crown, a
 * stall's roof, a cottage's eaves. Taking whole bounding boxes would make a wood impassable, which
 * is the same bug arrived at from the other side.
 *
 * A face counts if it spans the band, not if it has a corner in it — a wall is a box whose only
 * vertices are at the floor and the ceiling, and measuring corners found no walls at all.
 */
export const WALKING_BAND = { low: 0.3, high: 1.4 } as const;

/** Half-extents in tiles, along the prop's own axes. Anything absent does not block. */
export const FOOTPRINTS: ReadonlyMap<PropKind, { hw: number; hd: number }> = new Map([
  [PropKind.Oak, { hw: 0.9, hd: 0.82 }],
  [PropKind.Pine, { hw: 0.83, hd: 0.85 }],
  [PropKind.Cactus, { hw: 0.54, hd: 0.23 }],
  [PropKind.DeadTree, { hw: 0.44, hd: 0.17 }],
  [PropKind.Willow, { hw: 1.05, hd: 1.05 }],
  [PropKind.SnowPine, { hw: 0.83, hd: 0.85 }],
  [PropKind.Boulder, { hw: 1.07, hd: 0.79 }],
  [PropKind.Palm, { hw: 0.32, hd: 0.16 }],
  [PropKind.Birch, { hw: 0.54, hd: 0.47 }],
  [PropKind.Fir, { hw: 0.6, hd: 0.62 }],
  [PropKind.Blossom, { hw: 0.84, hd: 0.78 }],
  [PropKind.HousePlains, { hw: 1.26, hd: 1.26 }],
  [PropKind.HouseForest, { hw: 1.26, hd: 1.26 }],
  [PropKind.HouseDesert, { hw: 1.26, hd: 1.26 }],
  [PropKind.HouseSwamp, { hw: 1.26, hd: 1.26 }],
  [PropKind.HouseMountain, { hw: 1.26, hd: 1.26 }],
  [PropKind.HouseSnow, { hw: 1.26, hd: 1.26 }],
  [PropKind.Well, { hw: 0.66, hd: 0.66 }],
  [PropKind.Shrine, { hw: 1.87, hd: 1.67 }],
  [PropKind.Ruins, { hw: 1.28, hd: 1.28 }],
  [PropKind.Tower, { hw: 1.1, hd: 1.1 }],
  [PropKind.Campfire, { hw: 0.25, hd: 0.26 }],
  [PropKind.GiantTree, { hw: 1.43, hd: 1.31 }],
  [PropKind.Sign, { hw: 0.35, hd: 0.04 }],
  [PropKind.Stall, { hw: 0.9, hd: 0.54 }],
  [PropKind.ChurchPlains, { hw: 1.4, hd: 1.16 }],
  [PropKind.ChurchForest, { hw: 1.4, hd: 1.16 }],
  [PropKind.ChurchDesert, { hw: 1.4, hd: 1.16 }],
  [PropKind.ChurchSwamp, { hw: 1.4, hd: 1.16 }],
  [PropKind.ChurchMountain, { hw: 1.4, hd: 1.16 }],
  [PropKind.ChurchSnow, { hw: 1.4, hd: 1.16 }],
  [PropKind.Signpost, { hw: 0.7, hd: 0.35 }],
  [PropKind.CaveMouth, { hw: 1.9, hd: 2.33 }],
  [PropKind.Shipwreck, { hw: 2.63, hd: 1.01 }],
  [PropKind.NoticeBoard, { hw: 0.1, hd: 0.8 }],
  [PropKind.HouseFrame, { hw: 1.93, hd: 1.55 }],
  [PropKind.HouseRoof, { hw: 1.26, hd: 1.2 }],
  [PropKind.HouseYours, { hw: 1.26, hd: 1.26 }],
  [PropKind.Fence, { hw: 0.06, hd: 0.56 }],
  [PropKind.TallHousePlains, { hw: 1.26, hd: 1.26 }],
  [PropKind.TallHouseForest, { hw: 1.26, hd: 1.26 }],
  [PropKind.TallHouseDesert, { hw: 1.26, hd: 1.26 }],
  [PropKind.TallHouseSwamp, { hw: 1.26, hd: 1.26 }],
  [PropKind.TallHouseMountain, { hw: 1.26, hd: 1.26 }],
  [PropKind.TallHouseSnow, { hw: 1.26, hd: 1.26 }],
  [PropKind.Sauna, { hw: 1.26, hd: 1 }],
]);
