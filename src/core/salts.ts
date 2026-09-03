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
  INTERIOR: 0x1de5,
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
} as const;

/** Seed for a named stream. */
export function derive(seed: number, salt: number): number {
  return (seed ^ salt) >>> 0;
}
