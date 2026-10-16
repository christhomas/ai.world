// GitHub-only proof: actual production Player construction, walking and position restore.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

await build({ configFile: false, build: { target: 'es2022', minify: false,
  outDir: 'mobile-frame-proof-out', emptyOutDir: false,
  lib: { entry: 'tools/mobile-runtime-spike/player-opening-workload.ts', name: 'PortablePlayerOpening',
    formats: ['iife'], fileName: () => 'player.js' } } });
const bare = {};
runInNewContext(await readFile('mobile-frame-proof-out/player.js', 'utf8'), bare, { timeout: 15000 });
const evidence = JSON.parse(runInNewContext('PortablePlayerOpening.playerOpeningWorkload()', bare, { timeout: 15000 }));
assert.deepEqual(evidence.initial, { x: 18, z: -8 });
assert.ok(Math.hypot(evidence.walked.x - 18, evidence.walked.z + 8) > 1);
assert.deepEqual(evidence.reopened, evidence.walked);
assert.equal(evidence.mounted, 2);
await writeFile('mobile-frame-proof-out/player-proof.json', JSON.stringify({
  sourceSha: process.env.PLAYER_SOURCE_SHA, evidence,
}, null, 2) + '\n');
console.log('Actual production Player/camera reopened walked coordinates in a bare host.');
