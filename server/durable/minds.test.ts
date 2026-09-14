import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrateDomain, openDurable, versionOf } from './db';
import { HeldMinds, holdsAnything, keepMinds, migrateMinds, mindsOf } from './minds';
import type { Person } from '../../src/world/people';

/**
 * The half of a villager that no seed implies, kept across a restart.
 *
 * Everything else about a village is worked out again by every machine that looks at it. This is
 * the exception `remembering.ts` names — *"what a man thinks of you follows from what you did, and
 * what you did happened on your screen"* — and it was held only in the server's memory, so every
 * restart wiped every villager's opinion of every player and nothing anywhere said so.
 */
const book = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS schema (domain TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  migrateMinds(db);
  return db;
};

const villager = (id: string, held: Partial<Person> = {}): Person =>
  ({ id, name: id, memories: [], opinions: [], ...held } as Person);

const aMemory = (who: string, day = 3) => ({ what: 'saved' as const, who, day });

/*
 * How many rows a world holds, counted here rather than exported from `minds.ts`.
 *
 * Nothing in the game needs to ask it, and an export only a test reaches is the thing
 * `reachable.test.ts` exists to catch — so the count is the test's own business.
 */
const rowsFor = (db: DatabaseSync, world: number): number =>
  Number((db.prepare('SELECT count(*) AS many FROM mind WHERE world = ?').get(world) as { many: number }).many);
const anOpinion = (who: string) => ({ who, regard: 4, times: 2, day: 3, keenest: null, kept: false });

describe('what a villager holds, written down', () => {
  it('comes back word for word', () => {
    const db = book();
    const greta = villager('p1', { memories: [aMemory('the traveller')], opinions: [anOpinion('the traveller')] });
    keepMinds(db, 3, [greta]);

    const { minds } = mindsOf(db, 3);
    expect(minds.get('p1')).toEqual({ memories: [aMemory('the traveller')], opinions: [anOpinion('the traveller')] });
  });

  /*
   * A world has thousands of people in it and almost none of them have ever met a player. A row
   * each would be a table that grows with the map rather than with the playing.
   */
  it('is not written at all for somebody who has met nobody', () => {
    const db = book();
    keepMinds(db, 3, [villager('p1'), villager('p2')]);
    expect(rowsFor(db, 3)).toBe(0);
  });

  it('and stops being written once the last of it has faded', () => {
    const db = book();
    const person = villager('p1', { memories: [aMemory('the traveller')] });
    keepMinds(db, 3, [person]);
    expect(rowsFor(db, 3)).toBe(1);

    person.memories = [];
    const said = keepMinds(db, 3, [person]);
    expect(said.forgotten, 'the row goes, or the storage undoes the compaction upstream').toBe(1);
    expect(rowsFor(db, 3)).toBe(0);
  });

  it('keeps one world apart from another', () => {
    const db = book();
    keepMinds(db, 3, [villager('p1', { memories: [aMemory('a')] })]);
    keepMinds(db, 7, [villager('p1', { memories: [aMemory('b')] })]);
    expect(mindsOf(db, 3).minds.get('p1')?.memories[0].who).toBe('a');
    expect(mindsOf(db, 7).minds.get('p1')?.memories[0].who).toBe('b');
  });

  it('replaces what was there rather than adding to it', () => {
    const db = book();
    const person = villager('p1', { memories: [aMemory('a')] });
    keepMinds(db, 3, [person]);
    person.memories = [aMemory('b')];
    keepMinds(db, 3, [person]);
    expect(mindsOf(db, 3).minds.get('p1')?.memories).toEqual([aMemory('b')]);
  });

  it('says whether anybody holds anything at all', () => {
    expect(holdsAnything(villager('p1'))).toBe(false);
    expect(holdsAnything(villager('p1', { memories: [aMemory('a')] }))).toBe(true);
    expect(holdsAnything(villager('p1', { opinions: [anOpinion('a')] }))).toBe(true);
  });

});

/**
 * And giving it back, which cannot be done all at once when the world opens.
 *
 * A village is lived when somebody walks into it, so the register's roll starts empty and fills as
 * the world is explored. A restore done once at boot puts everybody's memories into nobody.
 */
describe('putting it back into the people as they are grown', () => {
  it('gives each villager what was kept for them', () => {
    const db = book();
    keepMinds(db, 3, [villager('p1', { memories: [aMemory('the traveller')] })]);
    const grown = [villager('p1'), villager('p2')];
    expect(new HeldMinds(mindsOf(db, 3).minds).giveTo(grown)).toBe(1);
    expect(grown[0].memories).toEqual([aMemory('the traveller')]);
    expect(grown[1].memories, 'and leaves everybody else as the seed made them').toEqual([]);
  });

  it('goes on waiting for a village nobody has walked into yet', () => {
    const db = book();
    keepMinds(db, 3, [villager('later', { memories: [aMemory('a')] })]);
    const held = new HeldMinds(mindsOf(db, 3).minds);

    expect(held.giveTo([villager('p1')]), 'that village has not been lived yet').toBe(0);
    expect(held.waiting).toBe(1);

    const arrived = villager('later');
    expect(held.giveTo([arrived]), 'and now it has').toBe(1);
    expect(arrived.memories).toEqual([aMemory('a')]);
    expect(held.waiting).toBe(0);
  });

  /*
   * The other half, and the one that would be a bug nobody could reproduce: a second pass must not
   * overwrite what has happened *since* with the copy off the disk, or somebody remembered at
   * breakfast is forgotten again at noon.
   */
  it('gives it once, and never undoes what has happened since', () => {
    const db = book();
    keepMinds(db, 3, [villager('p1', { memories: [aMemory('the traveller')] })]);
    const held = new HeldMinds(mindsOf(db, 3).minds);
    const person = villager('p1');

    expect(held.giveTo([person])).toBe(1);
    person.memories = [aMemory('somebody else', 9)];
    expect(held.giveTo([person]), 'a second pass gives nothing').toBe(0);
    expect(person.memories, 'and the newer memory stands').toEqual([aMemory('somebody else', 9)]);
  });
});

/**
 * And the failures, which are the part of a persistence layer worth writing tests for.
 */
describe('when the file has been damaged', () => {
  it('drops the row it cannot read and says which, rather than refusing to start', () => {
    const db = book();
    keepMinds(db, 3, [villager('p1', { memories: [aMemory('a')] }), villager('p2', { memories: [aMemory('b')] })]);
    db.prepare('UPDATE mind SET memories = ? WHERE villager = ?').run('{not json', 'p1');

    const { minds, unreadable } = mindsOf(db, 3);
    expect(unreadable, 'named, so the caller can say so out loud').toEqual(['p1']);
    expect(minds.has('p1')).toBe(false);
    expect(minds.get('p2')?.memories, 'and the rest of the village is unharmed').toEqual([aMemory('b')]);
  });

  it('drops a row whose json is valid and is not a list', () => {
    const db = book();
    keepMinds(db, 3, [villager('p1', { memories: [aMemory('a')] })]);
    db.prepare('UPDATE mind SET opinions = ? WHERE villager = ?').run('{"not":"a list"}', 'p1');
    expect(mindsOf(db, 3).unreadable).toEqual(['p1']);
  });

  /*
   * A restart in the middle of a save must not leave half a village remembering you and half of it
   * not — that is worse than losing all of it, because it is a village that disagrees with itself
   * and nobody would ever work out why.
   */
  it('writes a whole village or none of it', () => {
    const db = book();
    keepMinds(db, 3, [villager('p1', { memories: [aMemory('a')] })]);
    const people = [villager('p2', { memories: [aMemory('b')] }), villager('p3', { memories: [aMemory('c')] })];
    // a person the JSON cannot be made from: the write must roll back rather than land half of it
    const bad = { id: 'p4', memories: [] as unknown[], opinions: [] } as unknown as Person;
    (bad.memories as unknown[]).push(bad);                           // a cycle JSON.stringify throws on
    expect(() => keepMinds(db, 3, [...people, bad])).toThrow();
    expect(rowsFor(db, 3), 'only the row that was already there').toBe(1);
  });
});

/**
 * The two domains in one file, which is what #104 asks for and what makes a shared version counter
 * impossible.
 */
describe('one database, two owners', () => {
  it('migrates each domain on its own count', () => {
    const db = openDurable(':memory:');
    migrateDomain(db, 'one', ['CREATE TABLE a (x INTEGER)']);
    migrateDomain(db, 'two', ['CREATE TABLE b (x INTEGER)', 'CREATE TABLE c (x INTEGER)']);
    expect(versionOf(db, 'one')).toBe(1);
    expect(versionOf(db, 'two')).toBe(2);
    expect(versionOf(db, 'never-heard-of-it')).toBe(0);
  });

  it('runs a migration once however many times it is opened', () => {
    const db = openDurable(':memory:');
    const steps = ['CREATE TABLE a (x INTEGER)'];
    expect(migrateDomain(db, 'one', steps)).toBe(1);
    expect(() => migrateDomain(db, 'one', steps), 'a second open must not re-run it').not.toThrow();
  });

  it('leaves the version where it was when a step throws', () => {
    const db = openDurable(':memory:');
    expect(() => migrateDomain(db, 'one', ['CREATE TABLE a (x INTEGER)', 'THIS IS NOT SQL'])).toThrow();
    expect(versionOf(db, 'one'), 'the step that worked is kept, the one that did not is not').toBe(1);
  });
});
