import { hash3, mulberry32, rand2 } from '../core/rng';
import { SALT, TILE_SALT } from '../core/salts';
import { BIOMES, Biome, PropKind, pickWeighted } from '../world/biomes';
import { TileType, type TileSample } from '../world/terrain';

/**
 * Woodcraft: a saw, a stand of trees, the fire they make, and what a fire is for.
 *
 * Which tile carries a tree worth felling is rolled from the world seed and the tile's own
 * coordinates, the way digging rolls what is buried under one, so two players who have never
 * spoken cut the same wood on the same hillside and nothing has to travel between them.
 *
 * The decision worth explaining is that this rolls the world's own prop dice a second time rather
 * than asking the loaded chunk what it drew. A saw then finds a tree exactly where one is
 * standing, in a chunk nobody has streamed, on a machine that never drew it: what is fellable
 * stays a fact about the world instead of a fact about what happens to be on screen.
 *
 * A wood, unlike a hillside, comes back. That is the one thing here worth remembering, so a felled
 * stand is kept with the day it came down and forgotten again as soon as it has grown.
 */

export const WOOD = {
  /** Share of the trees in a wood that are grown enough to be worth the saw. The rest are whips. */
  MATURE: 0.55,
  /** Logs a felled tree makes: one, up to this many. */
  LOGS: 3,
  /** Days a stump takes to be a tree again. Longer than any crop, so a wood is not a field. */
  REGROW: 8,
  /** Stumps one sitting remembers. Beyond it the oldest goes, so a long walk does not grow without end. */
  STUMPS: 512,
  /** How close a tile must be to be within a saw's reach, in tiles. */
  REACH: 1.8,
  /**
   * How wide a verge the road keeps clear of props. It matches the shoulder terrain leaves when it
   * draws them; the two are kept in step by hand, because terrain does not export the number.
   */
  VERGE: 1.2,
  /** Logs it takes to get a fire going. */
  FIRE_LOGS: 1,
  /** How long a fire burns, as a fraction of a day: about a quarter of an hour of world time. */
  BURN: 0.05,
  /** How close you must stand to cook at your fire, in tiles. */
  FIRE_REACH: 2.4,
  /** Wood a village market must take in before its wright has a cart to sell. */
  CART_WOOD: 40,
  /** What the finished cart costs, once there is one. */
  CART_PRICE: 120,
  /** How much better a horse does with the cart behind it: the load is on wheels rather than its back. */
  CART_HAUL: 1.3,
} as const;

/**
 * Trees a saw is for. Deadwood and cactus are left out on purpose: a plank comes off green timber,
 * and it is that rule, not a special case, which keeps the desert out of the wood trade, since the
 * only trunks the dunes grow are dead ones.
 */
const TIMBER: ReadonlySet<PropKind> = new Set<PropKind>([
  PropKind.Oak, PropKind.Pine, PropKind.SnowPine, PropKind.Willow,
  PropKind.Birch, PropKind.Fir, PropKind.Blossom,
]);

/** What each tree is called, so a felling reads as the tree that fell rather than a number. */
const TIMBER_NAMES: Partial<Record<PropKind, string>> = {
  [PropKind.Oak]: 'oak',
  [PropKind.Pine]: 'pine',
  [PropKind.SnowPine]: 'snow pine',
  [PropKind.Willow]: 'willow',
  [PropKind.Birch]: 'birch',
  [PropKind.Fir]: 'fir',
  [PropKind.Blossom]: 'blossom tree',
};

/** What a fire turns things into. A table rather than a rule, because cooking is a short list. */
export const OVER_FIRE: Record<string, string> = {
  meat: 'roast',
};

/** What felling cares about at a tile: the country, and whether timber can root there at all. */
export interface Stand {
  biome: Biome;
  /** Ordinary ground, off the verge. Rock, sand, riverbank, road and water grow no timber. */
  rooted: boolean;
}

/** What came off the tree. */
export interface Cut {
  /** Item id: cut wood, which a market will take. */
  item: string;
  count: number;
}

/** What a fire needs before it will catch. */
export interface Tinder {
  /** Logs the fire-lighter is carrying. */
  logs: number;
  /** Whether they have fire rocks to strike. */
  kindling: boolean;
  /** Rain puts a fire out well before it is a fire. */
  wet?: boolean;
}

const key = (tx: number, tz: number): string => `${Math.floor(tx)},${Math.floor(tz)}`;

/** Tiles a tree stands on: plain ground of either shade, never rock, sand, bank, road or water. */
function growsTrees(type: TileType): boolean {
  return type === TileType.Ground || type === TileType.GroundAlt;
}

/** Read a sampled tile the way somebody carrying a saw reads it. */
export function standOf(
  tile: Pick<TileSample, 'type' | 'biome' | 'bank' | 'roadDist' | 'roadWidth'>,
): Stand {
  return {
    biome: tile.biome,
    rooted: growsTrees(tile.type) && !tile.bank && tile.roadDist >= tile.roadWidth + WOOD.VERGE,
  };
}

/**
 * The tree standing on this tile, or None. These are the same dice the world rolls when it draws
 * a chunk, so this answers for country nobody has looked at yet; anything a saw will not take
 * reads as None, which is why a desert full of dead trunks has nothing to fell.
 */
export function timberAt(seed: number, tx: number, tz: number, stand: Stand): PropKind {
  if (!stand.rooted) return PropKind.None;
  const def = BIOMES[stand.biome];
  const x = Math.floor(tx), z = Math.floor(tz);
  if (rand2(seed, x, z, TILE_SALT.PROP_ROLL) >= def.propDensity) return PropKind.None;
  const kind = pickWeighted(def.props, rand2(seed, x, z, TILE_SALT.PROP_KIND));
  return TIMBER.has(kind) ? kind : PropKind.None;
}

/** What to call a tree out loud. */
export function treeName(kind: PropKind): string {
  return TIMBER_NAMES[kind] ?? 'tree';
}

/**
 * What one tile gives a feller: nothing, or the wood off the tree standing on it. Pure in
 * (seed, tile), so the same stand answers the same way on every machine and for the life of the
 * world. A tree may stand and still give nothing, because not every tree in a wood is timber yet.
 */
export function fellingAt(seed: number, tx: number, tz: number, stand: Stand): Cut | null {
  if (timberAt(seed, tx, tz, stand) === PropKind.None) return null;
  const roll = mulberry32(hash3(seed, Math.floor(tx), Math.floor(tz), SALT.FOREST));
  if (roll() >= WOOD.MATURE) return null;
  return { item: 'wood', count: 1 + Math.floor(roll() * WOOD.LOGS) };
}

/**
 * The stands cut this sitting, each with the day it came down.
 *
 * Local and unsaved, like the holes a digger remembers and for the same reason: what a tile
 * carries can be worked out again from the seed, so the only thing worth holding is which trees
 * are stumps at this moment, and for how much longer.
 */
export class Felling {
  private readonly stumps = new Map<string, number>();

  /** Is there a tree here today, or a stump still coming back? */
  standing(tx: number, tz: number, day: number): boolean {
    const cut = this.stumps.get(key(tx, tz));
    return cut === undefined || day - cut >= WOOD.REGROW;
  }

  /** Days until this stand is a tree again, 0 when it already is one. */
  regrowsIn(tx: number, tz: number, day: number): number {
    const cut = this.stumps.get(key(tx, tz));
    if (cut === undefined) return 0;
    return Math.max(0, WOOD.REGROW - (day - cut));
  }

  /**
   * Bring down the tree on this tile. Returns the wood, or null when there is no timber there and
   * when the stand is a stump that has not grown back yet.
   */
  fell(seed: number, tx: number, tz: number, stand: Stand, day: number): Cut | null {
    if (!this.standing(tx, tz, day)) return null;
    const cut = fellingAt(seed, tx, tz, stand);
    if (!cut) return null;
    this.stumps.set(key(tx, tz), day);
    this.forget(day);
    return cut;
  }

  /** A stand that has grown back is a tree like any other, so there is nothing left to remember. */
  private forget(day: number): void {
    for (const [at, cut] of this.stumps) if (day - cut >= WOOD.REGROW) this.stumps.delete(at);
    while (this.stumps.size > WOOD.STUMPS) this.stumps.delete(this.stumps.keys().next().value!);
  }
}

/**
 * Your own fire: where it was struck and when.
 *
 * Everything else is a subtraction against the world clock, because a fire counted in seconds
 * would need something to tick it every frame, and the day is already moving on its own.
 */
export class Fire {
  private at: [number, number] | null = null;
  private struck = 0;

  /**
   * Strike the rocks over the wood. Returns false when there is not enough to light it with, or
   * when the weather has beaten you to it.
   */
  light(x: number, z: number, day: number, tinder: Tinder): boolean {
    if (tinder.logs < WOOD.FIRE_LOGS || !tinder.kindling || tinder.wet) return false;
    this.at = [x, z];
    this.struck = day;
    return true;
  }

  /** Is there still a flame on it? */
  burning(day: number): boolean {
    return this.at !== null && day - this.struck < WOOD.BURN;
  }

  /** Close enough to cook at, whether or not it is still alight. */
  near(x: number, z: number): boolean {
    return this.at !== null && Math.hypot(this.at[0] - x, this.at[1] - z) <= WOOD.FIRE_REACH;
  }

  /** Where it is, for anybody who has to draw it, or null when no fire was ever lit. */
  get where(): readonly [number, number] | null {
    return this.at;
  }

  /** What this becomes over the flames: null when the fire is out, or when it is not food. */
  cook(id: string, day: number): string | null {
    if (!this.burning(day)) return null;
    return OVER_FIRE[id] ?? null;
  }
}

/**
 * The cart a market builds.
 *
 * A village that has been sold enough wood puts its wright to work, and what he makes is for sale
 * to whoever brought the wood. It is a pure count so that the tally can live wherever the wood
 * changes hands, and this file stays the one place that decides what the number means.
 */
export function cartBuilt(woodSold: number): boolean {
  return woodSold >= WOOD.CART_WOOD;
}

/** How much more wood the market wants before there is a cart, 0 once there is one. */
export function woodWanted(woodSold: number): number {
  return Math.max(0, WOOD.CART_WOOD - woodSold);
}

/**
 * How fast the hero travels, as a multiple of walking pace. A cart is a horse cart: with nothing
 * in the shafts it is a box on wheels, which is why it only counts while you are mounted.
 */
export function haulPace(horsePace: number, riding: boolean, cart: boolean): number {
  if (!riding) return 1;
  return cart ? horsePace * WOOD.CART_HAUL : horsePace;
}
