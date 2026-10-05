// GitHub-only production save construction and host service proof.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

await build({ configFile: false, build: { target: 'es2022', minify: false,
  outDir: 'mobile-frame-proof-out', emptyOutDir: false,
  lib: { entry: 'tools/mobile-runtime-spike/keeping-workload.ts', name: 'PortableKeeping', formats: ['iife'], fileName: () => 'keeping.js' } } });
const bare = {};
runInNewContext(await readFile('mobile-frame-proof-out/keeping.js', 'utf8'), bare, { timeout: 15000 });
const transcript = await runInNewContext('PortableKeeping.keepingWorkload()', bare, { timeout: 15000 });
const result = JSON.parse(transcript);
assert.equal(result.saved.player.x, 18); assert.equal(result.saved.state.savedAt, 2000);
assert.equal(result.continued.savedAt, 2000 + 3 * 86400000);
assert.equal(result.continued.playerId, result.saved.state.playerId);
await writeFile('mobile-frame-proof-out/keeping-proof.json', JSON.stringify({
  sourceSha: process.env.KEEPING_SOURCE_SHA, current: result,
}, null, 2) + '\n');
console.log('Actual production save assembly continued inventory, identity, position and time in a bare host.');
