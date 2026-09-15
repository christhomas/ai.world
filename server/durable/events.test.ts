import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEEPS, type Entry } from '../chronicle';
import { Simulation } from '../sim';
import { startServer } from '../serve';
import { openDurable, migrateDomain, versionOf } from './db';
import { EVENTS_SCHEMA, eventsOf, keepEvents } from './events';

const died = (n: number): Entry => ({
  kind: 'died', id: `id-${n}`, name: `Soul${n}`, village: 'Ashford', day: n,
  cause: 'age', at: 1_800_000_000_000 + n, n,
});

describe('the durable parish chronicle', () => {
  let dir = '';

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  const database = () => {
    dir = mkdtempSync(join(tmpdir(), 'chronicle-'));
    const db = openDurable(join(dir, 'ai-world.sqlite'));
    migrateDomain(db, 'chronicle', EVENTS_SCHEMA);
    return db;
  };

  it('has its own versioned domain in the shared database', () => {
    const db = database();
    expect(versionOf(db, 'chronicle')).toBe(EVENTS_SCHEMA.length);
    db.close();
  });

  it('writes meaningful village changes and reads them back in order', () => {
    const db = database();
    const entries: Entry[] = [
      { kind: 'born', id: 'a', name: 'Kees', village: 'Ashford', day: 9, at: 101, n: 1 },
      { kind: 'lost', id: 'Thornby', name: 'Thornby', village: 'Thornby', day: 10, at: 102, n: 2 },
      { kind: 'resettled', id: 'b', name: 'Greta', village: 'Thornby', from: 'Ashford', day: 40, at: 103, n: 3 },
    ];
    keepEvents(db, 3, entries);
    expect(eventsOf(db, 3).entries).toEqual(entries);
    db.close();
  });

  it('keeps only the same bounded window the HTTP Chronicle keeps', () => {
    const db = database();
    keepEvents(db, 3, Array.from({ length: KEEPS + 7 }, (_, at) => died(at + 1)));
    const restored = eventsOf(db, 3).entries;
    expect(restored).toHaveLength(KEEPS);
    expect(restored[0].n, 'the oldest rows were pruned, not the newest').toBe(8);
    expect(restored.at(-1)?.n).toBe(KEEPS + 7);
    db.close();
  });

  it('names a malformed row and keeps valid neighbours rather than replacing the book', () => {
    const db = database();
    keepEvents(db, 3, [died(1), died(3)]);
    db.prepare('INSERT INTO chronicle_event (world, n, happened, entry) VALUES (?, ?, ?, ?)')
      .run(3, 9, 109, '{not json');
    const restored = eventsOf(db, 3);
    expect(restored.entries.map((entry) => entry.n)).toEqual([1, 3]);
    expect(restored.unreadable).toEqual([9]);
    expect(restored.latest, 'a corrupt row must not make the cursor run backwards').toBe(9);
    expect(db.prepare('SELECT count(*) AS n FROM chronicle_event WHERE world = ?').get(3))
      .toMatchObject({ n: 3 });
    db.close();
  });

  it('is served again after a real server restart on the same database', async () => {
    const db = database();
    const first = new Simulation({ chronicles: db });
    first.chronicleOf(12).record([
      { kind: 'lost', id: 'Thornby', name: 'Thornby', village: 'Thornby', day: 9 },
    ], 101);
    db.close();

    const server = await startServer({
      port: 0, quiet: true, dataDir: join(dir, 'worlds'),
      durableDb: join(dir, 'ai-world.sqlite'), operatorToken: 'the watcher',
    });
    const response = await fetch(`http://127.0.0.1:${server.port}/registry?seed=12`, {
      headers: { 'x-operator-token': 'the watcher' },
    });
    const book = await response.json() as { happened: Entry[]; latest: number };
    expect(response.status).toBe(200);
    expect(book.happened.map((entry) => entry.kind)).toEqual(['lost']);
    expect(book.latest).toBe(1);
    await server.close();
  });
});
