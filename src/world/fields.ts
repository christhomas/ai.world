import { WORLD } from '../core/config';
import { TREES, type PropKind } from './biomes';
import { homesOf } from './homes';
import type { Holding } from './holdings';
import type { Person } from './people';
import type { ChunkData, TerrainSampler } from './terrain';
import type { Structure, Village } from './structures';

/**
 * A farm's cleared ground.
 *
 * A clearing is kept in the village's `works` rather than by changing the generated country. The
 * seed therefore still grows byte-for-byte the same world, while replaying the village's ledger
 * removes the same trees on every machine. Each entry names the farm and the tile; the coordinate
 * is the permanent fact, not whichever tree a later version of the generator might put there.
 */
export const FIELD = {
  /** A farm never clears beyond sight of its own buildings. */
  REACH: 8,
  /** Four clearings double an ordinary field and then the holding is full. */
  MOST: 4,
  /** One cleared acre adds one quarter of the founding field's daily crop. */
  FOOD: 1,
} as const;

const BUILT = 'field';

export interface FieldTile {
  x: number;
  z: number;
}

export interface FieldWork extends FieldTile {
  holding: string;
}

/** The ledger entry for one tree permanently taken into a farm's fields. */
export function fieldWork(holding: string, x: number, z: number): string {
  return `${BUILT}:${holding}:${Math.floor(x)},${Math.floor(z)}`;
}

/** Read one field entry. Unknown and old work is not a field. */
export function fieldOfWork(work: string): FieldWork | null {
  const match = /^field:([^:]+):(-?\d+),(-?\d+)$/.exec(work);
  if (!match) return null;
  return { holding: match[1], x: Number(match[2]), z: Number(match[3]) };
}

export function isAField(work: string): boolean {
  return fieldOfWork(work) !== null;
}

/** Everything this ledger has permanently cleared, with duplicate reports collapsed. */
export function clearedFieldTiles(works: readonly string[]): FieldTile[] {
  const tiles = new Map<string, FieldTile>();
  for (const work of works) {
    const field = fieldOfWork(work);
    if (field) tiles.set(`${field.x},${field.z}`, { x: field.x, z: field.z });
  }
  return [...tiles.values()];
}

/** How many clearings belong to one holding. More than the local bound never increases its crop. */
export function fieldsAt(works: readonly string[], holding: string): number {
  const tiles = new Set<string>();
  for (const work of works) {
    const field = fieldOfWork(work);
    if (field?.holding === holding) tiles.add(`${field.x},${field.z}`);
  }
  return Math.min(FIELD.MOST, tiles.size);
}

/** What the worked ground of one farm adds to its founding yield. */
export function foodAt(works: readonly string[], holding: string): number {
  return fieldsAt(works, holding) * FIELD.FOOD;
}

/** What is at the centre of this holding's fields. */
export function farmsteadOf(
  village: Village, holding: Pick<Holding, 'house'>, people: readonly Person[],
): Structure | null {
  if (holding.house !== '') {
    return homesOf(village.houses, people).find((home) => home.family === holding.house)?.house ?? null;
  }
  // A village-owned farm has no family roof. Its stable is the building belonging to the holding;
  // on a small place without one, the square is the only honest local anchor.
  return village.stable?.house ?? village.houses[0] ?? null;
}


/**
 * Trees this farm could turn into fields, nearest its buildings first.
 *
 * The radius and the maximum are both real bounds. The radius keeps a prosperous holding from
 * walking a clear-cut across the county; the maximum keeps a farm in dense forest from becoming a
 * different-sized farm merely because more trunks happened to grow there. The land still decides
 * whether there is anything local to clear.
 */
export function fieldRoomFor(
  sampler: TerrainSampler, village: Village, holding: Holding, people: readonly Person[],
): FieldTile[] {
  const home = farmsteadOf(village, holding, people);
  if (!home) return [];
  const chunks = new Map<string, ChunkData>();
  const candidates: Array<FieldTile & { d: number }> = [];
  const span = FIELD.REACH;
  const side = WORLD.CHUNK_SIZE;
  for (let z = home.tz - span; z <= home.tz + span; z++) {
    for (let x = home.tx - span; x <= home.tx + span; x++) {
      const d = (x - home.tx) ** 2 + (z - home.tz) ** 2;
      if (d > span * span) continue;
      const cx = Math.floor(x / side), cz = Math.floor(z / side);
      const key = `${cx},${cz}`;
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = sampler.generateChunk(cx, cz);
        chunks.set(key, chunk);
      }
      const lx = x - cx * side, lz = z - cz * side;
      const prop = chunk.prop[(lz + 1) * chunk.size + lx + 1] as PropKind;
      if (!TREES.includes(prop)) continue;
      candidates.push({ x, z, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  return candidates.map(({ x, z }) => ({ x, z }));
}

/** Leave permanent fields open while retaining every other generated prop. */
export function withoutClearedTrees<T extends { kind: PropKind; x: number; z: number }>(
  props: Iterable<T>, cleared: ReadonlySet<string>,
): T[] {
  const kept: T[] = [];
  for (const prop of props) {
    const tile = `${Math.floor(prop.x)},${Math.floor(prop.z)}`;
    if (!cleared.has(tile) || !TREES.includes(prop.kind)) kept.push(prop);
  }
  return kept;
}
