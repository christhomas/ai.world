// GitHub-only proof: shared country growth runs without Worker or browser/Node host globals.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const entry = resolve('src/game/.country-jobs-proof.ts');
await build({ configFile: false,
  plugins: [{ name: 'country-job-proof', resolveId: (id) => id === entry ? entry : undefined,
    load: (id) => id === entry ? `
      export { createCountryGrower } from './portable-country-jobs';
      export { Patchwork, boundsOf } from '../world/patchwork';
      export { growPatch } from '../world/growworld';
      export { partsOf } from '../world/endless';` : undefined }],
  build: { emptyOutDir: false, target: 'es2022', outDir: 'mobile-frame-proof-out', minify: false,
    lib: { entry, name: 'CountryJobs', formats: ['iife'], fileName: () => 'country-jobs.js' } },
});
const sandbox = {};
runInNewContext(await readFile('mobile-frame-proof-out/country-jobs.js', 'utf8'), sandbox, { timeout: 10000 });
const result = runInNewContext(`(() => {
  const patches = new CountryJobs.Patchwork(11);
  const sent = []; let receive, failures, stopped = 0, detached = 0;
  const grower = CountryJobs.createCountryGrower(11, patches, {
    send: message => sent.push(message),
    listen: (reply, failed) => { receive = reply; failures = failed; return () => detached++; },
    stop: () => stopped++,
  });
  grower.want('0,0'); grower.want('1,0');
  const original = CountryJobs.growPatch(11, CountryJobs.boundsOf('0,0'));
  const reply = { type: 'grown', patch: '0,0', took: 17, parts: CountryJobs.partsOf(original) };
  receive(reply); receive(reply);
  const rebuilt = patches.patch('0,0');
  const samples = [[0,0], [100,120], [400,300]].map(([x,z]) => {
    const before = original.newSample(), after = rebuilt.newSample();
    original.sampleTile(x,z,before); rebuilt.sampleTile(x,z,after);
    return [JSON.stringify(before), JSON.stringify(after)];
  });
  grower.dispose(); receive({ ...reply, patch: '1,0' }); failures(); grower.want('2,0');
  return { samples, asked: sent.map(message => message.patch), holding: patches.holding(),
    waiting: grower.waiting, grown: grower.grown, stopped, detached };
})()`, sandbox, { timeout: 120000 });
assert.equal(result.grown, 1); assert.equal(result.stopped, 1); assert.equal(result.detached, 1);
assert.deepEqual(Array.from(result.asked), ['0,0', '1,0']);
assert.deepEqual(Array.from(result.holding), ['0,0']);
assert.equal(result.waiting.length, 0);
for (const [before, after] of result.samples) assert.equal(after, before);
await writeFile('mobile-frame-proof-out/country-jobs-proof.json', JSON.stringify({
  sourceSha: process.env.FRAME_SOURCE_SHA, current: result,
}, null, 2) + '\n');
console.log('Owned country growth rebuilt shared patch parts in a bare host and fenced retired replies.');
