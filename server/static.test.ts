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
      // it falls through to the status page rather than serving somebody's home directory
      expect(body).toContain('ai.world server');
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
