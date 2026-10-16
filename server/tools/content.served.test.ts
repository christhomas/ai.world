import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDurable } from '../durable/db';
import { addAccount, migrate } from './accounts';
import { startServer, type RunningServer } from '../serve';
import { DEFAULT_CONTENT } from '../../src/core/contentDefaults';
import { CONTENT_BODY_LIMIT } from './content';
import { KINDS } from '../../src/entities/animals';
import { inventory } from '../../src/core/content';
import { bundledContent, installContent } from '../../src/entities/contentInstall';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../protocol';

describe('the content catalogue through the tools portal', () => {
  let dir = '', server: RunningServer | null = null;
  afterEach(async () => {
    await server?.close(); server = null;
    // The server installs what it publishes into this process's game; put the bundle back.
    installContent(inventory(DEFAULT_CONTENT));
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reads, edits, refuses and rolls back for a signed-in account only', async () => {
    dir = mkdtempSync(join(tmpdir(), 'content-api-'));
    const db = openDurable(join(dir, 'ai-world.sqlite'));
    migrate(db);
    addAccount(db, 'operator', 'a password for the content regression');
    db.close();
    server = await startServer({ port: 0, quiet: true, dataDir: dir, toolsSecret: 'content regression signing key' });
    const at = (path: string) => `http://127.0.0.1:${server!.port}${path}`;

    const anonymous = await fetch(at('/tools/content/data'), { redirect: 'manual' });
    expect(anonymous.status).toBe(303);
    expect(anonymous.headers.get('location')).toBe('/tools/login');

    const login = await fetch(at('/tools/login'), { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'operator', password: 'a password for the content regression' }) });
    expect(login.status).toBe(303);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    expect(cookie).toContain('=');
    const get = (path: string) => fetch(at(path), { headers: { cookie }, redirect: 'manual' });
    const post = (value: unknown, type = 'application/json') => fetch(at('/tools/content/data'), {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': type },
      body: typeof value === 'string' ? value : JSON.stringify(value),
    });

    // A player in a world hears the content before the welcome, and every edit after it.
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const heard: ServerMessage[] = [];
    socket.on('message', (raw) => heard.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise((open, fail) => { socket.on('open', open); socket.on('error', fail); });
    const until = async (found: () => boolean) => {
      for (let waited = 0; !found(); waited += 25) {
        if (waited > 20_000) throw new Error(`heard only ${heard.map((m) => m.type).join(', ')}`);
        await new Promise((wake) => setTimeout(wake, 25));
      }
    };
    socket.send(JSON.stringify({ type: 'join', seed: 5, name: 'Rowan', version: PROTOCOL_VERSION, day: 1, time: 0.3, content: bundledContent() }));
    await until(() => heard.some((m) => m.type === 'welcome'));
    const first = heard.findIndex((m) => m.type === 'content');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(heard.findIndex((m) => m.type === 'welcome'));
    expect(heard[first]).toEqual({ type: 'content', revision: 1, bundle: bundledContent(), changed: [], deleted: [] });

    const listing = await (await get('/tools/content/data')).json() as { head: number; records: { id: string }[] };
    expect(listing.head).toBe(1);
    expect(listing.records.map((record) => record.id)).toContain('creature:wolf');

    const wolf = (DEFAULT_CONTENT['properties/beasts.json'] as Record<string, { hp: number }>).wolf;
    const one = await (await get('/tools/content/data?id=creature:wolf')).json() as
      { record: { body: unknown }; history: { revision: { reason: string } }[] };
    expect(one.record.body).toEqual(wolf);
    expect(one.history.map((entry) => entry.revision.reason)).toEqual(['seed']);
    expect((await get('/tools/content/data?id=creature:unicorn')).status).toBe(404);

    const edited = await post({ base: 1, note: 'tougher wolves', changes: [{ id: 'creature:wolf', body: { ...wolf, hp: wolf.hp + 5 } }] });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(await edited.json()).toEqual({ head: 2 });
    // The running game changed with it: this process is the server, and its wolves are the edited ones.
    expect(KINDS.wolf.hp).toBe(wolf.hp + 5);
    await until(() => heard.some((m) => m.type === 'content' && m.revision === 2));
    const told = heard.find((m) => m.type === 'content' && m.revision === 2) as Extract<ServerMessage, { type: 'content' }>;
    expect(told.changed.map((wire) => [wire.id, (wire.body as { hp: number }).hp])).toEqual([['creature:wolf', wolf.hp + 5]]);
    socket.close();
    const after = await (await get('/tools/content/data')).json() as { revisions: { author: string; note: string }[] };
    expect(after.revisions.at(-1)).toMatchObject({ author: 'operator', note: 'tougher wolves' });

    expect((await post({ base: 1, changes: [{ id: 'creature:wolf', body: wolf }] })).status).toBe(409);
    const broken = await post({ base: 2, changes: [{ id: 'behaviour:grazer', body: { do: 'grazee' } }] });
    expect(broken.status).toBe(400);
    expect((await broken.json() as { error: string }).error).toContain('no such action "grazee"');
    expect((await post({ base: 2, changes: [] })).status).toBe(400);
    expect((await post('{ not json')).status).toBe(400);
    expect((await post({ base: 2, changes: [{ id: 'creature:wolf', body: wolf }] }, 'text/plain')).status).toBe(415);
    expect((await post({ base: 2, changes: [{ id: 'creature:wolf', body: 'x'.repeat(CONTENT_BODY_LIMIT) }] })).status).toBe(413);

    const rolled = await post({ base: 2, rollback: 1 });
    expect(rolled.status, await rolled.clone().text()).toBe(200);
    expect(await rolled.json()).toEqual({ head: 3 });
    const back = await (await get('/tools/content/data?id=creature:wolf')).json() as
      { head: number; record: { body: unknown }; history: { revision: { reason: string; author: string } }[] };
    expect(back.head).toBe(3);
    expect(back.record.body).toEqual(wolf);
    expect(KINDS.wolf.hp).toBe(wolf.hp);
    expect(back.history.map((entry) => [entry.revision.reason, entry.revision.author]))
      .toEqual([['seed', 'bundled defaults'], ['edit', 'operator'], ['rollback', 'operator']]);
  });
});
