import { tileCentre, type SortedTiles } from './chunkspots';
import {
  BIOME_ANIMALS, BIOME_HUNTERS, DEEP_ANIMALS, HIGHLAND_ANIMALS, NIGHT_PREDATORS, WATER_ANIMALS,
  openGround, pickKind,
} from './spawns';
import { SPAWN } from './spawning';
import { dangerAt } from '../world/character';
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
  /**
   * How far the nearest village middle is from a point, in tiles.
   *
   * Only the travellers ask. A traveller is somebody *between* places, and a chunk with a road
   * through it is a chunk with a road through it whether or not there is a town on top of it — so
   * every chunk around a village was rolling for wanderers and the square filled up with them. Six
   * at Stoneton, on top of its own people, which is most of what "twenty villagers and two houses"
   * turned out to be.
   */
  awayFromVillages: (x: number, z: number) => number;
  /** A herd of a kind's natural size around an anchor. */
  herd: (ctx: SpawnCtx, kindId: string, anchor: [number, number], leash: number) => Herd;
  place: (
    ctx: SpawnCtx, kindId: string, anchor: [number, number], count: number, leash: number,
    scatter?: number, bodyFor?: (n: number) => string,
  ) => Herd;
}

/**
 * How close to a village a traveller may be put down, in tiles.
 *
 * Outside the village and its fields rather than merely outside its houses: a wanderer who appears
 * at the end of the street has not travelled anywhere, and the point of them is the road.
 */
const NOT_AT_A_VILLAGE = 40;

/**
 * How much of a province's temper a night is allowed to carry.
 *
 * The danger of a place is a number between nought and one (`world/character.ts`), and this is what
 * it buys: at its worst a bad county has something out after dark about half again as often as a
 * quiet one, and in daylight one herd in that many is drawn from the half of the local list that
 * bites. Deliberately modest — a province you cannot cross is not a province, it is a wall — and
 * deliberately felt, because a player who walks three counties should be able to say which one they
 * would rather camp in.
 */
export const TEMPER = {
  /** What the worst province multiplies the chance of a night pack by. */
  NIGHTS: 1.6,
  /** And how often one of its daytime herds is something with teeth, at its worst. */
  TEETH: 0.5,
} as const;

/** Land herds, water herds, whatever hunts after dark, and the odd traveller on the road. */
export function spawnWildlife(o: Wilds, ctx: SpawnCtx, sorted: SortedTiles): void {
  const { tiles, rng } = ctx;
  /*
   * What this county is like, which is a fact about the place rather than about the player.
   *
   * One hash against the dozens of noise samples this chunk has already taken, blended across the
   * boundaries so that the frontier between a quiet province and a bad one is a stretch of country
   * rather than a line in the grass — see `dangerAt`. A world with nothing to ask gets the middle
   * of the scale, which is the country as it was before provinces had tempers.
   */
  const here = tileCentre(tiles, sorted.land[0] ?? sorted.water[0] ?? 0);
  const danger = dangerAt(ctx.seed, here[0], here[1]);
  // after dark, something else is out on the land — and more often where the land has a name for it
  if (o.night && sorted.land.length >= SPAWN.MIN_LAND_TILES
    && rng() < SPAWN.NIGHT_PACK_CHANCE * (1 + danger * (TEMPER.NIGHTS - 1))) {
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
      // and in daylight the same country keeps more of what bites, which is what a bad province is:
      // the wood is the same wood, and there are more wolves in it
      const teeth = rng() < danger * TEMPER.TEETH && BIOME_HUNTERS[sorted.biome].length > 0;
      const table = o.highland(spot[0], spot[1]) ? HIGHLAND_ANIMALS
        : teeth ? BIOME_HUNTERS[sorted.biome] : BIOME_ANIMALS[sorted.biome];
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
    const on = tileCentre(tiles, sorted.road[Math.floor(rng() * sorted.road.length)]);
    // the road between places, not the square at the end of it: a village has its own people, and
    // whoever is passing through can be met on the way in
    if (o.awayFromVillages(on[0], on[1]) > NOT_AT_A_VILLAGE) {
      o.place(ctx, 'traveller', on, 1 + Math.floor(rng() * 2), SPAWN.TRAVELLER_LEASH);
    }
  }
}
