import { tileCentre, type SortedTiles } from './chunkspots';
import {
  BIOME_ANIMALS, DEEP_ANIMALS, HIGHLAND_ANIMALS, NIGHT_PREDATORS, WATER_ANIMALS, openGround, pickKind,
} from './spawns';
import { SPAWN } from './spawning';
import type { Herd, TileWorld } from './entity';
import type { SpawnCtx } from './manager';

/**
 * What a square of open country has living on it.
 *
 * The third of the three, and the last one still inside the manager. `street.ts` is who a village
 * has out of doors and `paddocks.ts` is what it keeps in its yard; both came out because they are
 * about a *place* rather than about a roll of the day, and this is the other half of that sentence:
 * everything here is a roll, and none of it is about anywhere in particular. A chunk offers land,
 * water and road, and what turns up on each is chance against a table.
 *
 * It matters that the two halves are separable, and not only for the length of a file. The people of
 * a village and the animals in the fields moved to the world at different times and for different
 * reasons, and for a long stretch this ran on every client while the herds beside it did not.
 * Neither of them decides that any more — a client being told what lives here spawns nothing at all
 * — but the argument for each is still its own argument, and it reads better where each is written.
 */

/** What this needs of the manager: the ground, the hour, and the two ways of standing things up. */
export interface Wilds {
  world: TileWorld;
  /** Whether this chunk is being filled after dark, which is a different table of animals. */
  night: boolean;
  /**
   * Whether a point is high country — on a massif or against its flank.
   *
   * Asked rather than worked out, because what counts as a mountain belongs to the world's
   * generator and this only wants to know which list to spawn from.
   */
  highland: (x: number, z: number) => boolean;
  /** A herd of a kind's natural size around an anchor. */
  herd: (ctx: SpawnCtx, kindId: string, anchor: [number, number], leash: number) => Herd;
  place: (
    ctx: SpawnCtx, kindId: string, anchor: [number, number], count: number, leash: number,
    scatter?: number, bodyFor?: (n: number) => string,
  ) => Herd;
}

/** Land herds, water herds, whatever hunts after dark, and the odd traveller on the road. */
export function spawnWildlife(o: Wilds, ctx: SpawnCtx, sorted: SortedTiles): void {
  const { tiles, rng } = ctx;
  // after dark, something else is out on the land
  if (o.night && sorted.land.length >= SPAWN.MIN_LAND_TILES && rng() < SPAWN.NIGHT_PACK_CHANCE) {
    const table = NIGHT_PREDATORS[sorted.biome];
    const kindId = table[Math.floor(rng() * table.length)];
    const den = openGround(o.world, tiles, sorted.land, rng);
    if (den) o.herd(ctx, kindId, den, SPAWN.NIGHT_LEASH);
  }
  if (sorted.land.length >= SPAWN.MIN_LAND_TILES) {
    const rolls = rng() < SPAWN.HERD_CHANCE ? (rng() < SPAWN.SECOND_HERD_CHANCE ? 2 : 1) : 0;
    for (let h = 0; h < rolls; h++) {
      // high ground has its own list: a massif can stand in any country, so what decides what
      // lives here is the height rather than the biome the map happens to call it
      const spot = openGround(o.world, tiles, sorted.land, rng);
      if (!spot) break;
      const table = o.highland(spot[0], spot[1]) ? HIGHLAND_ANIMALS : BIOME_ANIMALS[sorted.biome];
      const kindId = pickKind(table, rng());
      if (!kindId) break;
      o.herd(ctx, kindId, spot, SPAWN.HERD_LEASH);
    }
  }
  if (sorted.water.length >= SPAWN.MIN_WATER_TILES && rng() < SPAWN.WATER_HERD_CHANCE) {
    const kindId = pickKind(WATER_ANIMALS[sorted.biome], rng());
    if (kindId) o.herd(ctx, kindId, tileCentre(tiles, sorted.water[Math.floor(rng() * sorted.water.length)]), SPAWN.WATER_LEASH);
  }
  // nothing but water in this chunk means open sea, where something else is waiting
  if (sorted.land.length === 0 && sorted.water.length >= SPAWN.MIN_WATER_TILES && rng() < SPAWN.DEEP_PACK_CHANCE) {
    const hunter = pickKind(DEEP_ANIMALS, rng());
    if (hunter) o.herd(ctx, hunter, tileCentre(tiles, sorted.water[Math.floor(rng() * sorted.water.length)]), SPAWN.DEEP_LEASH);
  }
  if (sorted.road.length >= SPAWN.MIN_ROAD_TILES && rng() < SPAWN.TRAVELLER_CHANCE) {
    o.place(ctx, 'traveller', tileCentre(tiles, sorted.road[Math.floor(rng() * sorted.road.length)]), 1 + Math.floor(rng() * 2), SPAWN.TRAVELLER_LEASH);
  }
}
