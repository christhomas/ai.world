import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDurable } from './durable/db';
import { addAccount, migrate } from './tools/accounts';
import { startServer, type RunningServer } from './serve';

describe('tools and the simulation share SQLite worlds', () => {
  let dir = '', server: RunningServer | null = null;
  afterEach(async () => {
    await server?.close(); server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('imports legacy worlds, lists database-only worlds and restores saved edits after server restart', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sqlite-tools-'));
    const file = join(dir, 'ai-world.sqlite');
    const db = openDurable(file);
    migrate(db);
    addAccount(db, 'operator', 'a password for the hosted regression');
    db.close();
    const legacy = JSON.stringify([{ name: 'Old Vale', seed: 322 }, { name: 'Crossroads', seed: 7, kind: 'road' }]);
    writeFileSync(join(dir, 'world-records.json'), legacy);
    const start = () => startServer({ port: 0, quiet: true, dataDir: dir, toolsSecret: 'hosted world regression signing key' });
    server = await start();
    const at = (path: string) => `http://127.0.0.1:${server!.port}${path}`;
    const login = await fetch(at('/tools/login'), { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'operator', password: 'a password for the hosted regression' }) });
    expect(login.status).toBe(303);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const get = (path: string) => fetch(at(path), { headers: { cookie }, redirect: 'manual' });
    const record = server.rooms.claimWorld('Database Vale', 77, 'endless');
    const room = server.rooms.open(77, { day: 9, time: 0.5 }, record);
    room.world.apply({ kind: 'chest', id: 'kept-in-database' });
    room.world.save(true);
    server.rooms.close(77);

    const before = await (await get('/tools/world-editor/data?name=Old%20Vale')).json() as { revision: string };
    const draft = { x: 256, z: 256, reach: 80, lift: 12, roughness: 0.4, seed: 7 };
    const edited = await fetch(at('/tools/world-editor/data'), { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Old Vale', revision: before.revision, mode: 'mountain', draft }) });
    expect(edited.status, await edited.text()).toBe(200);
    await server.close(); server = null;

    const kept = new DatabaseSync(file, { readOnly: true });
    try {
      const names = kept.prepare('SELECT body FROM world_document WHERE key = ?').get('world-records.json');
      expect(JSON.parse(String(names?.body))).toContainEqual({ name: 'Database Vale', seed: 77 });
      expect(kept.prepare('SELECT body FROM world_document WHERE key = ?').get('77.json')).toBeDefined();
      expect(kept.prepare('SELECT body FROM world_document WHERE key = ?').get('322.json')).toBeDefined();
    } finally { kept.close(); }
    expect(readFileSync(join(dir, 'world-records.json'), 'utf8')).toBe(legacy);
    expect(readdirSync(dir).filter(name => name.endsWith('.json'))).toEqual(['world-records.json']);

    server = await start();
    expect(server.rooms.worldCount).toBe(0);
    const listed = await get('/tools/registry/data?worlds=1');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ worlds: [
      { name: 'Crossroads', seed: 7, kind: 'road' },
      { name: 'Database Vale', seed: 77, kind: 'endless' },
      { name: 'Old Vale', seed: 322, kind: 'endless' },
    ] });
    const editor = await get('/tools/world-editor/data');
    expect(editor.status).toBe(200);
    expect(await editor.json()).toEqual({ worlds: [
      { name: 'Database Vale', seed: 77, kind: 'endless' }, { name: 'Old Vale', seed: 322, kind: 'endless' },
    ] });
    const map = await (await get('/tools/world-editor/data?name=Old%20Vale')).json() as { layers: unknown[] };
    expect(map.layers).toContainEqual(expect.objectContaining({ kind: 'highland', x: 256, z: 256 }));
    const resumed = server.rooms.open(77, { day: 1, time: 0.3 }, server.rooms.worldRecord('Database Vale'));
    expect(resumed.world.clock).toEqual({ day: 9, time: 0.5 });
    expect(resumed.world.log).toContainEqual({ kind: 'chest', id: 'kept-in-database' });
    const anonymous = await fetch(at('/tools/registry/data?worlds=1'), { redirect: 'manual' });
    expect(anonymous.status).toBe(303);
  });
});
