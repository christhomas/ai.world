import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type RunningServer } from './serve';
import { staticFiles } from './static';

/**
 * One machine serving both halves is the whole point of this file, so what is tested is the thing
 * that makes it safe and the thing that makes it work: a path cannot climb out of the directory,
 * and the game comes back at the root while the status page keeps its own address.
 */
describe('handing out the game', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiworld-static-'));
    writeFileSync(join(dir, 'index.html'), '<title>ai.world</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'game.js'), 'console.log(1)');
    writeFileSync(join(dir, '..', 'secret.txt'), 'not yours');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('serves nothing at all when there is no build to serve', () => {
    const empty = mkdtempSync(join(tmpdir(), 'aiworld-empty-'));
    try {
      expect(staticFiles(empty)).toBeNull();
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });

  it('refuses to climb out of the directory it was given', async () => {
    const server = await startServer({ port: 0, dataDir: dir, staticDir: dir, quiet: true });
    try {
      const climbed = await fetch(`http://localhost:${server.port}/../secret.txt`);
      const body = await climbed.text();
      expect(body).not.toContain('not yours');
      // and it says so plainly rather than pretending: a file that is not there is a 404, which is
      // the answer a browser can act on
      expect(climbed.status).toBe(404);
    } finally { await server.close(); }
  });

  it('gives the game at the root and keeps the status page at /status', async () => {
    const server = await startServer({ port: 0, dataDir: dir, staticDir: dir, quiet: true });
    try {
      expect(await (await fetch(`http://localhost:${server.port}/`)).text()).toContain('ai.world');
      expect(await (await fetch(`http://localhost:${server.port}/assets/game.js`)).text()).toContain('console.log');
      expect(await (await fetch(`http://localhost:${server.port}/status`)).text()).toContain('worlds:');
    } finally { await server.close(); }
  });

  it('still answers with the status page when nothing is being served', async () => {
    const server = await startServer({ port: 0, dataDir: dir, quiet: true });
    try {
      expect(await (await fetch(`http://localhost:${server.port}/`)).text()).toContain('players:');
    } finally { await server.close(); }
  });
});

/**
 * What a browser is told about a file that is not there.
 *
 * Reported from a homelab as `Manifest: Line: 1, column: 1, Syntax error.` — which is not a
 * manifest fault at all. The router's last word is a plain-text status page served with a 200, and
 * a missing asset fell through to it: the browser asked for the web app manifest, was handed the
 * words "ai.world server, worlds: 1, players: 1" with every appearance of success, and tried to
 * read them as JSON.
 *
 * Two rules come out of it. A path that names a file and has no file is a 404, and the manifest has
 * a content type of its own — it is `.webmanifest` rather than `.json`, so the table had nothing to
 * say about it and it went out as a stream of bytes.
 */
describe('a file that is not there', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiworld-missing-'));
    writeFileSync(join(dir, 'index.html'), '<title>ai.world</title>');
    writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"AI World"}');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is a 404 rather than the status page wearing its clothes', async () => {
    const server = await startServer({ port: 0, dataDir: dir, staticDir: dir, quiet: true });
    try {
      const gone = await fetch(`http://localhost:${server.port}/nothing-here.webmanifest`);
      expect(gone.status).toBe(404);
      expect(await gone.text(), 'the browser was handed the status page and asked to parse it')
        .not.toContain('ai.world server');
    } finally { await server.close(); }
  });

  it('hands out a manifest as a manifest', async () => {
    const server = await startServer({ port: 0, dataDir: dir, staticDir: dir, quiet: true });
    try {
      const got = await fetch(`http://localhost:${server.port}/manifest.webmanifest`);
      expect(got.status).toBe(200);
      expect(got.headers.get('content-type') ?? '').toContain('manifest+json');
      expect(JSON.parse(await got.text()).name).toBe('AI World');
    } finally { await server.close(); }
  });

  it('still gives the status page to something that is not asking for a file', async () => {
    // a path with no extension is a page rather than an asset, and the plain status text is a
    // reasonable answer to one
    const server = await startServer({ port: 0, dataDir: dir, staticDir: dir, quiet: true });
    try {
      const body = await (await fetch(`http://localhost:${server.port}/somewhere`)).text();
      expect(body).toContain('ai.world server');
    } finally { await server.close(); }
  });
});
