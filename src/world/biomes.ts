/**
 * Biome definitions. Colours are sRGB hex; the mesher converts to linear.
 * No textures anywhere: every surface is a flat vertex colour.
 */

export const enum Biome {
  Plains = 0,
  Forest = 1,
  Desert = 2,
  Swamp = 3,
  Mountain = 4,
  Snow = 5,
}

export const enum PropKind {
  None = 0,
  Oak = 1,
  Pine = 2,
  Cactus = 3,
  Rock = 4,
  DeadTree = 5,
  Bush = 6,
  Willow = 7,
  SnowPine = 8,
  Boulder = 9,
  Reed = 10,
  Flower = 11,
  Tuft = 12,
  Mushroom = 13,
  Palm = 14,
  Lily = 15,
  Birch = 16,
  Fir = 17,
  Blossom = 18,
  // structures (HousePlains + biome id = that biome's house)
  HousePlains = 20,
  HouseForest = 21,
  HouseDesert = 22,
  HouseSwamp = 23,
  HouseMountain = 24,
  HouseSnow = 25,
  Well = 26,
  Shrine = 27,
  Ruins = 28,
  Tower = 29,
  Campfire = 30,
  GiantTree = 31,
  Sign = 32,
  Stall = 33,
  // the same houses with another storey on them, built by a villager who could afford it
  TallHousePlains = 90,
  TallHouseForest = 91,
  TallHouseDesert = 92,
  TallHouseSwamp = 93,
  TallHouseMountain = 94,
  TallHouseSnow = 95,
  /** What a village builds once it has more than it needs, and charges you to use. */
  Sauna = 96,
  Pool = 97,
  /**
   * What a builder can add to a house you already own: another floor under the same roof, and a
   * fountain for the yard. Both are commissioned rather than grown — see `game/building.ts` — and
   * both are the second half of the argument that building takes an object: a storey and a pool
   * are things nobody can order unless the catalogue has more than one line in it.
   */
  HouseYoursTwo = 98,
  Fountain = 99,
  ChurchPlains = 40,
  ChurchForest = 41,
  ChurchDesert = 42,
  ChurchSwamp = 43,
  ChurchMountain = 44,
  ChurchSnow = 45,
  /**
   * The two civic buildings, laid out in biome order like the houses and the churches above.
   *
   * They are built out of the same six palettes for the same reason a chapel is: a village is
   * built out of whatever the country round it is made of, and a stone hall in a timber village
   * would read as something that had been dropped there. What tells them apart at a hundred paces
   * is the shape — a porch of pillars on the hall, a squat lock-up wing on the watch house — and
   * not the colour.
   */
  TownHallPlains = 100,
  TownHallForest = 101,
  TownHallDesert = 102,
  TownHallSwamp = 103,
  TownHallMountain = 104,
  TownHallSnow = 105,
  WatchHousePlains = 106,
  WatchHouseForest = 107,
  WatchHouseDesert = 108,
  WatchHouseSwamp = 109,
  WatchHouseMountain = 110,
  WatchHouseSnow = 111,
  /**
   * The four pieces a castle is built out of, and the only building in the world that is more
   * than one prop.
   *
   * Everything else here stands on a single tile: a cottage is a cottage, a chapel is a chapel.
   * A castle cannot be, because a prop's footprint is one box and a castle's is thirteen tiles
   * across — drawn that way it would be a slab you could neither see over nor walk up to the gate
   * of. So the wall comes a tile at a time, like a paddock rail does, and the tower, the gatehouse
   * and the keep are set on the tiles the wall leaves for them. One palette, no biome variants:
   * a castle is not built out of whatever the country round it is made of, which is most of what
   * says it was not built by the village.
   */
  CastleWall = 112,
  CastleTower = 113,
  CastleGate = 114,
  CastleKeep = 115,
  // dungeon furniture
  Torch = 50,
  Chest = 51,
  ChestOpen = 52,
  Stairs = 53,
  Door = 54,
  Descent = 59,
  Signpost = 55,
  NoticeBoard = 58,
  /**
   * One tile of paddock rail, lying along whichever way its structure faces.
   *
   * A stable used to be an ordinary house with a man beside it who would sell you a horse, which
   * from the road is a house. The fence is what makes it a stable: a run of rail with animals
   * standing about inside it, recognisable at the distance this camera actually looks from.
   */
  Fence = 87,
  Seedling = 80,
  CropYoung = 81,
  CropRipe = 82,
  /**
   * A house of the player's own, going up. Four separate kinds rather than one that grows,
   * because a building site is a sequence of recognisable states and each of these has to read
   * from the top of an isometric camera at a hundred paces.
   */
  HousePegs = 83,
  HouseFrame = 84,
  HouseRoof = 85,
  HouseYours = 86,
  /**
   * And the same courtesy paid to everything else a builder can be told to put up.
   *
   * A house had four states and every other job in the catalogue had one, so a pool, a fountain and
   * a second storey were a week of pegs and string — or, in the storey's case, of nothing whatever
   * — and then a finished thing on the last morning. Three states each, told in the order the work
   * is done in, is what makes riding past a site twice worth doing for any of them rather than for
   * houses alone. What each one shows and why is in `entities/sites.ts`.
   *
   * None of them is in `BLOCKS_WALKING`, deliberately: an unfinished building is something you walk
   * about on rather than round, and what a commission is solid to is decided on the day it is
   * finished — see the walls `game/frame.ts` lays down, which only finished work gets.
   */
  PoolMarked = 131,
  PoolDug = 132,
  PoolLined = 133,
  FountainMarked = 134,
  FountainBasin = 135,
  FountainDry = 136,
  StoreyTimber = 137,
  StoreyScaffold = 138,
  StoreyRaised = 139,
  /**
   * And a boat, which is the only one of these that is not a building.
   *
   * Four rather than three, because the others each leave a finished thing behind that the world
   * already knew how to draw — a cottage, a pool, a fountain — and a boat leaves nothing at all:
   * the moment she is paid for she is off the stocks and floating, and what floats is a `THREE`
   * object in `render/boat.ts` rather than a prop on a tile. So the fourth here is her finished and
   * still out of the water, which is a real morning and the only one anybody would call waiting.
   */
  BoatKeel = 140,
  BoatFrames = 141,
  BoatPlanked = 142,
  BoatReady = 143,
  /**
   * And a jetty, which is the only commission that reaches off its own tile.
   *
   * Four again, and the last of them stays: a jetty is finished where it stands and stays standing,
   * which is the ordinary case that the boat was the exception to. What is unusual about these is
   * underneath rather than in the list — they are drawn from the shore tile at the landward end and
   * everything about them is out over water. See `entities/sites.ts`.
   */
  JettyPiles = 144,
  JettyDriven = 145,
  JettyBearers = 146,
  JettyDone = 147,
  CaveMouth = 56,
  Shipwreck = 57,
  /** The crashed craft: not from here, and it shows. */
  Derelict = 130,
  // interior furniture
  Bed = 60,
  Table = 61,
  Chair = 62,
  Hearth = 63,
  Shelf = 64,
  Barrel = 65,
  Crate = 66,
  Forge = 67,
  Anvil = 68,
  WeaponRack = 69,
  Cauldron = 70,
  Altar = 71,
  Pew = 72,
  Candle = 73,
  Rug = 74,
  /**
   * One tile of cell front: uprights between a floor rail and a head rail.
   *
   * Interior furniture rather than a wall tile, because a cell you cannot see into is a cupboard.
   * The bars stop you the way a table does — measured off their own geometry — so the room reads
   * as one room with a corner of it shut off, which is what a lock-up is.
   */
  Bars = 75,

  /*
   * What a keep is furnished with, which is not what a cottage is furnished with.
   *
   * Everything above this line came from a village or a chapel, and a castle was dressed out of it:
   * an `Altar` standing in for a throne, a `WeaponRack` for a wall of arms, a `Forge` for a kitchen
   * range. Each was the right silhouette from above and the wrong object up close, which is a fair
   * trade while a castle is being built and a poor one once it is standing.
   *
   * They are grouped here rather than scattered among the furniture because they share a reason for
   * existing: a hall is bigger than a room, and the things in it are bigger than a room's things. A
   * `Table` in a great hall reads as a canteen; a `Hearth` in one reads as a fireplace somebody has
   * mislaid.
   */
  Throne = 116,
  LongTable = 117,
  GreatHearth = 118,
  Banner = 119,
  Tapestry = 120,
  SuitOfArmour = 121,
  Brazier = 122,
  Chandelier = 123,
  Portcullis = 124,
  Statue = 125,
  TowerStair = 126,
  Cobweb = 127,
  Sarcophagus = 128,
  StainedWindow = 129,
}

/**
 * Props a walker cannot pass through. Trees, rocks big enough to matter, and anything built.
 * It lives here, beside the catalogue, because whether a thing blocks the way is a fact about
 * what it is — the chunk worker only reads the list.
 */
export const BLOCKS_WALKING: ReadonlySet<PropKind> = new Set<PropKind>([
  PropKind.Oak, PropKind.Pine, PropKind.SnowPine, PropKind.Willow, PropKind.Palm,
  PropKind.Birch, PropKind.Fir, PropKind.Blossom,
  PropKind.Cactus, PropKind.Boulder, PropKind.DeadTree,
  PropKind.Well, PropKind.Shrine, PropKind.Ruins, PropKind.Tower, PropKind.Campfire, PropKind.GiantTree,
  PropKind.Stall, PropKind.Sign, PropKind.Signpost, PropKind.CaveMouth, PropKind.Shipwreck, PropKind.NoticeBoard,
  PropKind.Derelict,
  // the whole point of a fence: the animals inside it stay inside it, and so does anybody who
  // climbs in after them, which is why the paddock is built with a gap in it for a gate
  PropKind.Fence,
  /*
   * And every building, which was not on this list at all.
   *
   * It did not need to be while a building's footprint was stamped as floor and floor was solid —
   * but that stamp is three tiles wide against 2.4 of wall, which is where the ring of invisible
   * wall round every cottage came from. The footprint no longer blocks; the walls do, measured off
   * the same geometry that draws them, so a house stops you where you can see it stopping you.
   */
  PropKind.HousePlains, PropKind.HouseForest, PropKind.HouseDesert,
  PropKind.HouseSwamp, PropKind.HouseMountain, PropKind.HouseSnow,
  PropKind.TallHousePlains, PropKind.TallHouseForest, PropKind.TallHouseDesert,
  PropKind.TallHouseSwamp, PropKind.TallHouseMountain, PropKind.TallHouseSnow,
  PropKind.ChurchPlains, PropKind.ChurchForest, PropKind.ChurchDesert,
  PropKind.ChurchSwamp, PropKind.ChurchMountain, PropKind.ChurchSnow,
  PropKind.TownHallPlains, PropKind.TownHallForest, PropKind.TownHallDesert,
  PropKind.TownHallSwamp, PropKind.TownHallMountain, PropKind.TownHallSnow,
  PropKind.WatchHousePlains, PropKind.WatchHouseForest, PropKind.WatchHouseDesert,
  PropKind.WatchHouseSwamp, PropKind.WatchHouseMountain, PropKind.WatchHouseSnow,
  // a house of the player's own, at every stage it stands up in — pegs in the ground are not a
  // wall, so they are not here, but a frame is something you walk round
  PropKind.HouseFrame, PropKind.HouseRoof, PropKind.HouseYours, PropKind.HouseYoursTwo,
  PropKind.Sauna, PropKind.Fountain,
  // and the castle, every piece of it. A curtain wall that let anybody through is a fence, and the
  // gatehouse has to stop you or there is nowhere to stand and be asked whether you are going in
  PropKind.CastleWall, PropKind.CastleTower, PropKind.CastleGate, PropKind.CastleKeep,
]);

/** Anything with a trunk: the kinds a wood is made of. */
export const TREES: readonly PropKind[] = [
  PropKind.Oak, PropKind.Pine, PropKind.SnowPine, PropKind.Willow, PropKind.Palm,
  PropKind.Birch, PropKind.Fir, PropKind.Blossom, PropKind.DeadTree,
];

export interface PropWeight { kind: PropKind; weight: number }

export interface BiomeDef {
  id: Biome;
  name: string;
  /**
   * The plain words somebody would type for this country, as opposed to the name it is given.
   *
   * A world calls the high ground "Stonecrown Highlands", and a player asking which towns are in
   * the mountains types "mountains". Both have to find it, so the flavour is the name and these
   * are what it answers to.
   */
  words: string[];
  /** Top colour for ordinary ground, plus an alternate for subtle variation. */
  ground: number;
  groundAlt: number;
  /** Colour of terrace cliff faces. */
  cliff: number;
  road: number;
  /** Coast / river bank colour (also the whole ground in Desert). */
  sand: number;
  /** High terrace top colour (bare rock / snowcap). */
  high: number;
  /** Extra terraces the road itself sits on, so mountains and snow areas read as highlands. */
  baseLevel: number;
  /** Multiplier on how many terraces rise away from the road. */
  roughness: number;
  /** Levels above the road at which ground turns to `high`. */
  highAt: number;
  /** Probability a ground tile gets a prop, and the weighted kinds. */
  propDensity: number;
  props: PropWeight[];
  /** Same for the bank ring around rivers and lakes. */
  bankDensity: number;
  bank: PropWeight[];
  /** Same for water tiles (things that float). */
  waterDensity: number;
  water: PropWeight[];
}

const w = (kind: PropKind, weight: number): PropWeight => ({ kind, weight });

/**
 * Whether a word somebody typed describes this country.
 *
 * Matches the given name as well as the plain words, so both "stonecrown" and "mountains" find the
 * highlands. Loose on purpose: this answers a question typed into a console, where being asked
 * again is a worse outcome than one extra town in the list.
 */
export function biomeAnswersTo(biome: Biome, word: string): boolean {
  const wanted = word.trim().toLowerCase();
  if (!wanted) return true;
  const def = BIOMES[biome];
  if (!def) return false;
  return def.name.toLowerCase().includes(wanted)
    || def.words.some((each) => each.startsWith(wanted) || wanted.startsWith(each));
}

export const BIOMES: readonly BiomeDef[] = [
  {
    id: Biome.Plains, name: 'Heartland Meadows',
    words: ['plains', 'meadow', 'meadows', 'grassland', 'heartland'],
    ground: 0x72b04c, groundAlt: 0x80bc58, cliff: 0x8b6b4a, road: 0xc7a56b, sand: 0xdcc78e, high: 0x9a9a8a,
    baseLevel: 0, roughness: 1.4, highAt: 4,
    propDensity: 0.1, props: [w(PropKind.Oak, 3), w(PropKind.Birch, 2), w(PropKind.Blossom, 0.6), w(PropKind.Bush, 3), w(PropKind.Flower, 5), w(PropKind.Tuft, 4), w(PropKind.Rock, 1)],
    bankDensity: 0.3, bank: [w(PropKind.Reed, 5), w(PropKind.Tuft, 2)],
    waterDensity: 0.03, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Forest, name: 'Whispering Woods',
    words: ['forest', 'wood', 'woods', 'woodland'],
    ground: 0x3f8c3a, groundAlt: 0x377d33, cliff: 0x6b5238, road: 0x9c7d55, sand: 0xc9b98a, high: 0x7f8a70,
    baseLevel: 0, roughness: 1.8, highAt: 5,
    propDensity: 0.36, props: [w(PropKind.Oak, 5), w(PropKind.Pine, 3), w(PropKind.Birch, 3), w(PropKind.Fir, 1.5), w(PropKind.Blossom, 0.8), w(PropKind.Bush, 2), w(PropKind.Mushroom, 1.5), w(PropKind.Tuft, 1), w(PropKind.Rock, 1)],
    bankDensity: 0.28, bank: [w(PropKind.Reed, 4), w(PropKind.Mushroom, 1), w(PropKind.Bush, 1)],
    waterDensity: 0.04, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Desert, name: 'Sunscorch Dunes',
    words: ['desert', 'dune', 'dunes', 'sand'],
    ground: 0xe2c688, groundAlt: 0xd8b975, cliff: 0xb3895a, road: 0xbf9d63, sand: 0xe8d39a, high: 0xc4a274,
    baseLevel: 0, roughness: 1.1, highAt: 3,
    propDensity: 0.05, props: [w(PropKind.Cactus, 5), w(PropKind.Rock, 3), w(PropKind.DeadTree, 2), w(PropKind.Tuft, 1)],
    bankDensity: 0.22, bank: [w(PropKind.Palm, 5), w(PropKind.Reed, 2), w(PropKind.Tuft, 1)],
    waterDensity: 0.01, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Swamp, name: 'Mirefen Marsh',
    words: ['swamp', 'marsh', 'mire', 'fen', 'bog'],
    ground: 0x5f7d3f, groundAlt: 0x536f3a, cliff: 0x5a4a3a, road: 0x8a7a5a, sand: 0x8f8a62, high: 0x6f7a60,
    baseLevel: 0, roughness: 0.5, highAt: 3,
    propDensity: 0.22, props: [w(PropKind.Willow, 5), w(PropKind.Bush, 2), w(PropKind.DeadTree, 2), w(PropKind.Reed, 4), w(PropKind.Mushroom, 2)],
    bankDensity: 0.45, bank: [w(PropKind.Reed, 6), w(PropKind.Mushroom, 1)],
    waterDensity: 0.12, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Mountain, name: 'Stonecrown Highlands',
    words: ['mountain', 'mountains', 'highland', 'highlands', 'hills'],
    ground: 0x7f9468, groundAlt: 0x8ba072, cliff: 0x6e6e6e, road: 0xa39a86, sand: 0xa8a48f, high: 0x8f8f8f,
    baseLevel: 3, roughness: 3.4, highAt: 3,
    propDensity: 0.11, props: [w(PropKind.Pine, 3), w(PropKind.Fir, 3), w(PropKind.Boulder, 3), w(PropKind.Rock, 3), w(PropKind.Tuft, 1)],
    bankDensity: 0.18, bank: [w(PropKind.Rock, 3), w(PropKind.Reed, 2)],
    waterDensity: 0, water: [],
  },
  {
    id: Biome.Snow, name: 'Frostveil Reach',
    words: ['snow', 'frost', 'ice', 'tundra'],
    ground: 0xeef2f5, groundAlt: 0xdfe6ec, cliff: 0x9aa5b0, road: 0xc9cfd6, sand: 0xd5dde3, high: 0xffffff,
    baseLevel: 2, roughness: 2.6, highAt: 2,
    propDensity: 0.14, props: [w(PropKind.SnowPine, 5), w(PropKind.Fir, 2), w(PropKind.Birch, 1.5), w(PropKind.Rock, 2), w(PropKind.DeadTree, 1)],
    bankDensity: 0.12, bank: [w(PropKind.Rock, 3), w(PropKind.DeadTree, 1)],
    waterDensity: 0, water: [],
  },
];

export const HUB_NAME = 'The Crossroads';
export const SEA_NAME = 'Open Water';

export function pickWeighted(list: readonly PropWeight[], r: number): PropKind {
  if (list.length === 0) return PropKind.None;
  let total = 0;
  for (const p of list) total += p.weight;
  let t = r * total;
  for (const p of list) {
    t -= p.weight;
    if (t <= 0) return p.kind;
  }
  return list[list.length - 1].kind;
}
