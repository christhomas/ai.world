import spawning from '../../properties/spawning.json';
import { Biome } from '../world/biomes';
import { Fields, asText } from '../core/properties';
import type { TileWorld } from './entity';
import { tileCentre } from './chunkspots';
import type { ChunkTiles } from '../world/tiles';

/**
 * What lives where, read out of `properties/spawning.json`.
 *
 * Kept apart from animals.ts because it answers a different question. That file says what a
 * creature *is* — its rig, its pace, how hard it hits; this one says where you meet it, which is
 * a fact about the world rather than about the animal. They change for different reasons and at
 * different times.
 *
 * A weighted table is written in the file as names against shares, which is how anybody would
 * write one down, and turned into a list here. The list keeps the order the file was written in,
 * and that order is load-bearing: `pickKind` walks it, so the same roll in the same chunk lands on
 * whichever kind the order puts it on. Reordering a table is a different world, not a tidy-up.
 */

export interface SpawnWeight { kind: string; weight: number }

/** The names the file uses for the six countries; the game holds a biome as a number. */
const COUNTRIES: ReadonlyArray<readonly [string, Biome]> = [
  ['plains', Biome.Plains],
  ['forest', Biome.Forest],
  ['desert', Biome.Desert],
  ['swamp', Biome.Swamp],
  ['mountain', Biome.Mountain],
  ['snow', Biome.Snow],
];

const file = new Fields('properties/spawning.json', spawning);
const countries = file.group('biomes');

/** One table of names against shares, in the order the file wrote them, which is the order that decides. */
function weights(table: Fields): SpawnWeight[] {
  return table.keys().map((kind) => ({ kind, weight: table.num(kind) }));
}

/** The same table read for each of the six, so a country nobody filled in is an error rather than an empty field. */
function perCountry<T>(read: (country: Fields) => T): Record<Biome, T> {
  const out = {} as Record<Biome, T>;
  for (const [name, biome] of COUNTRIES) out[biome] = read(countries.group(name));
  return out;
}

/** Herd kinds per biome, on land. */
export const BIOME_ANIMALS: Record<Biome, SpawnWeight[]> = perCountry((country) => weights(country.group('land')));

/** Kinds that spawn on water tiles instead of land. */
export const WATER_ANIMALS: Record<Biome, SpawnWeight[]> = perCountry((country) => weights(country.group('water')));

/** Extra packs that only come out after dark, per biome. Picked flat, so names and no shares. */
export const NIGHT_PREDATORS: Record<Biome, string[]> = perCountry((country) => country.list('night', asText));

/** What waits underground, by how far down you are. One entry per floor, counting from one. */
const DUNGEON_BANDS: ReadonlyArray<readonly SpawnWeight[]> =
  file.group('dungeon').list('floors', (floor, where) => weights(new Fields(where, floor)));

/** What lives on a floor. Anything deeper than the table goes holds whatever the bottom holds. */
export function dungeonMonsters(floor: number): readonly SpawnWeight[] {
  const band = Math.min(Math.max(1, Math.floor(floor)), DUNGEON_BANDS.length);
  return DUNGEON_BANDS[band - 1];
}

/** The shallow band: every cave, and the floor of a vault you arrive on. */
export const DUNGEON_MONSTERS: readonly SpawnWeight[] = dungeonMonsters(1);

/** What lives above the treeline, on and around a massif. */
export const HIGHLAND_ANIMALS: readonly SpawnWeight[] = weights(file.group('highland').group('kinds'));

/** What a pack in open water turns out to be: nothing else spawns out there at all. */
export const DEEP_ANIMALS: readonly SpawnWeight[] = weights(file.group('deep').group('kinds'));

export function pickKind(list: readonly SpawnWeight[], r: number): string | null {
  if (list.length === 0) return null;
  let total = 0;
  for (const p of list) total += p.weight;
  let t = r * total;
  for (const p of list) {
    t -= p.weight;
    if (t <= 0) return p.kind;
  }
  return list[list.length - 1].kind;
}


/**
 * A tile in a chunk with the sky over it, or nothing if the chunk is all mountain.
 *
 * A polygon world's mountains stand on the ground rather than in it, so a tile under one reads as
 * ordinary land to everything that looks at the heightfield — and a herd put there is either inside
 * a cliff or clinging to the outside of one. A few tries rather than a filtered list, because the
 * buried tiles are a small share of a chunk and only in the chunks that have any at all.
 */
export function openGround(
  world: TileWorld, tiles: ChunkTiles, land: number[], rng: () => number,
): [number, number] | null {
  for (let tries = 0; tries < 5; tries++) {
    const spot = tileCentre(tiles, land[Math.floor(rng() * land.length)]);
    if (!world.buried?.(spot[0], spot[1])) return spot;
  }
  return null;
}
