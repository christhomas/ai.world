import { Biome } from '../world/biomes';

/**
 * What lives where.
 *
 * Kept apart from animals.ts because it answers a different question. That file says what a
 * creature *is* — its rig, its pace, how hard it hits; this one says where you meet it, which is
 * a fact about the world rather than about the animal. They change for different reasons and at
 * different times, and animals.ts had grown past the length anybody can hold in their head.
 */

export interface SpawnWeight { kind: string; weight: number }

/** Herd kinds per biome, on land. */
export const BIOME_ANIMALS: Record<Biome, SpawnWeight[]> = {
  [Biome.Plains]: [{ kind: 'cow', weight: 4 }, { kind: 'sheep', weight: 4 }, { kind: 'horse', weight: 2 }, { kind: 'chicken', weight: 3 }, { kind: 'rabbit', weight: 2 }],
  [Biome.Forest]: [{ kind: 'deer', weight: 5 }, { kind: 'rabbit', weight: 3 }, { kind: 'fox', weight: 2 }, { kind: 'bear', weight: 1 }],
  [Biome.Desert]: [{ kind: 'camel', weight: 3 }, { kind: 'lizard', weight: 4 }, { kind: 'vulture', weight: 2 }],
  [Biome.Swamp]: [{ kind: 'frog', weight: 5 }, { kind: 'heron', weight: 2 }, { kind: 'duck', weight: 3 }],
  [Biome.Mountain]: [{ kind: 'goat', weight: 5 }, { kind: 'eagle', weight: 2 }, { kind: 'wolf', weight: 1 }],
  [Biome.Snow]: [{ kind: 'hare', weight: 4 }, { kind: 'wolf', weight: 2 }, { kind: 'elk', weight: 3 }],
};

/**
 * What waits underground, by how far down you are. One entry per floor, counting from one.
 *
 * A cave mouth on the road out of the first village and the bottom of a three-floor vault were
 * the same table, so an hour-one cave was a third bats and had skeletons in it. A cave is always
 * floor one, so moving the skeletons into the second band is most of the fix: the first hour is
 * rats and the odd roost, and what hits twice as hard starts below the first stair, which is a
 * village and a shop away.
 */
const DUNGEON_BANDS: ReadonlyArray<readonly SpawnWeight[]> = [
  [{ kind: 'rat', weight: 6 }, { kind: 'slime', weight: 3 }, { kind: 'bat', weight: 3 }],
  [{ kind: 'rat', weight: 4 }, { kind: 'slime', weight: 3 }, { kind: 'bat', weight: 4 }, { kind: 'skeleton', weight: 3 }],
  [{ kind: 'rat', weight: 2 }, { kind: 'slime', weight: 3 }, { kind: 'bat', weight: 4 }, { kind: 'skeleton', weight: 5 }],
];

/** What lives on a floor. Anything deeper than the table goes holds whatever the bottom holds. */
export function dungeonMonsters(floor: number): readonly SpawnWeight[] {
  const band = Math.min(Math.max(1, Math.floor(floor)), DUNGEON_BANDS.length);
  return DUNGEON_BANDS[band - 1];
}

/** The shallow band: every cave, and the floor of a vault you arrive on. */
export const DUNGEON_MONSTERS: readonly SpawnWeight[] = dungeonMonsters(1);

/**
 * What lives above the treeline, on and around a massif.
 *
 * Kept apart from the biome tables because a mountain is not a biome: a massif can stand in any
 * country, and what matters is the height rather than the latitude. Deliberately short and
 * deliberately dangerous — the reason to look up when the ground starts to rise.
 */
export const HIGHLAND_ANIMALS: readonly SpawnWeight[] = [
  { kind: 'goat', weight: 5 },
  { kind: 'eagle', weight: 3 },
  { kind: 'wolf', weight: 2 },
  { kind: 'bear', weight: 1 },
  { kind: 'bigfoot', weight: 1 },
  { kind: 'yeti', weight: 1 },
];

/** Kinds that spawn on water tiles instead of land. */
export const WATER_ANIMALS: Record<Biome, SpawnWeight[]> = {
  [Biome.Plains]: [{ kind: 'duck', weight: 1 }],
  [Biome.Forest]: [{ kind: 'duck', weight: 1 }],
  [Biome.Desert]: [],
  [Biome.Swamp]: [{ kind: 'duck', weight: 2 }, { kind: 'frog', weight: 1 }],
  [Biome.Mountain]: [],
  [Biome.Snow]: [],
};

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
