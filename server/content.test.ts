import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDurable } from './durable/db';
import { ContentCatalogue } from './content';
import { ContentError, assemble, brokenReferences, inventory, type ContentRecord } from '../src/core/content';
import { DEFAULT_CONTENT } from '../src/core/contentDefaults';

const DIRECTORIES = ['animations', 'behaviours', 'models/creatures', 'properties'];

/** The bundled defaults with one record's body replaced, as a later build might carry them. */
const withBody = (records: readonly ContentRecord[], id: string, body: unknown): ContentRecord[] => {
  expect(records.some((record) => record.id === id), `${id} is a default`).toBe(true);
  return records.map((record) => record.id === id ? { ...record, body } : record);
};
const bodyOf = (records: readonly ContentRecord[], id: string): unknown => records.find((record) => record.id === id)?.body;

describe('the bundled content as records', () => {
  const records = inventory(DEFAULT_CONTENT);

  it('lists every gameplay JSON file the game bundles', () => {
    const onDisk = DIRECTORIES.flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => `${dir}/${name}`));
    expect(onDisk.length).toBeGreaterThan(50);
    expect(Object.keys(DEFAULT_CONTENT).sort()).toEqual(onDisk.sort());
    for (const path of onDisk) expect(DEFAULT_CONTENT[path], path).toEqual(JSON.parse(readFileSync(path, 'utf8')));
  });

  it('gives each model, creature, behaviour, table and motion one stable ID', () => {
    const ids = new Set(records.map((record) => record.id));
    expect(ids.size).toBe(records.length);
    for (const id of ['model:wolf', 'creature:wolf', 'creature:nettle', 'behaviour:grazer', 'behaviour:innkeeper',
      'spawning:biomes', 'spawning:dungeon', 'tuning:fleeing', 'motion:blows', 'note:properties/beasts.json']) {
      expect(ids, id).toContain(id);
    }
    const models = records.filter((record) => record.kind === 'model').map((record) => record.id.slice('model:'.length));
    const creatures = records.filter((record) => record.kind === 'creature').map((record) => record.id.slice('creature:'.length));
    expect(models.length).toBe(readdirSync('models/creatures').length);
    expect(creatures.sort()).toEqual(models.sort());
  });

  it('puts every file back together exactly, key order included', () => {
    const files = assemble(records);
    expect(Object.keys(files)).toEqual(Object.keys(DEFAULT_CONTENT).sort());
    for (const [path, json] of Object.entries(files)) expect(JSON.stringify(json), path).toBe(JSON.stringify(DEFAULT_CONTENT[path]));
  });

  it('follows what each spawn table and creature names, and every name resolves', () => {
    const biomes = records.find((record) => record.id === 'spawning:biomes')!;
    expect(biomes.refs).toEqual(expect.arrayContaining(['creature:cow', 'creature:duck', 'creature:wolf', 'creature:bat']));
    expect(records.find((record) => record.id === 'spawning:dungeon')!.refs).toContain('creature:skeleton');
    expect(records.find((record) => record.id === 'spawning:reach')!.refs).toEqual([]);
    expect(records.find((record) => record.id === 'creature:wolf')!.refs).toEqual(['model:wolf']);
    expect(brokenReferences(records)).toEqual([]);
  });

  it('refuses a file it cannot split, an ID claimed twice and a table naming a missing creature', () => {
    expect(() => inventory({ ...DEFAULT_CONTENT, 'properties/unknown.json': {} })).toThrow(ContentError);
    const behaviours = DEFAULT_CONTENT['behaviours/villain.json'] as Record<string, unknown>;
    expect(Object.keys(behaviours)).toContain('nettle');
    expect(() => inventory({ ...DEFAULT_CONTENT, 'behaviours/monsters.json': { ...(DEFAULT_CONTENT['behaviours/monsters.json'] as object), nettle: behaviours.nettle } }))
      .toThrow('behaviour:nettle is already defined');
    const spawning = DEFAULT_CONTENT['properties/spawning.json'] as Record<string, Record<string, unknown>>;
    const broken = inventory({ ...DEFAULT_CONTENT, 'properties/spawning.json': { ...spawning, deep: { kinds: { shark: 7, kraken: 1 } } } });
    expect(brokenReferences(broken)).toEqual(['spawning:deep names creature:kraken, which does not exist']);
  });
});

describe('the SQLite content catalogue', () => {
  const directories: string[] = [];
  const databases: DatabaseSync[] = [];
  const defaults = inventory(DEFAULT_CONTENT);
  const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'content-catalogue-')); directories.push(dir); return join(dir, 'ai-world.sqlite'); };
  const open = (file: string) => { const db = openDurable(file); databases.push(db); return db; };
  const close = (db: DatabaseSync) => { db.close(); databases.splice(databases.indexOf(db), 1); };
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('seeds a new database once from the bundled records', () => {
    const catalogue = new ContentCatalogue(open(scratch()), defaults);
    expect(catalogue.head()).toBe(1);
    expect(catalogue.revisions().map((revision) => [revision.reason, revision.author, revision.parent]))
      .toEqual([['seed', 'bundled defaults', null]]);
    expect(catalogue.revisions()[0].defaultsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(assemble(catalogue.records())).toEqual(assemble(defaults));
  });

  it('keeps an edit through a restart that bundles different defaults', () => {
    const file = scratch();
    let db = open(file);
    const first = new ContentCatalogue(db, defaults);
    const wolf = bodyOf(defaults, 'creature:wolf') as { speed: number };
    expect(wolf.speed).not.toBe(9);
    const edited = first.edit(1, [{ id: 'creature:wolf', body: { ...wolf, speed: 9 } }], 'operator', 'faster wolves');
    expect(edited).toBe(2);
    close(db);

    // A redeploy whose JSON says something else about both wolves and bears, at the same version.
    const bear = bodyOf(defaults, 'creature:bear') as { hp: number };
    const rebuilt = withBody(withBody(defaults, 'creature:wolf', { ...wolf, speed: 1 }), 'creature:bear', { ...bear, hp: bear.hp + 50 });
    db = open(file);
    const again = new ContentCatalogue(db, rebuilt);
    expect(again.head()).toBe(2);
    expect((bodyOf(again.records(), 'creature:wolf') as { speed: number }).speed).toBe(9);
    expect(bodyOf(again.records(), 'creature:bear')).toEqual(bear);
    expect(again.revisions().map((revision) => revision.reason)).toEqual(['seed', 'edit']);
    expect(again.revisions()[1]).toMatchObject({ author: 'operator', note: 'faster wolves', parent: 1 });
  });

  it('refuses a stale, unknown or dangling edit and leaves the head where it was', () => {
    const catalogue = new ContentCatalogue(open(scratch()), defaults);
    const wolf = bodyOf(defaults, 'creature:wolf') as object;
    catalogue.edit(1, [{ id: 'creature:wolf', body: { ...wolf, hp: 31 } }], 'first');
    expect(() => catalogue.edit(1, [{ id: 'creature:wolf', body: { ...wolf, hp: 32 } }], 'second')).toThrow('made against revision 1');
    expect(() => catalogue.edit(2, [{ id: 'creature:unicorn', body: {} }], 'second')).toThrow('not a record');
    // Deleting a model the wolf still names would publish a creature nothing can draw.
    expect(() => catalogue.edit(2, [{ id: 'model:wolf', body: null }], 'second')).toThrow('creature:wolf names model:wolf');
    expect(catalogue.head()).toBe(2);
    expect((bodyOf(catalogue.records(), 'creature:wolf') as { hp: number }).hp).toBe(31);
    expect(catalogue.records(1)).toEqual(defaults.map((record) => expect.objectContaining({ id: record.id })));
  });

  it('upgrades only what nobody has edited or deleted, when the defaults version is raised', () => {
    const file = scratch();
    let db = open(file);
    const catalogue = new ContentCatalogue(db, defaults);
    const wolf = bodyOf(defaults, 'creature:wolf') as { hp: number };
    const bear = bodyOf(defaults, 'creature:bear') as { hp: number };
    const spawning = bodyOf(defaults, 'spawning:deep') as { kinds: Record<string, number> };
    catalogue.edit(1, [{ id: 'creature:wolf', body: { ...wolf, hp: 99 } }], 'operator');
    catalogue.edit(2, [{ id: 'spawning:deep', body: null }], 'operator', 'no sea monsters');
    expect(catalogue.records().some((record) => record.id === 'spawning:deep')).toBe(false);
    close(db);

    const shark = (id: string) => defaults.find((record) => record.id === id)!;
    const kraken: ContentRecord[] = [
      { ...shark('creature:shark'), id: 'creature:kraken', field: 'kraken' },
      { ...shark('model:shark'), id: 'model:kraken', source: 'models/creatures/kraken.json' },
    ];
    let next = withBody(defaults, 'creature:wolf', { ...wolf, hp: 1 });
    next = withBody(next, 'creature:bear', { ...bear, hp: bear.hp + 5 });
    next = withBody(next, 'spawning:deep', { ...spawning, kinds: { ...spawning.kinds, orca: 9 } });
    next = [...next, ...kraken];
    db = open(file);
    const upgraded = new ContentCatalogue(db, next, 2);
    expect(upgraded.head()).toBe(4);
    expect(upgraded.revisions().at(-1)).toMatchObject({ reason: 'upgrade', defaults: 2, parent: 3 });
    const records = upgraded.records();
    expect((bodyOf(records, 'creature:wolf') as { hp: number }).hp).toBe(99);
    expect((bodyOf(records, 'creature:bear') as { hp: number }).hp).toBe(bear.hp + 5);
    expect(records.some((record) => record.id === 'spawning:deep')).toBe(false);
    expect(records.some((record) => record.id === 'creature:kraken')).toBe(true);
    close(db);

    // Opening at the version it already has is a restart, not another upgrade.
    db = open(file);
    expect(new ContentCatalogue(db, next, 2).head()).toBe(4);
  });

  it('leaves the previous revision intact when an upgrade would publish a broken reference', () => {
    const file = scratch();
    let db = open(file);
    new ContentCatalogue(db, defaults);
    close(db);
    const spawning = bodyOf(defaults, 'spawning:highland') as { kinds: Record<string, number> };
    // The catalogue works out what a body names itself, so a griffin in the table is enough.
    const broken = withBody(defaults, 'spawning:highland', { ...spawning, kinds: { ...spawning.kinds, griffin: 1 } });
    db = open(file);
    expect(() => new ContentCatalogue(db, broken, 2)).toThrow('spawning:highland names creature:griffin');
    const kept = new ContentCatalogue(db, defaults);
    expect(kept.head()).toBe(1);
    expect(kept.revisions()).toHaveLength(1);
    expect(bodyOf(kept.records(), 'spawning:highland')).toEqual(spawning);
  });

  it('refuses to rewrite or delete history', () => {
    const db = open(scratch());
    new ContentCatalogue(db, defaults);
    expect(() => db.exec("UPDATE content_record SET body = '{}' WHERE id = 'creature:wolf'")).toThrow('immutable');
    expect(() => db.exec('DELETE FROM content_record')).toThrow('immutable');
    expect(() => db.exec("UPDATE content_revision SET author = 'someone else'")).toThrow('immutable');
    expect(() => db.exec('DELETE FROM content_revision')).toThrow('immutable');
  });
});
