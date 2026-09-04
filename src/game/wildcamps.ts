import { hash3, mulberry32, type Rng } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { TRADES } from '../entities/trades';
import { Biome } from '../world/biomes';
import { familyName, givenName } from '../world/people';
import { TileType, type TileSample } from '../world/terrain';
import { dangerOf, type Country } from './camp';
import type { Pack } from './remains';

/**
 * Camps other people pitched, and what the night made of them.
 *
 * The villages are sixteen dots in a world nearly a thousand tiles across, so most of the people
 * in it are not in one: they are hunters a week from home, climbers who ran out of daylight,
 * doctors walking to the next village along. Where one of them stopped for the night is rolled
 * from the world seed and the tile, exactly as a buried seam or a herb patch is, so two players
 * who have never spoken walk up to the same tent and nothing has to travel between them.
 *
 * The decision worth explaining is that whether a camp survived is not a roll of its own. It is
 * the same `dangerOf` the player's own night under canvas is rolled from, asked of the ground the
 * camp stands on. So the torn camps are in the wolf woods and the standing ones are in the fields
 * behind a village, without anybody writing that down anywhere: a country that gains a predator
 * gains torn camps in it the same afternoon, and there is no second table to go quietly stale.
 */

export const CAMPS = {
  /** Share of the friendliest roadside ground holding a camp. A world ends up with as many as it has landmarks. */
  BASE: 0.0012,
  /** No ground is ever likelier than this, however kind the wood. A camp you did not have to look for is not worth finding. */
  MOST: 0.01,
  /** Each terrace a tile stands above its road divides the odds again: a ridge is a cold place to lie. */
  PER_TERRACE: 0.5,
  /** Tiles clear of the road surface before anybody would pitch. Nobody sleeps in the ruts. */
  OFF_ROAD: 2,
  /** And no further out than this: a tent is carried along a road, not into trackless country. */
  WITHIN: 10,
  /** Tiles clear of a village's edge. Inside it there is a bed with a door that locks, for ten gold. */
  APART: 12,
  /** Nights a camp has stood there by the time you find it. Each one was another chance for something to come. */
  NIGHTS: 3,
  /** Coins even the poorest traveller has knotted into a corner of the pack. */
  PURSE_LEAST: 4,
  /** And the most on top of that, which is a good evening at an inn rather than a fortune. */
  PURSE: 36,
  /** Share of campers carrying something to swing at whatever wakes them. */
  ARMED: 0.55,
  /** Share carrying the thing they came all the way out here to find. */
  PRIZE: 0.18,
  /** How close you must be standing to go through one. A camp is wider than a dropped pack. */
  REACH: 3,
} as const;

/**
 * How much better than open meadow each country is to stop in. The wood breaks the wind and hides
 * a fire, which is most of what a person wants at dusk; the marsh has nowhere dry to lie and the
 * high rock has nothing to peg into, and both show it.
 */
const SHELTER: Record<Biome, number> = {
  [Biome.Plains]: 1,
  [Biome.Forest]: 1.8,
  [Biome.Desert]: 0.5,
  [Biome.Swamp]: 0.25,
  [Biome.Mountain]: 0.4,
  [Biome.Snow]: 0.5,
};

/**
 * The trades that are still out in the country at nightfall, and the tool each is known by. A
 * hunter's knife is in a hunter's camp whether or not the hunter is still using it, which is what
 * makes a torn tent readable: you can tell who it was from what they left.
 */
const TRADE_TOOL = {
  hunter: 'knife',
  explorer: 'map',
  climber: 'rope',
  soldier: 'firerocks',
  doctor: 'mortar',
} as const;

/** Somebody whose work takes them further than a day from a bed. */
export type Wayfarer = keyof typeof TRADE_TOOL;

/**
 * Whose camp it is. Taken from the village trades rather than written out again, so a camp is
 * always somebody you could have met in a square, and a trade the game drops stops turning up out
 * here on the same day it stops turning up in there.
 */
export const WAYFARERS: readonly Wayfarer[] =
  (Object.keys(TRADE_TOOL) as Wayfarer[]).filter((id) => TRADES.some((trade) => trade.id === id));

/** What somebody sleeping rough carries to keep off what comes. Nothing a soldier would envy. */
const ARMS: readonly string[] = ['stick', 'sword', 'bow'];

/** And once in a while, the thing they were out here for in the first place. */
const PRIZES: readonly string[] = ['gem', 'nugget', 'charm', 'elixir'];

/**
 * What somebody had with them, in the shape of the pack a person leaves where they fall: the same
 * find arrived at two different ways, so anything that can go through one can go through the other.
 *
 * The one field of a pack deliberately not taken is how long it has left. A pack in the grass is
 * of the moment and the crows have it within the quarter hour; a camp is a fact about the world,
 * and is still standing there next week for whoever gets to it second.
 */
export type Spoils = Pick<Pack, 'who' | 'trade' | 'gold' | 'items'>;

/** A camp somebody else pitched: their pack, and the ground they chose to put it down on. */
export interface WildCamp extends Spoils {
  /**
   * The same string on every client and after every reload, built from where the camp is rather
   * than from whose it is, so a camp gone through once stays gone through.
   */
  id: string;
  x: number;
  z: number;
  /** Whether the nights it stood through went badly. What is left of it is the story it tells. */
  ruined: boolean;
}

/** What choosing a pitch cares about at a tile: the country, the lie of it, and who else is near. */
export interface Clearing {
  biome: Biome;
  /** Terraces above the road going past, which is this world's word for how exposed a spot is. */
  rise: number;
  /** Tiles from the edge of the road surface, and Infinity out where there is no road at all. */
  offRoad: number;
  /** Tiles to the edge of the nearest village, and Infinity where there is not one anywhere near. */
  toVillage: number;
  /** Ground a peg goes into: bare earth and sand, never rock, road, deck, floor or water. */
  pegged: boolean;
}

/** Taking from a camp is one of two things, and which it is, is the whole moral of the place. */
export type Taking = 'salvage' | 'theft';

/** Tiles a tent peg goes into: bare earth and sand, and nothing else in the world. */
function pegsInto(type: TileType): boolean {
  return type === TileType.Ground || type === TileType.GroundAlt || type === TileType.Sand;
}

/**
 * Read a sampled tile the way somebody looking for somewhere to sleep reads it.
 *
 * @param toVillage tiles to the nearest village edge, which the tile itself has no way of knowing
 */
export function clearingOf(
  tile: Pick<TileSample, 'type' | 'biome' | 'level' | 'base' | 'roadDist' | 'roadWidth'>,
  toVillage: number,
): Clearing {
  return {
    biome: tile.biome,
    rise: Math.max(0, tile.level - tile.base),
    offRoad: Math.max(0, tile.roadDist - tile.roadWidth),
    toVillage,
    pegged: pegsInto(tile.type),
  };
}

/**
 * How inviting this ground looks at the end of a day's walk, 0 anywhere nobody would stop at all.
 * The three noughts are the three rules a sensible person keeps: not in the water, not in the
 * road, and not in somebody's village where there is a bed for ten gold.
 */
export function comfort(clearing: Clearing): number {
  if (!clearing.pegged) return 0;
  if (clearing.offRoad < CAMPS.OFF_ROAD || clearing.offRoad > CAMPS.WITHIN) return 0;
  if (clearing.toVillage < CAMPS.APART) return 0;
  const exposed = 1 + clearing.rise * CAMPS.PER_TERRACE;
  return Math.min(CAMPS.MOST, CAMPS.BASE * SHELTER[clearing.biome] / exposed);
}

/**
 * How likely a camp on this ground is to be the torn one. A night at a time, from the same danger
 * a player pitching here would be sleeping through, so the answer is whatever the country is.
 */
export function ruinChanceOf(land: Country): number {
  return 1 - (1 - dangerOf(land)) ** CAMPS.NIGHTS;
}

/**
 * What somebody of this trade had on them. The tool of the trade is the one certainty: it is the
 * reason they were out here, and the reason a stranger's camp is worth crossing a field for.
 */
export function spoilsOf(who: string, trade: Wayfarer, roll: Rng): Spoils {
  const items: string[] = [TRADE_TOOL[trade]];
  if (roll() < CAMPS.ARMED) items.push(ARMS[Math.floor(roll() * ARMS.length)]);
  if (roll() < CAMPS.PRIZE) items.push(PRIZES[Math.floor(roll() * PRIZES.length)]);
  return { who, trade, gold: CAMPS.PURSE_LEAST + Math.floor(roll() * CAMPS.PURSE), items };
}

/**
 * The camp on one tile, for anybody who walks past it. Pure in (seed, tile), so the same tent
 * stands in the same clearing on every machine and for the life of the world.
 */
export function campAt(seed: number, tx: number, tz: number, clearing: Clearing): WildCamp | null {
  const chance = comfort(clearing);
  if (chance <= 0) return null;
  const roll = mulberry32(hash3(derive(seed, SALT.CAMPSITE), Math.floor(tx), Math.floor(tz)));
  if (roll() >= chance) return null;

  const trade = WAYFARERS[Math.floor(roll() * WAYFARERS.length)];
  const who = `${givenName(roll)} ${familyName(roll)}`;
  const ruined = roll() < ruinChanceOf({ biome: clearing.biome, toVillage: clearing.toVillage });
  // the middle of the tile, not a jitter within it: the square you can see the tent on has to be
  // the square that holds it, or walking up to one becomes a hunt for the one tile that answers
  return {
    ...spoilsOf(who, trade, roll),
    id: `camp:${Math.floor(tx)},${Math.floor(tz)}`,
    x: Math.floor(tx) + 0.5,
    z: Math.floor(tz) + 0.5,
    ruined,
  };
}

/**
 * Every camp on a square of country, bounds included. Ask it once for a chunk as the chunk
 * arrives rather than every frame: reading a tile is cheap, and there are a great many tiles.
 *
 * @param read what the ground at a tile looks like, which only the caller holds the world to answer
 */
export function campsIn(
  seed: number, minX: number, minZ: number, maxX: number, maxZ: number,
  read: (tx: number, tz: number) => Clearing,
): WildCamp[] {
  const pitched: WildCamp[] = [];
  for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
      const camp = campAt(seed, x, z, read(x, z));
      if (camp) pitched.push(camp);
    }
  }
  return pitched;
}

/** The camp you are standing in, if you are standing in one. */
export function nearestCamp(
  camps: readonly WildCamp[], x: number, z: number, reach: number = CAMPS.REACH,
): WildCamp | null {
  let best: WildCamp | null = null;
  let bestAway: number = reach;
  for (const camp of camps) {
    const away = Math.hypot(camp.x - x, camp.z - z);
    if (away < bestAway) { bestAway = away; best = camp; }
  }
  return best;
}

/**
 * What going through this camp would be. A torn tent nobody came back for is salvage and the
 * game does not moralise about it; a banked fire and a made bed belong to somebody who is coming
 * back, and taking from that is theft whatever the player tells themselves about it.
 */
export function takingFrom(camp: WildCamp): Taking {
  return camp.ruined ? 'salvage' : 'theft';
}
