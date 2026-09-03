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
  ChurchPlains = 40,
  ChurchForest = 41,
  ChurchDesert = 42,
  ChurchSwamp = 43,
  ChurchMountain = 44,
  ChurchSnow = 45,
}

export interface PropWeight { kind: PropKind; weight: number }

export interface BiomeDef {
  id: Biome;
  name: string;
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

export const BIOMES: readonly BiomeDef[] = [
  {
    id: Biome.Plains, name: 'Heartland Meadows',
    ground: 0x72b04c, groundAlt: 0x80bc58, cliff: 0x8b6b4a, road: 0xc7a56b, sand: 0xdcc78e, high: 0x9a9a8a,
    baseLevel: 0, roughness: 1.4, highAt: 4,
    propDensity: 0.1, props: [w(PropKind.Oak, 4), w(PropKind.Bush, 3), w(PropKind.Flower, 5), w(PropKind.Tuft, 4), w(PropKind.Rock, 1)],
    bankDensity: 0.3, bank: [w(PropKind.Reed, 5), w(PropKind.Tuft, 2)],
    waterDensity: 0.03, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Forest, name: 'Whispering Woods',
    ground: 0x3f8c3a, groundAlt: 0x377d33, cliff: 0x6b5238, road: 0x9c7d55, sand: 0xc9b98a, high: 0x7f8a70,
    baseLevel: 0, roughness: 1.8, highAt: 5,
    propDensity: 0.36, props: [w(PropKind.Oak, 6), w(PropKind.Pine, 4), w(PropKind.Bush, 2), w(PropKind.Mushroom, 1.5), w(PropKind.Tuft, 1), w(PropKind.Rock, 1)],
    bankDensity: 0.28, bank: [w(PropKind.Reed, 4), w(PropKind.Mushroom, 1), w(PropKind.Bush, 1)],
    waterDensity: 0.04, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Desert, name: 'Sunscorch Dunes',
    ground: 0xe2c688, groundAlt: 0xd8b975, cliff: 0xb3895a, road: 0xbf9d63, sand: 0xe8d39a, high: 0xc4a274,
    baseLevel: 0, roughness: 1.1, highAt: 3,
    propDensity: 0.05, props: [w(PropKind.Cactus, 5), w(PropKind.Rock, 3), w(PropKind.DeadTree, 2), w(PropKind.Tuft, 1)],
    bankDensity: 0.22, bank: [w(PropKind.Palm, 5), w(PropKind.Reed, 2), w(PropKind.Tuft, 1)],
    waterDensity: 0.01, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Swamp, name: 'Mirefen Marsh',
    ground: 0x5f7d3f, groundAlt: 0x536f3a, cliff: 0x5a4a3a, road: 0x8a7a5a, sand: 0x8f8a62, high: 0x6f7a60,
    baseLevel: 0, roughness: 0.5, highAt: 3,
    propDensity: 0.22, props: [w(PropKind.Willow, 5), w(PropKind.Bush, 2), w(PropKind.DeadTree, 2), w(PropKind.Reed, 4), w(PropKind.Mushroom, 2)],
    bankDensity: 0.45, bank: [w(PropKind.Reed, 6), w(PropKind.Mushroom, 1)],
    waterDensity: 0.12, water: [w(PropKind.Lily, 1)],
  },
  {
    id: Biome.Mountain, name: 'Stonecrown Highlands',
    ground: 0x7f9468, groundAlt: 0x8ba072, cliff: 0x6e6e6e, road: 0xa39a86, sand: 0xa8a48f, high: 0x8f8f8f,
    baseLevel: 3, roughness: 3.4, highAt: 3,
    propDensity: 0.11, props: [w(PropKind.Pine, 5), w(PropKind.Boulder, 3), w(PropKind.Rock, 3), w(PropKind.Tuft, 1)],
    bankDensity: 0.18, bank: [w(PropKind.Rock, 3), w(PropKind.Reed, 2)],
    waterDensity: 0, water: [],
  },
  {
    id: Biome.Snow, name: 'Frostveil Reach',
    ground: 0xeef2f5, groundAlt: 0xdfe6ec, cliff: 0x9aa5b0, road: 0xc9cfd6, sand: 0xd5dde3, high: 0xffffff,
    baseLevel: 2, roughness: 2.6, highAt: 2,
    propDensity: 0.14, props: [w(PropKind.SnowPine, 6), w(PropKind.Rock, 2), w(PropKind.DeadTree, 1)],
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
