/**
 * Every random stream in the world is derived from the world seed XOR a salt, so streams never
 * accidentally share values. All salts live here so it is obvious which stream is which and no
 * two features pick the same one by accident.
 */
export const SALT = {
  ROAD_RNG: 0xa5a5a5a5,      // road-tree growth jitter, loops, town picks
  ROAD_MASK: 0x51ed,         // noise that leaves empty bays in the attractor field
  BIOME: 0x7e7e,             // sector warp; also road node levels (shared so levels follow sectors)
  TERRAIN: 0x3333,           // land width, hills, lake edges
  RIVER_RNG: 0x8ebe,
  RIVER_MEANDER: 0x2222,
  STRUCTURES: 0x5a5a5a,
  QUESTS: 0x9ee5,
  HERDS: 0xbeef,             // creature behaviour randomness
  HERD_CHUNK: 4242,          // per-chunk herd spawn rolls (hash3 salt)
  DIALOGUE: 0x1eaf,
  ISLAND: 0x15a4d,           // island anchors and their road trees
  DUNGEON: 0xd4e6,           // dungeon anchors and their layouts
  FERRY: 0xfe44,
  CAVE: 0xca7e,
  WRECK: 0x0e3c,
  WHALE: 0x7a1e,
  HUNT: 0x5aa4,
  INTERIOR: 0x1de5,
  PEOPLE: 0x9e0b,           // the families a village is founded with
  FOREST: 0x2f00,           // which trees are worth felling, and what a stand grows back to
  HERBS: 0x8e2b,            // where the plants a draught needs are growing
  HAUNT: 0xd0a7,            // where the things that are not animals keep to
  CAMP: 0xca43,             // whether a night in the open passes quietly
} as const;

/** Per-tile hash salts (rand2 / hash3 fourth argument). */
export const TILE_SALT = {
  GROUND_VARIANT: 3,
  BIOME_DITHER: 5,
  PROP_ROLL: 7,
  PROP_KIND: 8,
  SHADE: 11,
  PROP_X: 21,
  PROP_Z: 22,
  PROP_ROT: 23,
  PROP_SCALE: 24,
  PROP_STRETCH: 25,
  PROP_LEAN: 26,
  PROP_TINT: 27,
  DIG_SEAM: 31,        // what a tile of ground holds for anybody who digs it
} as const;

/** Seed for a named stream. */
export function derive(seed: number, salt: number): number {
  return (seed ^ salt) >>> 0;
}
