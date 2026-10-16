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

/**
 * Make `target` hold exactly what `source` holds, keeping the object itself.
 *
 * A published revision is installed into the game's content tables in place (#624), because the
 * rest of the game holds them: an entity holds its kind, the renderer holds a model's parts, a
 * module re-exports a table. Keys keep the order they already had, so a bestiary walked in its
 * written order is walked in the same order after an edit.
 */
export function replaceInPlace<T extends object>(target: T, source: T): T {
  const into = target as Record<string, unknown>;
  for (const key of Object.keys(into)) if (!(key in source)) delete into[key];
  return Object.assign(target, source);
}

/** The same, for a list. */
export function refill<T>(target: T[], source: readonly T[]): T[] {
  target.splice(0, target.length, ...source);
  return target;
}

/** A record as it travels to a client. What it names is worked out again where it lands. */
export interface ContentWire {
  id: string;
  source: string;
  field: string | null;
  ordinal: number;
  body: unknown;
}

/**
 * A short fingerprint of a set of records, so two ends can tell whether they started from the same
 * bundled JSON without sending it to each other. Two FNV-1a passes, 64 bits between them: an
 * accident check between a page and its own server, not a seal against anybody.
 */
export function fingerprint(records: readonly ContentRecord[]): string {
  const text = JSON.stringify(records.map((r) => [r.id, r.source, r.field, r.ordinal, r.body]));
  let a = 0x811c9dc5, b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

const sameRecord = (a: ContentRecord, b: ContentRecord): boolean => a.source === b.source && a.field === b.field
  && a.ordinal === b.ordinal && JSON.stringify(a.body) === JSON.stringify(b.body);

/** What a revision says that a bundle does not: records added or changed, and records it no longer has. */
export function changesFrom(
  bundle: readonly ContentRecord[], revision: readonly ContentRecord[],
): { changed: ContentWire[]; deleted: string[] } {
  const bundled = new Map(bundle.map((record) => [record.id, record]));
  const kept = new Set(revision.map((record) => record.id));
  const changed = revision.filter((record) => {
    const was = bundled.get(record.id);
    return !was || !sameRecord(was, record);
  }).map(({ id, source, field, ordinal, body }) => ({ id, source, field, ordinal, body }));
  return { changed, deleted: bundle.filter((record) => !kept.has(record.id)).map((record) => record.id) };
}

/** A bundle with a revision's changes laid over it, which is that revision again. */
export function withChanges(
  bundle: readonly ContentRecord[], changed: readonly ContentWire[], deleted: readonly string[],
): ContentRecord[] {
  const gone = new Set(deleted);
  const over = new Map(changed.map((wire) => [wire.id, wire]));
  const records = bundle.filter((record) => !gone.has(record.id)).map((record) => {
    const wire = over.get(record.id);
    return wire ? contentRecord(wire.id, wire.source, wire.field, wire.ordinal, wire.body) : record;
  });
  const present = new Set(records.map((record) => record.id));
  for (const wire of changed) {
    if (!present.has(wire.id)) records.push(contentRecord(wire.id, wire.source, wire.field, wire.ordinal, wire.body));
  }
  return records;
}
