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

/**
 * A tile something waits on, and what it is where whoever laid the floor gets to say.
 *
 * Two tiles is a spot to be rolled for: a hole in the ground names nothing, and what you meet on
 * its second floor is whatever the second band of the table holds. Three is a spot that has
 * already been decided — a castle's chapel keeps a wight, and it keeps the same wight on the
 * fortieth visit as on the first and for everybody at once, which is the argument `game/haunts.ts`
 * makes about anything that keeps a place. There is no other way for a floor to make that claim:
 * the roll is the only thing that decides what stands underground, so a floor that means something
 * particular has to say so here.
 *
 * A named spot draws nothing from the random stream in `spawnMonsters`, and that is deliberate
 * rather than incidental. Drawing a roll and throwing it away would shift every spot after it, so
 * one castle naming one of its chapels would quietly rebuild every vault, cave and thicket in
 * every world anybody had ever saved.
 */
export type SpawnSpot = readonly [number, number] | readonly [number, number, string];

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

/**
 * What is waiting in a flooded hold.
 *
 * Not a band of the table above, because a drowned place is not a deep place: a wreck is one room
 * deep and the only room there is, so it has a roster of its own rather than a rung on a ladder.
 */
export const DROWNED_MONSTERS: readonly SpawnWeight[] = weights(file.group('drowned').group('kinds'));

/**
 * What lives on a floor. Anything deeper than the table goes holds whatever the bottom holds.
 *
 * The style is asked for as well as the depth, because the two questions are different: how far
 * down you are says how hard it should be, and what sort of place it is says what could possibly
 * live there. Everything but a drowned hold answers by depth alone, which is how it has always
 * worked, and a drowned hold answers by what it is.
 */
export function dungeonMonsters(floor: number, style?: string): readonly SpawnWeight[] {
  if (style === 'sunken') return DROWNED_MONSTERS;
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
    // not under a mountain, and not where people live: a village's streets are ordinary ground and
    // went into this pool like any field, so packs were being laid down in the middle of towns
    if (!world.buried?.(spot[0], spot[1]) && !world.peopled?.(spot[0], spot[1])) return spot;
  }
  return null;
}
