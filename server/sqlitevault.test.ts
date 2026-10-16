import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDurable } from './durable/db';
import { Rooms } from './rooms';
import { SqliteVault } from './sqlitevault';
import { worldPath } from './world';
import { provincePath } from '../src/world/provinces';

describe('SQLite owns server world documents', () => {
  const directories: string[] = [];
  const databases: DatabaseSync[] = [];
  const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'sqlite-worlds-')); directories.push(dir); return dir; };
  const open = (path: string) => { const db = openDurable(path); databases.push(db); return db; };
  const close = (db: DatabaseSync) => { db.close(); databases.splice(databases.indexOf(db), 1); };
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps names, clock, changes and provinces through database reopen without creating JSON files', () => {
    const dir = scratch(), file = join(dir, 'ai-world.sqlite');
    let db = open(file);
    const vault = new SqliteVault(db, dir);
    const rooms = new Rooms(dir, vault);
    const record = rooms.claimWorld('Oak Vale', 77, 'endless');
    const room = rooms.open(77, { day: 9, time: 0.5 }, record);
    room.world.apply({ kind: 'chest', id: 'old-vault' });
    room.world.save(true);
    const province = provincePath(dir, 77, '2:-1');
    vault.write(province, JSON.stringify({ when: 9, deltas: [{ kind: 'chest', id: 'far-vault' }] }));
    expect(readdirSync(dir).filter(name => name.endsWith('.json'))).toEqual([]);
    close(db);

    db = open(file);
    const restored = new SqliteVault(db, dir);
    const again = new Rooms(dir, restored);
    expect(again.knownWorlds()).toEqual([{ name: 'Oak Vale', seed: 77, kind: 'endless' }]);
    expect(again.worldCount).toBe(0);
    const world = again.open(77, { day: 1, time: 0.3 }, again.worldRecord('Oak Vale'));
    expect(world.world.clock).toEqual({ day: 9, time: 0.5 });
    expect(world.world.log).toContainEqual({ kind: 'chest', id: 'old-vault' });
    expect(JSON.parse(restored.read(province)!)).toEqual({ when: 9, deltas: [{ kind: 'chest', id: 'far-vault' }] });
  });

  it('imports all legacy world bytes atomically, preserves originals and never replays stale files', () => {
    const dir = scratch(), file = join(dir, 'ai-world.sqlite');
    const records = JSON.stringify([{ name: 'Old Vale', seed: 77 }]);
    const snapshot = JSON.stringify({ seed: 77, clock: { day: 12, time: 0.4 }, deltas: [] });
    mkdirSync(join(dir, '77'));
    writeFileSync(join(dir, 'world-records.json'), records);
    writeFileSync(join(dir, '77.json'), snapshot);
    writeFileSync(join(dir, '77/2_-1.json'), '{"when":12,"deltas":[]}');
    writeFileSync(join(dir, 'unrelated.json'), '{"private":true}');
    let db = open(file);
    const vault = new SqliteVault(db, dir);
    expect(new Rooms(dir, vault).knownWorlds()).toEqual([{ name: 'Old Vale', seed: 77, kind: 'endless' }]);
    expect(vault.read(join(dir, '77/2_-1.json'))).toBe('{"when":12,"deltas":[]}');
    expect(vault.read(join(dir, 'unrelated.json'))).toBeNull();
    expect(readFileSync(join(dir, '77.json'), 'utf8')).toBe(snapshot);
    const current = '{"seed":77,"clock":{"day":20,"time":0.8},"deltas":[]}';
    vault.write(worldPath(dir, 77), current);
    close(db);
    db = open(file);
    expect(new SqliteVault(db, dir).read(worldPath(dir, 77))).toBe(current);
    expect(readFileSync(join(dir, 'world-records.json'), 'utf8')).toBe(records);
  });

  it('rolls back a failed legacy import and permits explicit recovery on the next start', () => {
    const dir = scratch(), file = join(dir, 'ai-world.sqlite');
    writeFileSync(join(dir, 'world-records.json'), '[{"name":"Old Vale","seed":77}]');
    writeFileSync(join(dir, '1.json'), '{"seed":1,"clock":{"day":1,"time":0.3},"deltas":[]}');
    const blocked = join(dir, '77.json');
    // Reject a world path that reaches outside the data volume instead of following its symlink.
    symlinkSync(join(dir, 'absent.json'), blocked);
    const db = open(file);
    expect(() => new SqliteVault(db, dir)).toThrow('not a regular file');
    expect(db.prepare('SELECT count(*) AS n FROM world_document').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM world_import').get()).toEqual({ n: 0 });
    // The fixture repairs only its own broken link; no migration deletes or changes original files.
    rmSync(blocked);
    writeFileSync(blocked, '{"seed":77,"clock":{"day":4,"time":0.2},"deltas":[]}');
    expect(new Rooms(dir, new SqliteVault(db, dir)).knownWorlds()).toEqual([
      { name: 'Old Vale', seed: 77, kind: 'endless' }, { seed: 1 },
    ]);
  });

  it('retains a damaged registry and refuses to claim over it', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'world-records.json'), '{truncated');
    const vault = new SqliteVault(open(join(dir, 'ai-world.sqlite')), dir);
    const rooms = new Rooms(dir, vault);
    expect(() => rooms.claimWorld('New Vale', 7)).toThrow('registry on this server could not be read');
    expect(vault.read(join(dir, 'world-records.json'))).toBe('{truncated');
    expect(readFileSync(join(dir, 'world-records.json'), 'utf8')).toBe('{truncated');
  });

  it('reports the original import error when SQLite has already rolled back the transaction', () => {
    const dir = scratch();
    const db = open(join(dir, 'ai-world.sqlite'));
    new SqliteVault(db, dir);
    db.exec('DELETE FROM world_import');
    writeFileSync(worldPath(dir, 77), 'legacy snapshot');
    db.exec("CREATE TRIGGER reject_legacy BEFORE INSERT ON world_document BEGIN SELECT RAISE(ROLLBACK, 'original import failure'); END");
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => new SqliteVault(db, dir)).toThrow('original import failure');
      expect(logged).toHaveBeenCalledWith('Could not roll back legacy world import:', expect.any(Error));
      expect(db.prepare('SELECT count(*) AS n FROM world_document').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT count(*) AS n FROM world_import').get()).toEqual({ n: 0 });
    } finally { logged.mockRestore(); }
    db.exec('DROP TRIGGER reject_legacy');
    expect(new SqliteVault(db, dir).read(worldPath(dir, 77))).toBe('legacy snapshot');
  });

  it('seeds missing keys once without overwriting an existing database snapshot', () => {
    const dir = scratch();
    const db = open(join(dir, 'ai-world.sqlite'));
    const vault = new SqliteVault(db, dir);
    vault.write(worldPath(dir, 77), 'database owns this snapshot');
    // Model an already populated database whose legacy import has not completed yet.
    db.exec('DELETE FROM world_import');
    writeFileSync(worldPath(dir, 77), 'older disk snapshot');
    writeFileSync(worldPath(dir, 88), 'legacy world not yet imported');
    const again = new SqliteVault(db, dir);
    expect(again.read(worldPath(dir, 77))).toBe('database owns this snapshot');
    expect(again.read(worldPath(dir, 88))).toBe('legacy world not yet imported');
    writeFileSync(worldPath(dir, 99), 'arrived after import');
    expect(new SqliteVault(db, dir).read(worldPath(dir, 99))).toBeNull();
  });

  it('uses portable keys, literal prefixes and propagates failed writes without losing the prior snapshot', () => {
    const dir = scratch(), moved = scratch();
    const db = open(join(dir, 'ai-world.sqlite'));
    const vault = new SqliteVault(db, dir);
    vault.write(join(dir, '77/2_-1.json'), 'kept');
    vault.write(join(dir, '77/2x-1.json'), 'other');
    expect(vault.list(join(dir, '77/2_'))).toEqual([join(dir, '77/2_-1.json')]);
    expect(new SqliteVault(db, moved).read(join(moved, '77/2_-1.json'))).toBe('kept');
    expect(() => vault.read(join(dir, '../outside.json'))).toThrow('outside its data directory');
    db.exec("CREATE TRIGGER reject_world_update BEFORE UPDATE ON world_document BEGIN SELECT RAISE(ABORT, 'disk write refused'); END");
    expect(() => vault.write(join(dir, '77/2_-1.json'), 'lost')).toThrow('disk write refused');
    expect(vault.read(join(dir, '77/2_-1.json'))).toBe('kept');
  });
});
