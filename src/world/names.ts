import { StructureKind } from './kinds';

/**
 * What the places in this world are called.
 *
 * A table rather than a generator, because a name has to be sayable: "Willowholm" is somewhere a
 * person can be told to walk to, and a shrine called "Shrine of Echoes" is worth going to look at.
 * Villages take a prefix and a suffix at random; landmarks take a whole name, and no two of them
 * take the same one.
 */

export const PREFIX = ['Oak', 'Ash', 'Elder', 'Stone', 'Mill', 'Fern', 'Brook', 'Wolf', 'Silver', 'Amber', 'Frost', 'Dune', 'Reed', 'Moss', 'Hawk', 'Bramble', 'Thorn', 'Willow', 'Crag', 'Salt'];
export const SUFFIX = ['ford', 'hollow', 'mere', 'stead', 'wick', 'bury', 'haven', 'ton', 'vale', 'cross', 'field', 'reach', 'holm', 'gate', 'moor'];

export const POI_NAMES: Record<number, string[]> = {
  [StructureKind.Shrine]: ['Shrine of Winds', 'Moonwell Shrine', 'Shrine of the Quiet Stone', 'Sunken Shrine', 'Shrine of Echoes'],
  [StructureKind.Ruins]: ['Old Ruins', 'Fallen Keep', 'Ruins of Aldra', 'Broken Hall', 'The Forgotten Walls'],
  [StructureKind.Tower]: ['Watchtower', 'Lonely Spire', 'Beacon Tower', 'Sentinel Post', 'Gull Tower'],
  [StructureKind.Campfire]: ['Abandoned Camp', "Wanderer's Rest", 'Cold Campfire', "Trapper's Camp", 'Roadside Camp'],
  [StructureKind.GiantTree]: ['The Great Oak', 'Elder Tree', 'Heartwood', 'The Old One', 'Grandfather Oak'],
};
