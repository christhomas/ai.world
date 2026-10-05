// GitHub-only execution of production country boot without browser or Node host globals.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

await build({ configFile: false, build: { target: 'es2022', minify: false,
  outDir: 'mobile-frame-proof-out', emptyOutDir: false,
  lib: { entry: 'src/game/portable-country.ts', name: 'PortableCountry', formats: ['iife'], fileName: () => 'country.js' } } });
const sandbox = {};
runInNewContext(await readFile('mobile-frame-proof-out/country.js', 'utf8'), sandbox, { timeout: 15000 });
const result = runInNewContext(`(() => {
  const road = PortableCountry.growCountryState({ seed: 7, world: 'road' });
  const saved = JSON.parse(JSON.stringify(road.manifest.toJSON()));
  const continued = PortableCountry.growCountryState({ seed: 7, world: 'road', savedManifest: saved });
  const endless = PortableCountry.growCountryState({ seed: 11, world: 'endless', start: { x: -508, z: 10 } });
  const first = endless.sampler, firstPatch = endless.endless.patch;
  const originWasGrown = endless.endless.store.has('0,0');
  const crossed = endless.country.moveTo(10, 10);
  const probe = road.sampler.probe(12, -8);
  return { roadStamp: road.stamp, continuedStamp: continued.stamp,
    sameManifest: JSON.stringify(saved) === JSON.stringify(continued.manifest.toJSON()),
    villages: road.structures.villages.length, roadNodes: road.graph.nodes.length,
    probe, firstPatch, originWasGrown, crossed, changed: first !== endless.sampler,
    liveView: endless.view.sampler === endless.sampler && endless.graph === endless.country.sampler.graph };
})()`, sandbox, { timeout: 90000 });
assert.equal(result.roadStamp, result.continuedStamp);
assert.equal(result.sameManifest, true);
assert.ok(result.villages > 0); assert.ok(result.roadNodes > 0);
assert.equal(result.firstPatch, '-1,0'); assert.equal(result.originWasGrown, false);
assert.equal(result.crossed, '0,0'); assert.equal(result.changed, true); assert.equal(result.liveView, true);
await writeFile('mobile-frame-proof-out/country-proof.json', JSON.stringify({
  sourceSha: process.env.COUNTRY_SOURCE_SHA, current: result,
}, null, 2) + '\n');
console.log('Production country boot, saved manifest and live patch crossing ran in a bare host.');
