import { PropKind } from './biomes';

/**
 * Everything the world stands on top of itself, named.
 *
 * The ground is tiles and the tiles are drawn from a heightfield; everything else — every tree,
 * rock, house, church, market stall, bed and anvil — is a `PropKind` with a shape in the prop
 * library. There are getting on for eighty of them, and until now the only place that fact was
 * written down was the enum itself, which is a `const enum` and therefore does not exist at run
 * time: the numbers are substituted into the code and the names are thrown away by the compiler.
 *
 * So nothing could show you a list of what the world contains. `catalogue.test.ts` is what keeps
 * this honest — it asks the prop library what it can actually draw and fails if anything is
 * missing from here, so a new prop cannot be added and quietly go unnamed.
 *
 * The groups are how a person would look for something rather than how the enum is ordered: a
 * player thinks "the houses", not "twenty through twenty-five and ninety through ninety-five".
 */

/** What sort of thing this is, for somebody looking down a list of them. */
export type PropGroup =
  | 'trees' | 'plants' | 'stone' | 'houses' | 'civic' | 'trade'
  | 'farm' | 'building' | 'castle' | 'furniture' | 'dungeon' | 'wild';

/** One entry: what it is called, and where a person would look for it. */
export interface Catalogued {
  kind: PropKind;
  name: string;
  group: PropGroup;
}

/**
 * The catalogue, in the order it reads best rather than in the order the numbers fall.
 *
 * Names are what somebody would call the thing out loud. A house is "cottage" and not
 * "HousePlains", because the biome in the name is how the code tells six of them apart and not
 * something a person needs to see twice on the same line — the group says they are houses already.
 */
export const CATALOGUE: readonly Catalogued[] = [
  { kind: PropKind.Oak, name: 'oak', group: 'trees' },
  { kind: PropKind.Pine, name: 'pine', group: 'trees' },
  { kind: PropKind.SnowPine, name: 'snow pine', group: 'trees' },
  { kind: PropKind.Fir, name: 'fir', group: 'trees' },
  { kind: PropKind.Birch, name: 'birch', group: 'trees' },
  { kind: PropKind.Willow, name: 'willow', group: 'trees' },
  { kind: PropKind.Blossom, name: 'blossom tree', group: 'trees' },
  { kind: PropKind.Palm, name: 'palm', group: 'trees' },
  { kind: PropKind.DeadTree, name: 'dead tree', group: 'trees' },
  { kind: PropKind.GiantTree, name: 'giant tree', group: 'trees' },

  { kind: PropKind.Bush, name: 'bush', group: 'plants' },
  { kind: PropKind.Cactus, name: 'cactus', group: 'plants' },
  { kind: PropKind.Reed, name: 'reeds', group: 'plants' },
  { kind: PropKind.Flower, name: 'flowers', group: 'plants' },
  { kind: PropKind.Tuft, name: 'grass tuft', group: 'plants' },
  { kind: PropKind.Mushroom, name: 'mushroom', group: 'plants' },
  { kind: PropKind.Lily, name: 'lily', group: 'plants' },

  { kind: PropKind.Rock, name: 'rock', group: 'stone' },
  { kind: PropKind.Boulder, name: 'boulder', group: 'stone' },

  { kind: PropKind.HousePlains, name: 'cottage', group: 'houses' },
  { kind: PropKind.HouseForest, name: 'forest house', group: 'houses' },
  { kind: PropKind.HouseDesert, name: 'desert house', group: 'houses' },
  { kind: PropKind.HouseSwamp, name: 'swamp house', group: 'houses' },
  { kind: PropKind.HouseMountain, name: 'mountain house', group: 'houses' },
  { kind: PropKind.HouseSnow, name: 'snow house', group: 'houses' },
  { kind: PropKind.TallHousePlains, name: 'tall cottage', group: 'houses' },
  { kind: PropKind.TallHouseForest, name: 'tall forest house', group: 'houses' },
  { kind: PropKind.TallHouseDesert, name: 'tall desert house', group: 'houses' },
  { kind: PropKind.TallHouseSwamp, name: 'tall swamp house', group: 'houses' },
  { kind: PropKind.TallHouseMountain, name: 'tall mountain house', group: 'houses' },
  { kind: PropKind.TallHouseSnow, name: 'tall snow house', group: 'houses' },

  { kind: PropKind.ChurchPlains, name: 'church', group: 'civic' },
  { kind: PropKind.ChurchForest, name: 'forest church', group: 'civic' },
  { kind: PropKind.ChurchDesert, name: 'desert church', group: 'civic' },
  { kind: PropKind.ChurchSwamp, name: 'swamp church', group: 'civic' },
  { kind: PropKind.ChurchMountain, name: 'mountain church', group: 'civic' },
  { kind: PropKind.ChurchSnow, name: 'snow church', group: 'civic' },
  { kind: PropKind.TownHallPlains, name: 'town hall', group: 'civic' },
  { kind: PropKind.TownHallForest, name: 'forest town hall', group: 'civic' },
  { kind: PropKind.TownHallDesert, name: 'desert town hall', group: 'civic' },
  { kind: PropKind.TownHallSwamp, name: 'swamp town hall', group: 'civic' },
  { kind: PropKind.TownHallMountain, name: 'mountain town hall', group: 'civic' },
  { kind: PropKind.TownHallSnow, name: 'snow town hall', group: 'civic' },
  { kind: PropKind.WatchHousePlains, name: 'watch house', group: 'civic' },
  { kind: PropKind.WatchHouseForest, name: 'forest watch house', group: 'civic' },
  { kind: PropKind.WatchHouseDesert, name: 'desert watch house', group: 'civic' },
  { kind: PropKind.WatchHouseSwamp, name: 'swamp watch house', group: 'civic' },
  { kind: PropKind.WatchHouseMountain, name: 'mountain watch house', group: 'civic' },
  { kind: PropKind.WatchHouseSnow, name: 'snow watch house', group: 'civic' },
  { kind: PropKind.Well, name: 'well', group: 'civic' },
  { kind: PropKind.Shrine, name: 'shrine', group: 'civic' },
  { kind: PropKind.NoticeBoard, name: 'notice board', group: 'civic' },
  { kind: PropKind.Signpost, name: 'signpost', group: 'civic' },
  { kind: PropKind.Sauna, name: 'bath house', group: 'civic' },
  { kind: PropKind.Pool, name: 'bathing pool', group: 'civic' },

  { kind: PropKind.Stall, name: 'market stall', group: 'trade' },
  { kind: PropKind.Sign, name: 'shop sign', group: 'trade' },

  { kind: PropKind.Seedling, name: 'seedling', group: 'farm' },
  { kind: PropKind.CropYoung, name: 'young crop', group: 'farm' },
  { kind: PropKind.CropRipe, name: 'ripe crop', group: 'farm' },
  { kind: PropKind.Fence, name: 'paddock rail', group: 'farm' },

  { kind: PropKind.HousePegs, name: 'pegged out', group: 'building' },
  { kind: PropKind.HouseFrame, name: 'framed', group: 'building' },
  { kind: PropKind.HouseRoof, name: 'roofed', group: 'building' },
  { kind: PropKind.HouseYours, name: 'your house', group: 'building' },

  // a group of their own, because they are only ever seen together and are only ever a castle
  { kind: PropKind.CastleKeep, name: 'keep', group: 'castle' },
  { kind: PropKind.CastleGate, name: 'gatehouse', group: 'castle' },
  { kind: PropKind.CastleTower, name: 'castle tower', group: 'castle' },
  { kind: PropKind.CastleWall, name: 'curtain wall', group: 'castle' },

  { kind: PropKind.Bed, name: 'bed', group: 'furniture' },
  { kind: PropKind.Table, name: 'table', group: 'furniture' },
  { kind: PropKind.Chair, name: 'chair', group: 'furniture' },
  { kind: PropKind.Hearth, name: 'hearth', group: 'furniture' },
  { kind: PropKind.Shelf, name: 'shelf', group: 'furniture' },
  { kind: PropKind.Barrel, name: 'barrel', group: 'furniture' },
  { kind: PropKind.Crate, name: 'crate', group: 'furniture' },
  { kind: PropKind.Forge, name: 'forge', group: 'furniture' },
  { kind: PropKind.Anvil, name: 'anvil', group: 'furniture' },
  { kind: PropKind.WeaponRack, name: 'weapon rack', group: 'furniture' },
  { kind: PropKind.Cauldron, name: 'cauldron', group: 'furniture' },
  { kind: PropKind.Altar, name: 'altar', group: 'furniture' },
  { kind: PropKind.Pew, name: 'pew', group: 'furniture' },
  { kind: PropKind.Candle, name: 'candle', group: 'furniture' },
  { kind: PropKind.Rug, name: 'rug', group: 'furniture' },
  { kind: PropKind.Bars, name: 'cell bars', group: 'furniture' },

  { kind: PropKind.Torch, name: 'wall torch', group: 'dungeon' },
  { kind: PropKind.Chest, name: 'chest', group: 'dungeon' },
  { kind: PropKind.ChestOpen, name: 'open chest', group: 'dungeon' },
  { kind: PropKind.Stairs, name: 'stairs', group: 'dungeon' },
  { kind: PropKind.Descent, name: 'way down', group: 'dungeon' },
  { kind: PropKind.Door, name: 'door', group: 'dungeon' },

  { kind: PropKind.Ruins, name: 'ruins', group: 'wild' },
  { kind: PropKind.Tower, name: 'tower', group: 'wild' },
  { kind: PropKind.Campfire, name: 'campfire', group: 'wild' },
  { kind: PropKind.CaveMouth, name: 'cave mouth', group: 'wild' },
  { kind: PropKind.Shipwreck, name: 'shipwreck', group: 'wild' },
];

/** The order the groups are shown in, and what to call each of them. */
export const GROUPS: ReadonlyArray<{ group: PropGroup; name: string }> = [
  { group: 'trees', name: 'trees' },
  { group: 'plants', name: 'plants' },
  { group: 'stone', name: 'stone' },
  { group: 'houses', name: 'houses' },
  { group: 'civic', name: 'what a village builds' },
  { group: 'trade', name: 'trade' },
  { group: 'farm', name: 'the farm' },
  { group: 'building', name: 'a house going up' },
  { group: 'castle', name: 'the castle' },
  { group: 'furniture', name: 'indoors' },
  { group: 'dungeon', name: 'underground' },
  { group: 'wild', name: 'out in the country' },
];

/** What one prop is called. Its number, if it is one nobody has named yet. */
export function nameOfProp(kind: PropKind): string {
  return CATALOGUE.find((entry) => entry.kind === kind)?.name ?? `prop ${kind}`;
}
