import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, type RunningServer } from './serve';
import { DEFAULT_CONTENT } from '../src/core/contentDefaults';

describe('the running server and the content catalogue', () => {
  let dir = '', server: RunningServer | null = null;
  afterEach(async () => {
    await server?.close(); server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('seeds its durable database on the first start and only then', async () => {
    dir = mkdtempSync(join(tmpdir(), 'content-served-'));
    server = await startServer({ port: 0, quiet: true, dataDir: dir });
    await server.close(); server = null;
    server = await startServer({ port: 0, quiet: true, dataDir: dir });
    await server.close(); server = null;
    const kept = new DatabaseSync(join(dir, 'ai-world.sqlite'), { readOnly: true });
    try {
      expect(kept.prepare('SELECT reason FROM content_revision').all().map((row) => row.reason)).toEqual(['seed']);
      const wolf = kept.prepare("SELECT body FROM content_record WHERE id = 'creature:wolf'").get();
      const beasts = DEFAULT_CONTENT['properties/beasts.json'] as Record<string, unknown>;
      expect(JSON.parse(String(wolf?.body))).toEqual(beasts.wolf);
    } finally { kept.close(); }
  });
});
