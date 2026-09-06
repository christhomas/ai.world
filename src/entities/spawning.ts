import { Biome } from '../world/biomes';

/**
 * The dials on what lives where, and what the law is paid.
 *
 * Numbers rather than behaviour, kept apart from the manager that reads them: a table of odds is
 * the sort of thing somebody comes looking for on its own, and it is read far more often than the
 * code around it is.
 */

/** Chunks around a player that get creatures. */
export const SPAWN_RADIUS = 4;

/** Tiles: beyond this from anybody, creatures freeze rather than being thought for. */
export const ACTIVE_RANGE = 44;

/**
 * What the law is paid. A constable takes the whole bounty for putting down something that was
 * attacking somebody; anybody else who does it — a hunter, a passing farmer — takes a share, which
 * is the difference between doing the job and helping out. Taking in somebody the law wants is the
 * same job on the same purse, priced by how badly it wants them.
 */
export const BOUNTY = {
  RESCUE_SHARE: 0.3,
  /** What taking in anybody the law wants pays, before their crimes are counted. */
  ARREST: 15,
  /** And what the worst of them is worth on top: a constable's own reason to come for you. */
  ARREST_WORST: 45,
} as const;

/** Extra packs that only come out after dark, per biome. */
export const NIGHT_PREDATORS: Record<Biome, string[]> = {
  [Biome.Plains]: ['wolf'],
  [Biome.Forest]: ['wolf', 'bear'],
  [Biome.Desert]: ['bat'],
  [Biome.Swamp]: ['bat', 'wolf'],
  [Biome.Mountain]: ['wolf'],
  [Biome.Snow]: ['wolf'],
};

/** Spawn odds and sizes. Chances are per chunk, leashes in tiles. */
export const SPAWN = {
  MIN_LAND_TILES: 30,
  HERD_CHANCE: 0.6,
  SECOND_HERD_CHANCE: 0.3,
  HERD_LEASH: 12,
  MIN_WATER_TILES: 6,
  WATER_HERD_CHANCE: 0.55,
  /** A chunk with no land in it at all is open sea, and open sea has hunters in it. */
  DEEP_PACK_CHANCE: 0.18,
  DEEP_LEASH: 14,
  WATER_LEASH: 6,
  MIN_ROAD_TILES: 12,
  TRAVELLER_CHANCE: 0.3,
  TRAVELLER_LEASH: 30,
  CONGREGATION_LEASH: 2.5,
  SHOPKEEPER_LEASH: 1.2,
  PLACE_ATTEMPTS: 8,
  SCATTER: 2.2,          // members land within this radius of the anchor
  FLIER_RING: 4,
  NIGHT_PACK_CHANCE: 0.35,
  NIGHT_LEASH: 16,
} as const;
