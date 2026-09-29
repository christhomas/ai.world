import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer, type RunningServer } from './serve';
import { PROTOCOL_VERSION, type ServerMessage } from './protocol';
import { boundsOf } from '../src/world/patchwork';
import { growPatch } from '../src/world/growworld';
import { partsOf } from '../src/world/endless';
import { Simulation } from './sim';
import { Forgetful } from './vault';
import { countryStamp, growWorld, islandsFor } from '../src/world/growworld';
import { Manifest } from '../src/world/manifest';
import { TerrainSampler } from '../src/world/terrain';
import { rebuildRoad, roadPartsOf } from './groundsource';

describe('a slow first country', () => {
  let server: RunningServer | null = null;
  let directory = '';
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    await server?.close();
    server = null;
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  async function joinSocket(seed: number, version = PROTOCOL_VERSION) {
    const socket = new WebSocket(`ws://localhost:${server!.port}`);
    sockets.push(socket);
    const seen: ServerMessage[] = [];
    socket.on('message', (raw) => seen.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({
      type: 'join', seed, name: 'Rowan', version, day: 1, time: 0.3, x: 256, z: 256,
    }));
    return seen;
  }

  async function until<T>(read: () => T | undefined, ms = 60_000): Promise<T> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const got = read();
      if (got !== undefined) return got;
      await new Promise((resume) => setTimeout(resume, 10));
    }
    throw new Error('the slow country did not answer in time');
  }

  it('acknowledges progress, serves unrelated requests, and finishes the same country', async () => {
    directory = mkdtempSync(join(tmpdir(), 'aiworld-slow-country-'));
    const seed = 314159;
    // The slow provider stands in for a busy patch worker. Its answer is the real patch, so
    // country/chunk generation after the wait still has to complete and stamp correctly.
    const parts = partsOf(growPatch(seed, boundsOf('0,0')));
    server = await startServer({
      port: 0, dataDir: directory, durableDb: null, quiet: true,
      prepare: {
        grow: async () => {
          await new Promise((resume) => setTimeout(resume, 1500));
          return parts;
        },
        growRoad: async () => { throw new Error('an endless world has no road country'); },
      },
    });

    const first = await joinSocket(seed);
    await until(() => first.find((m) => m.type === 'welcome'), 3000);
    const opening = await until(() => first.find((m) => m.type === 'country-progress'), 3000);
    expect(opening).toMatchObject({ done: 0 });

    const started = Date.now();
    const status = await fetch(`http://localhost:${server.port}/status`);
    expect(status.status).toBe(200);
    expect(Date.now() - started, 'the event loop still answers during a slow patch').toBeLessThan(1000);
    const other = await joinSocket(seed + 1, PROTOCOL_VERSION + 1);
    await until(() => other.find((m) => m.type === 'error'), 1000);

    const grown = await until(() => first.find((m) => m.type === 'country'));
    expect(grown).toMatchObject({ kind: 'endless' });
    const updates = first.filter((m) => m.type === 'country-progress');
    expect(updates.at(-1)).toMatchObject({ done: updates.at(-1)?.total });
  }, 90_000);

  it('grows a road world away from the event loop and keeps telling the page', async () => {
    directory = mkdtempSync(join(tmpdir(), 'aiworld-slow-country-'));
    const seed = 161803;
    // The parts a worker hands back: the whole road country, grown here before the server starts
    // so the growing is not what the lag monitor below measures.
    const islands = islandsFor(new Manifest(seed), seed);
    const grown = new TerrainSampler(growWorld(seed, islands));
    const parts = structuredClone(roadPartsOf(islands, grown));
    // What crosses the worker boundary has to rebuild the country that was grown, tile for tile.
    const rebuilt = rebuildRoad(structuredClone(parts));
    const a = grown.newSample(), b = rebuilt.newSample();
    let differ = 0, land = 0;
    for (let x = -600; x <= 600; x += 9) for (let z = -600; z <= 600; z += 9) {
      grown.sampleTile(x, z, a);
      rebuilt.sampleTile(x, z, b);
      if (a.type !== b.type || a.height !== b.height || a.biome !== b.biome || a.roadDist !== b.roadDist) differ++;
      if (a.height > 0) land++;
    }
    expect(land, 'the sampled square has country in it').toBeGreaterThan(1000);
    expect(differ, 'the rebuilt road country paints what was grown').toBe(0);
    expect(rebuilt.structures.villages.length).toBe(grown.structures.villages.length);
    let asked = 0;
    server = await startServer({
      port: 0, dataDir: directory, durableDb: null, quiet: true,
      prepare: {
        grow: async () => { throw new Error('a road world has no patches'); },
        growRoad: async (_seed, islands) => {
          asked++;
          expect(islands, 'a fresh world has planned no islands yet').toEqual([]);
          await new Promise((resume) => setTimeout(resume, 1500));
          return structuredClone(parts);
        },
      },
    });
    let worst = 0;
    let last = Date.now();
    const lag = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last); last = now; }, 20);
    try {
      const socket = new WebSocket(`ws://localhost:${server.port}`);
      sockets.push(socket);
      const seen: ServerMessage[] = [];
      socket.on('message', (raw, binary) => { if (!binary) seen.push(JSON.parse(String(raw)) as ServerMessage); });
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.send(JSON.stringify({
        type: 'join', worldName: 'Roadside', kind: 'road', seed, name: 'Rowan',
        version: PROTOCOL_VERSION, day: 1, time: 0.3, x: 0, z: 0,
      }));
      await until(() => seen.find((m) => m.type === 'welcome'), 3000);
      const country = await until(() => seen.find((m) => m.type === 'country'));
      expect(asked, 'the road country came from the source rather than this thread').toBe(1);
      expect(country).toMatchObject({ kind: 'road', stamp: countryStamp(parts.graph) });
      const updates = seen.filter((m) => m.type === 'country-progress');
      expect(updates.length, 'progress arrives while the country grows').toBeGreaterThan(2);
      expect(updates.at(-1)).toMatchObject({ done: updates.at(-1)?.total });
      expect(worst, 'no one piece of the road country holds the event loop').toBeLessThan(1500);
    } finally { clearInterval(lag); }
  }, 120_000);

  it('answers chunk requests heard while the first country was being prepared', async () => {
    directory = mkdtempSync(join(tmpdir(), 'aiworld-slow-country-'));
    const seed = 271828;
    const parts = partsOf(growPatch(seed, boundsOf('0,0')));
    server = await startServer({
      port: 0, dataDir: directory, durableDb: null, quiet: true,
      prepare: {
        grow: async () => {
          await new Promise((resume) => setTimeout(resume, 500));
          return parts;
        },
        growRoad: async () => { throw new Error('an endless world has no road country'); },
      },
    });
    const socket = new WebSocket(`ws://localhost:${server.port}`);
    sockets.push(socket);
    const seen: ServerMessage[] = [];
    let parcels = 0;
    socket.on('message', (raw, binary) => {
      if (binary) parcels++;
      else seen.push(JSON.parse(String(raw)) as ServerMessage);
    });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({
      type: 'join', seed, name: 'Rowan', version: PROTOCOL_VERSION, day: 1, time: 0.3, x: 256, z: 256,
    }));
    await until(() => seen.find((m) => m.type === 'country-progress'), 3000);
    // A page asks for each chunk of its opening view in its own message.
    const view: Array<[number, number]> = [];
    for (let cz = 3; cz <= 13; cz++) for (let cx = 3; cx <= 13; cx++) view.push([cx, cz]);
    for (const chunk of view) socket.send(JSON.stringify({ type: 'want-chunks', chunks: [chunk] }));
    await until(() => seen.find((m) => m.type === 'country'));
    await until(() => (parcels >= view.length ? true : undefined), 10_000);
    expect(parcels).toBe(view.length);
  }, 90_000);

  it('does not count server preparation as player silence', async () => {
    const heard: ServerMessage[] = [];
    let open = true;
    let stopWaiting!: (error: Error) => void;
    const waiting = new Promise<ReturnType<typeof partsOf>>((_resolve, reject) => { stopWaiting = reject; });
    const sim = new Simulation({
      vault: new Forgetful(), ground: true, timeout: 100,
      prepare: { grow: async () => waiting, growRoad: async () => { throw new Error('not a road world'); } },
    });
    sim.attach({
      send: (text) => heard.push(JSON.parse(String(text)) as ServerMessage),
      get open() { return open; },
      close: () => { open = false; },
    }).receive(JSON.stringify({
      type: 'join', seed: 7, name: 'Rowan', version: PROTOCOL_VERSION,
      day: 1, time: 0.3, x: 256, z: 256,
    }));
    await Promise.resolve();
    sim.tick(Date.now() + 500);
    expect(open).toBe(true);
    expect(sim.rooms.playerCount).toBe(1);
    expect(heard.some((m) => m.type === 'country-progress')).toBe(true);
    stopWaiting(new Error('test stopped'));
    await new Promise((resume) => setTimeout(resume, 0));
    sim.stop();
  });
});
