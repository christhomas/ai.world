// GitHub-only proof against the original production matrix algorithm, without a GPU context.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const baselineSha = 'db7c8a7b5a8cc96edb17b8ad34f9199706486456';
const baseline = resolve('src/render/.entity-scene-baseline.ts');
// Only the view import is redirected: the helper is unchanged; the original animation algorithm
// and constructor are kept byte-for-byte. That avoids loading the browser rig for a CPU comparison.
const source = execFileSync('git', ['show', `${baselineSha}:src/render/entities.ts`], { encoding: 'utf8' })
  .replace("from './scene';", "from './scene-view';");
const entry = resolve('src/render/.entity-scene-proof.ts');
await build({ configFile: false,
  plugins: [{ name: 'entity-scene-reference',
    resolveId: (id) => id === entry || id === baseline ? id : undefined,
    load: (id) => id === baseline ? source : id === entry ? `
      import * as THREE from 'three';
      import { EntityRenderer as Original } from '${baseline}';
      import { entitySceneWorkload } from '../../tools/mobile-runtime-spike/entity-workload';
      export function run() {
        const original = entitySceneWorkload((graph, view) => {
          const scene = new THREE.Scene();
          Object.defineProperty(scene.userData, 'worldView', { get: view });
          return new Original(scene, graph);
        });
        const portable = entitySceneWorkload();
        if (original !== portable) throw new Error('Production creature buffers changed');
        return { sameBuffers: true, frames: JSON.parse(portable) };
      }` : undefined }],
  build: { emptyOutDir: false, target: 'es2022', outDir: 'mobile-frame-proof-out', minify: false,
    lib: { entry, name: 'EntitySceneProof', formats: ['iife'], fileName: () => 'entities.js' } },
});
const sandbox = {};
runInNewContext(await readFile('mobile-frame-proof-out/entities.js', 'utf8'), sandbox, { timeout: 10000 });
const result = runInNewContext('EntitySceneProof.run()', sandbox, { timeout: 10000 });
assert.equal(result.sameBuffers, true);
assert.equal(result.frames.length, 4);
assert.equal(result.frames[0].bars, 1);
await writeFile('mobile-frame-proof-out/entities-proof.json', JSON.stringify({
  sourceSha: process.env.ENTITY_SOURCE_SHA, baselineSha, ...result,
}, null, 2) + '\n');
console.log('Original creature animation, culling, colors and health bars match portable bare-host buffers.');
