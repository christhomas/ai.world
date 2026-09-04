import { hashString, mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Biome } from '../world/biomes';
import type { Village } from '../world/structures';
import { TileType, type TileSample } from '../world/terrain';

/**
 * Stables, and the three animals a village will sell you.
 *
 * One mount that is simply faster than walking is a purchase you make once and never think about
 * again. Three that are each quickest over different country is a decision you keep making, and
 * one you can only make well by knowing where you are going: a camel is wasted on a road and a
 * horse is wasted on a dune. So a breed is nothing but a price and a table of paces, and where
 * they differ is the whole of what distinguishes them. No branch anywhere asks what animal this
 * is; it asks the table what this animal does here.
 *
 * The decision worth explaining is that whether a village keeps a stable at all is derived from
 * the world seed and the village's own name rather than stored. It is a fact about the place, the
 * way its pub and its metal are, so two players who have never spoken ride out of the same square
 * on the same kind of animal and nothing has to travel between them. It also means the map has a
 * shape worth learning: the camels are where the sand is, and you go there for one.
 */

export const STABLE = {
  /** Roofs a village needs before anybody in it keeps other people's animals for a living. */
  HOUSES: 5,
  /** Of the villages big enough for one, the share that actually runs a stable. */
  SHARE: 0.55,
  /** Terraces above the road at which ordinary ground stops being ground and starts being a climb. */
  ROUGH_RISE: 2,
  /** What you make on your own two feet, which is what every pace below is a multiple of. */
  ON_FOOT: 1,
} as const;

/**
 * What is underfoot, as far as anything with hooves cares. Four kinds, because four is what the
 * breeds actually differ over: made ground, ordinary ground, sand, and ground that is more of a
 * climb than a walk.
 */
export type Going = 'road' | 'open' | 'sand' | 'rough';

/** Tiles somebody laid deliberately. A bridge and a quay ride like the road they continue. */
const MADE: ReadonlySet<TileType> = new Set<TileType>([
  TileType.Road, TileType.Bridge, TileType.Plaza, TileType.Pier,
]);

/** One kind of mount: what it costs, how it sits, and what it is worth over each sort of country. */
export interface Breed {
  /** Also its id in the animal catalogue, so a stable's stock is drawn with a rig that exists. */
  id: string;
  label: string;
  /** What the stablehand asks for it. */
  price: number;
  /** How high the saddle sits above the animal's feet. */
  saddle: number;
  /** Multiplier on the hero's walking speed over each kind of going. */
  pace: Record<Going, number>;
  /** What the stablehand tells you it is for, which is the only sales pitch that is also true. */
  note: string;
}

/**
 * The three of them. Every number here is a claim about where the animal earns its price, and no
 * breed is best everywhere: the horse gives up the sand and the heights for the road, the camel
 * gives up the road for the sand, and the goat is never the quickest until the ground breaks up.
 */
export const BREEDS: Record<string, Breed> = {
  goat: {
    id: 'goat', label: 'Mountain Goat', price: 90, saddle: 0.62,
    pace: { road: 1.5, open: 1.7, sand: 1.3, rough: 2.2 },
    note: 'Sure-footed where there is no ground worth the name. Nothing else will take you up there.',
  },
  horse: {
    id: 'horse', label: 'Riding Horse', price: 140, saddle: 0.98,
    pace: { road: 2.6, open: 2.1, sand: 1.5, rough: 1.2 },
    note: 'The quickest thing alive on a made road, and it does want a made road.',
  },
  camel: {
    id: 'camel', label: 'Desert Camel', price: 170, saddle: 1.24,
    pace: { road: 1.8, open: 1.8, sand: 2.4, rough: 1.4 },
    note: 'Made for the sand and unimpressed by everywhere else. Out there it is the only thing that matters.',
  },
};

/**
 * What each country's stables keep. A village sells what the country round it rides, which is why
 * you go to the desert for a camel rather than shopping for one at home.
 */
const KEEPS: Record<Biome, string[]> = {
  [Biome.Plains]: ['horse', 'goat'],
  [Biome.Forest]: ['horse', 'goat'],
  [Biome.Desert]: ['camel', 'horse'],
  [Biome.Swamp]: ['goat', 'horse'],
  [Biome.Mountain]: ['goat', 'horse'],
  [Biome.Snow]: ['goat', 'horse'],
};

/** A village's stable: whose it is, and what is standing in the stalls. */
export interface Stable {
  village: string;
  biome: Biome;
  /** In the stalls, the country's own animal first. */
  stock: Breed[];
}

/** Read a sampled tile the way something with hooves reads it. */
export function goingOf(tile: Pick<TileSample, 'type' | 'level' | 'base'>): Going {
  if (MADE.has(tile.type)) return 'road';
  if (tile.type === TileType.Sand) return 'sand';
  if (tile.type === TileType.High) return 'rough';
  // bare rock is not the only broken ground: anything standing well above its road is a scramble
  return tile.level - tile.base >= STABLE.ROUGH_RISE ? 'rough' : 'open';
}

/** How fast this breed carries you over this going, and how fast you walk with no breed at all. */
export function paceOf(breed: Breed | null, going: Going): number {
  return breed ? breed.pace[going] : STABLE.ON_FOOT;
}

/** The breed a stablehand would point at for this going, which is what makes the choice a choice. */
export function bestOver(going: Going): Breed {
  return Object.values(BREEDS).reduce((best, breed) => (breed.pace[going] > best.pace[going] ? breed : best));
}

/**
 * The breed a save is talking about. A save written when there was only one animal in the world
 * names none, and what it meant was a horse.
 */
export function breedOf(id: string | null | undefined): Breed {
  return (id && BREEDS[id]) || BREEDS.horse;
}

/**
 * The stable in a village, or null where there is not one. Pure in (village, seed), so the same
 * square answers the same way on every machine and for the life of the world.
 *
 * A stable needs animals in it that are not yours, which needs a village with enough people to
 * have spare ground and somebody idle enough to muck it out; below that many roofs nobody keeps
 * one, however the roll falls.
 */
export function stableAt(village: Village, seed: number): Stable | null {
  if (village.houses.length < STABLE.HOUSES) return null;
  // the name is mixed in under a label of its own, so whether there is a stable here cannot shift
  // because some other feature keyed on this village started asking its stream for one more number
  const roll = mulberry32(derive(seed ^ hashString(`stable:${village.name}`), SALT.STRUCTURES));
  if (roll() >= STABLE.SHARE) return null;
  return {
    village: village.name,
    biome: village.biome,
    stock: KEEPS[village.biome].map((id) => BREEDS[id]),
  };
}
