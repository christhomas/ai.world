import { WORLD } from '../core/config';
import { TREES, type PropKind } from './biomes';
import { homesOf } from './homes';
import { ownedBy, type Holding, type Owner, type Standing } from './holdings';
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

/**
 * What each farm put on the table today, by whoever is to be paid for it.
 *
 * A farm's crop used to be a property of the *trade*: `broughtIn` gave every farmer the same
 * number whether he stood in a hedged acre or a bare one. A cleared field is an improvement to a
 * holding, so the crop is a property of the *holding* — which means it has to be counted per farm
 * and handed to somebody, and that is what this is.
 *
 * ## Addressed to a purse the village actually holds
 *
 * A farm outlives the family that raised it. `mannedFarms` pairs a field with whoever is standing
 * in it, and the deed on the gate may still name somebody who is under a stone — so an owner read
 * straight off the holding is sometimes a name the village has never heard of, and `pay` reports
 * money sent to one as `unplaced`: *"the one that should never happen at all"*, because a coin
 * that arrives nowhere is exactly what the books cannot see. The hundred-day bench caught it as
 * four village-days where the purses moved less than the roll said they would.
 *
 * So the deed is honoured where there is somebody to honour it to, and otherwise the crop is the
 * worker's — which is the truthful answer as well as the payable one: they stood in the field.
 *
 * `meals` is the same total the larder takes, so the village is fed by the number it pays for. See
 * `whoFed`, which is the other half of that agreement.
 *
 * ## Why the founding yield arrives as a function and not as a number
 *
 * It was one flat number per farm for as long as nothing called this, and that is what kept #384
 * from being a one-line wiring job. A farm is capital, and `mastery.ts` says at length that the
 * paddocks hold what the paddocks hold and a holding does not get better at anything. A *hand*
 * does, and the founding field is the hand's work — so one number per gate pays a farmer who came
 * of age this morning exactly what it pays one of forty days, while `broughtIn` goes on feeding
 * the village the novice's smaller crop. That is the same fault this function exists to remove,
 * wearing the other coat.
 *
 * So the rate is asked of the man standing in the field, and `food.ts: theirField` is what every
 * caller hands over — the single expression of a crop that `broughtIn` reads too. What the farm
 * adds on top of it is `foodAt`, and that stays flat: the acres are the capital, and the argument
 * above is exactly that capital does not learn.
 */
export function fieldCrop(
  people: readonly Person[], working: readonly Person[], farmers: readonly Person[],
  farms: readonly Standing[] | null, works: readonly string[],
  grownBy: (worker: Person) => number,
): { fields: Map<Owner, number>; meals: number } {
  const fields = new Map<Owner, number>();
  let meals = 0;
  const add = (owner: Owner, much: number): void => {
    fields.set(owner, (fields.get(owner) ?? 0) + much);
    meals += much;
  };
  const here = new Set(people.map(ownedBy));
  if (farms) {
    const byId = new Map(working.map((person) => [person.id, person]));
    for (const farm of farms) {
      const worker = byId.get(farm.worker ?? '');
      if (!worker) continue;
      const owner = farm.owner ?? ownedBy(worker);
      add(here.has(owner) ? owner : ownedBy(worker), grownBy(worker) + foodAt(works, farm.id ?? ''));
    }
  } else {
    for (const farmer of farmers) add(ownedBy(farmer), grownBy(farmer));
  }
  return { fields, meals };
}
