/**
 * Gameplay content as records: what the bundled JSON holds, one stable ID per thing in it.
 *
 * `models/`, `properties/`, `behaviours/` and `animations/` are read today as module constants, so
 * changing a wolf means changing source and rebuilding (#624). The catalogue that replaces that
 * stores records rather than files, because a record is what somebody edits: one creature, one
 * behaviour tree, one spawn table. A file is only where a record was first written down.
 *
 * The ID is `kind:name` and never moves. `creature:wolf` is the wolf's properties wherever the file
 * that seeded it says it is filed; `model:wolf` is its body; `spawning:biomes` is who lives where.
 * A file's own `note` is kept as a record of its own, so the split loses nothing and a file can be
 * put back together exactly from what the catalogue holds.
 *
 * Nothing here touches storage. The SQLite catalogue is `server/content.ts`; a solo or native host
 * will keep its own copy behind the same records, which is why this file imports no node module.
 */

/**
 * The shape of a record body. Bumped only by a change that a stored catalogue has to be migrated
 * across, and never by a change of value: values are what the catalogue exists to let change.
 */
export const CONTENT_SCHEMA = 1;

export type ContentKind = 'note' | 'model' | 'creature' | 'tuning' | 'spawning' | 'behaviour' | 'motion';

export interface ContentRecord {
  /** `kind:name`. Stable across releases, and the catalogue's key. */
  readonly id: string;
  readonly kind: ContentKind;
  /** The bundled file that seeds it, from the repository root. */
  readonly source: string;
  /** Its key in that file, or null when it is the whole file. */
  readonly field: string | null;
  /**
   * Where it stands in its file. Order is content here, not tidiness: `spawns.ts` walks a weighted
   * table in the order it was written, so the same roll lands on a different kind if it moves.
   */
  readonly ordinal: number;
  readonly schema: number;
  readonly body: unknown;
  /** The records this one names, which have to exist for it to mean anything. */
  readonly refs: readonly string[];
}

/** A file or record the inventory cannot account for, named so whoever wrote it can find it. */
export class ContentError extends Error {
  constructor(readonly where: string, problem: string) {
    super(`${where}: ${problem}`);
    this.name = 'ContentError';
  }
}

/** The files written as one record per top-level key, and what each key is. */
const SPLIT: Readonly<Record<string, ContentKind>> = {
  'properties/beasts.json': 'creature',
  'properties/birds.json': 'creature',
  'properties/sea.json': 'creature',
  'properties/people.json': 'creature',
  'properties/monsters.json': 'creature',
  'properties/villain.json': 'creature',
  'properties/behaviour.json': 'tuning',
  'properties/spawning.json': 'spawning',
  'behaviours/creatures.json': 'behaviour',
  'behaviours/villagers.json': 'behaviour',
  'behaviours/monsters.json': 'behaviour',
  'behaviours/villain.json': 'behaviour',
  'animations/motion.json': 'motion',
};

/** A body is one file each, named for the creature it draws (`models.ts` `modelFile`). */
const MODEL = /^models\/creatures\/([A-Za-z0-9_-]+)\.json$/;

/** The keys in a spawning table whose own keys are creature kinds, weighted. */
const WEIGHTED = new Set(['land', 'water', 'kinds']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The creature kinds a spawning table names: the keys of a weight table, and the entries of a
 * `night` list. A dungeon's `floors` is a list of weight tables, one per floor.
 */
function spawned(body: unknown, key: string): string[] {
  if (Array.isArray(body)) {
    return body.flatMap((item) => key === 'night' && typeof item === 'string' ? [item]
      : spawned(item, key === 'floors' ? 'kinds' : key));
  }
  if (!isObject(body)) return [];
  if (WEIGHTED.has(key)) return Object.keys(body).filter((name) => name !== 'note');
  return Object.entries(body).flatMap(([name, value]) => name === 'note' ? [] : spawned(value, name));
}

/** What a record names, worked out from its body so an edited body is checked by what it now says. */
function refsOf(kind: ContentKind, name: string, body: unknown): string[] {
  if (kind === 'creature') return [`model:${name}`];
  if (kind === 'spawning') return [...new Set(spawned(body, ''))].sort().map((creature) => `creature:${creature}`);
  return [];
}

/** A record from where it lives and what it says. A body handed back from storage goes through this too. */
export function contentRecord(
  id: string, source: string, field: string | null, ordinal: number, body: unknown,
): ContentRecord {
  const colon = id.indexOf(':');
  const kind = id.slice(0, colon) as ContentKind;
  const name = id.slice(colon + 1);
  if (colon <= 0 || !name) throw new ContentError(source, `"${id}" is not a kind:name record ID`);
  return { id, kind, source, field, ordinal, schema: CONTENT_SCHEMA, body, refs: refsOf(kind, name, body) };
}

/**
 * Split the bundled files into records, in file order.
 *
 * Refuses a file it does not know how to split, an ID two files both claim, and a split that would
 * not put back together as the file it came from — that last one because a seed that is not
 * exactly the bundled defaults is a catalogue that disagrees with the game on its first day.
 */
export function inventory(files: Readonly<Record<string, unknown>>): ContentRecord[] {
  const records: ContentRecord[] = [];
  const claimed = new Map<string, string>();
  const add = (record: ContentRecord): void => {
    const already = claimed.get(record.id);
    if (already !== undefined) throw new ContentError(record.source, `${record.id} is already defined in ${already}`);
    claimed.set(record.id, record.source);
    records.push(record);
  };
  for (const source of Object.keys(files).sort()) {
    const json = files[source];
    const model = MODEL.exec(source);
    if (model) { add(contentRecord(`model:${model[1]}`, source, null, 0, json)); continue; }
    const kind = SPLIT[source];
    if (!kind) throw new ContentError(source, 'is not a gameplay content file the inventory knows how to split');
    if (!isObject(json)) throw new ContentError(source, 'must hold an object of named records');
    Object.entries(json).forEach(([field, body], ordinal) => {
      add(contentRecord(field === 'note' ? `note:${source}` : `${kind}:${field}`, source, field, ordinal, body));
    });
  }
  for (const [source, json] of Object.entries(assemble(records))) {
    if (JSON.stringify(json) !== JSON.stringify(files[source])) {
      throw new ContentError(source, 'does not put back together from its records');
    }
  }
  return records;
}

/** The files the records were split from, in key order, which is what the game's readers take. */
export function assemble(records: readonly ContentRecord[]): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const split = new Map<string, ContentRecord[]>();
  for (const record of records) {
    if (record.field === null) files[record.source] = record.body;
    else split.set(record.source, [...(split.get(record.source) ?? []), record]);
  }
  for (const [source, parts] of split) {
    files[source] = Object.fromEntries([...parts].sort((a, b) => a.ordinal - b.ordinal).map((r) => [r.field, r.body]));
  }
  return Object.fromEntries(Object.keys(files).sort().map((source) => [source, files[source]]));
}

/** Every name a record uses that no record answers to. Empty is the only publishable answer. */
export function brokenReferences(records: readonly ContentRecord[]): string[] {
  const ids = new Set(records.map((record) => record.id));
  return records.flatMap((record) => record.refs.filter((ref) => !ids.has(ref))
    .map((ref) => `${record.id} names ${ref}, which does not exist`));
}
