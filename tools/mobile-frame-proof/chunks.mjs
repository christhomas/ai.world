// GitHub-only proof: original worker output and current CPU jobs share the same real inputs.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const baseSha = process.env.CHUNK_BASE_SHA;
if (!baseSha || !/^[a-f0-9]{40}$/.test(baseSha)) throw new Error('Expected exact base source SHA');
const oldWorker = execFileSync('git', ['show', `${baseSha}:src/workers/chunkgen.worker.ts`], { encoding: 'utf8' });
const entry = resolve('src/workers/.portable-baseline-chunks.ts');
const source = oldWorker + `
import { TerrainSampler as ProofSampler } from '../world/terrain';
import { generateRoadGraph as proofGraph } from '../world/roadtree';
import { packChunk as proofPack } from '../world/chunkparcel';
export function requests() {
  const sampler = new ProofSampler(proofGraph(7));
  const altered = sampler.generateChunk(0, 0);
  altered.height[altered.size + 1] += 5;
  altered.corners.fill(8, (altered.size + 1) * 4, (altered.size + 2) * 4);
  return [
    { type: 'init', seed: sampler.seed, graph: sampler.graph, hydro: sampler.hydro, structures: sampler.structures },
    { type: 'gen', id: 1, cx: 0, cz: 0 },
    { type: 'mesh', id: 2, cx: 0, cz: 0, chunk: proofPack(altered) },
  ];
}
`;
const outputs = await build({ configFile: false,
  plugins: [{ name: 'original-worker', resolveId: id => id === entry ? entry : undefined,
    load: id => id === entry ? source : undefined }],
  build: { write: false, target: 'es2022', minify: false,
    lib: { entry, name: 'BaselineChunks', formats: ['iife'], fileName: () => 'baseline-chunks.js' } },
});
const code = (Array.isArray(outputs) ? outputs : [outputs]).flatMap(one => one.output)
  .find(one => one.type === 'chunk').code;
let baselineError;
try { runInNewContext(code, {}, { timeout: 15000 }); }
catch (error) { baselineError = String(error); }
assert.match(baselineError ?? '', /self is not defined/, 'original worker cannot execute in a bare host');

const reference = [], transfers = [];
const browser = { self: { postMessage: (reply, buffers) => { reference.push(reply); transfers.push(buffers.length); } } };
runInNewContext(code, browser, { timeout: 15000 });
const requests = runInNewContext('BaselineChunks.requests()', browser, { timeout: 15000 });
for (const request of requests) browser.self.onmessage({ data: request });
assert.equal(reference.length, 3);
assert.equal(reference[1].empty, false); assert.equal(reference[1].grown, true);
assert.ok(reference[1].props.length > 0); assert.ok(reference[1].mesh.indices.length > 0);
assert.equal(reference[2].grown, false);

await build({ configFile: false, build: { target: 'es2022', outDir: 'mobile-frame-proof-out',
  emptyOutDir: false, minify: false,
  lib: { entry: 'src/game/portable-chunks.ts', name: 'PortableChunks', formats: ['iife'], fileName: () => 'chunks.js' } } });
const current = [], currentTransfers = [];
const bare = { deliver: (reply, buffers) => { current.push(reply); currentTransfers.push(buffers.length); } };
runInNewContext(await readFile('mobile-frame-proof-out/chunks.js', 'utf8'), bare, { timeout: 15000 });
const jobs = runInNewContext('new PortableChunks.ChunkMesher(deliver)', bare, { timeout: 15000 });
for (const request of requests) jobs.receive(request);
const normalize = value => JSON.parse(JSON.stringify(value, (_key, item) => ArrayBuffer.isView(item) ? Array.from(item) : item));
assert.deepEqual(normalize(current), normalize(reference));
assert.deepEqual(currentTransfers, transfers);
jobs.dispose(); for (const request of requests) jobs.receive(request);
assert.equal(current.length, 3, 'disposed CPU jobs must remain retired');
await writeFile('mobile-frame-proof-out/chunks-proof.json', JSON.stringify({
  sourceSha: process.env.CHUNK_SOURCE_SHA, baseSha, baselineError,
  matchedReplies: current.length, matchedTransferCounts: transfers,
  props: current[1].props.length / 9, triangles: current[1].mesh.indices.length / 3,
  authoritativeHeight: current[2].heights[0], disposedReplies: 0,
}, null, 2) + '\n');
console.log('Real worker terrain, props, authoritative edits and transfer ownership match bare-host CPU jobs.');
