import spawning from '../../properties/spawning.json';
import { Fields } from '../core/properties';

/**
 * The dials on how much of the world is alive at once, and what the law is paid.
 *
 * The numbers are in `properties/spawning.json` with the argument for each beside it; what is
 * here is the reading of them, and the shape the game holds them in. They are apart from the
 * manager that uses them for the reason they were always apart: a table of odds is the sort of
 * thing somebody comes looking for on its own, and is read far more often than the code around it.
 *
 * Who lives where is in the same file and read by `spawns.ts`, which is the other half of the
 * question: this one is how many and how far, that one is which.
 */

const file = new Fields('properties/spawning.json', spawning);
const reach = file.group('reach');
const herds = file.group('herds');
const water = file.group('water');
const roads = file.group('roads');
const village = file.group('village');
const night = file.group('night');
const bounty = file.group('bounty');

/** Chunks around a player that get creatures. */
export const SPAWN_RADIUS: number = reach.num('SPAWN_RADIUS');

/** Tiles: beyond this from anybody, creatures freeze rather than being thought for. */
export const ACTIVE_RANGE: number = reach.num('ACTIVE_RANGE');

/**
 * Tiles: beyond this from anybody, a creature is on no list at all.
 *
 * The difference between the two is the whole of what freezing buys. Inside `ACTIVE_RANGE` a
 * creature is thought for. Between the two it is not thought for but is still a body the separation
 * sweep holds apart and still a row every player is told about, because a player can see further
 * than a creature is thought from — so it stands still, exactly as it always has. Outside this it
 * is off both of those lists, and the only thing that ever picks it up again is the ground handing
 * its chunk back, at which point `catchUp` puts it where the time away would have left it.
 *
 * Too small and creatures drop off a player's screen while they are watching them, which is why
 * this must stay wider than `IN_SIGHT` in `server/wildlife.ts` and why a test says so rather than a
 * comment. Too large and it is `ACTIVE_RANGE` again with extra words: the band it takes off the
 * lists is all the country between here and the edge of what the world is holding, which at a spawn
 * radius of four chunks is about half of everything spawned.
 */
export const WATCH_RANGE: number = reach.num('WATCH_RANGE');

/** What the law is paid, as a share of a bounty and as flat coin for an arrest. */
export interface BountyRates {
  RESCUE_SHARE: number;
  ARREST: number;
  ARREST_WORST: number;
}

export const BOUNTY: BountyRates = {
  RESCUE_SHARE: bounty.num('RESCUE_SHARE'),
  ARREST: bounty.num('ARREST'),
  ARREST_WORST: bounty.num('ARREST_WORST'),
};

/** Spawn odds and sizes. Chances are per chunk, leashes in tiles. */
export interface SpawnDials {
  MIN_LAND_TILES: number;
  HERD_CHANCE: number;
  SECOND_HERD_CHANCE: number;
  HERD_LEASH: number;
  MIN_WATER_TILES: number;
  WATER_HERD_CHANCE: number;
  DEEP_PACK_CHANCE: number;
  DEEP_LEASH: number;
  WATER_LEASH: number;
  MIN_ROAD_TILES: number;
  TRAVELLER_CHANCE: number;
  TRAVELLER_LEASH: number;
  CONGREGATION_LEASH: number;
  SHOPKEEPER_LEASH: number;
  PLACE_ATTEMPTS: number;
  SCATTER: number;
  FLIER_RING: number;
  NIGHT_PACK_CHANCE: number;
  NIGHT_LEASH: number;
}

export const SPAWN: SpawnDials = {
  MIN_LAND_TILES: herds.num('MIN_LAND_TILES'),
  HERD_CHANCE: herds.num('HERD_CHANCE'),
  SECOND_HERD_CHANCE: herds.num('SECOND_HERD_CHANCE'),
  HERD_LEASH: herds.num('HERD_LEASH'),
  MIN_WATER_TILES: water.num('MIN_WATER_TILES'),
  WATER_HERD_CHANCE: water.num('WATER_HERD_CHANCE'),
  DEEP_PACK_CHANCE: water.num('DEEP_PACK_CHANCE'),
  DEEP_LEASH: water.num('DEEP_LEASH'),
  WATER_LEASH: water.num('WATER_LEASH'),
  MIN_ROAD_TILES: roads.num('MIN_ROAD_TILES'),
  TRAVELLER_CHANCE: roads.num('TRAVELLER_CHANCE'),
  TRAVELLER_LEASH: roads.num('TRAVELLER_LEASH'),
  CONGREGATION_LEASH: village.num('CONGREGATION_LEASH'),
  SHOPKEEPER_LEASH: village.num('SHOPKEEPER_LEASH'),
  PLACE_ATTEMPTS: herds.num('PLACE_ATTEMPTS'),
  SCATTER: herds.num('SCATTER'),
  FLIER_RING: herds.num('FLIER_RING'),
  NIGHT_PACK_CHANCE: night.num('NIGHT_PACK_CHANCE'),
  NIGHT_LEASH: night.num('NIGHT_LEASH'),
};
