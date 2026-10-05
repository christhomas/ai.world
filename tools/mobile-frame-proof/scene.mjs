// GitHub-only regression evidence against the production daylight before extraction.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Keep the pre-extraction production revision stable after this workflow lands on main.
const baseSha = '5983e649bcafef870f43dc98107b0e5cfd969a89';
const original = execFileSync('git', ['show', `${baseSha}:src/render/daycycle.ts`], { encoding: 'utf8' });
const entry = resolve('src/render/.baseline-daylight.ts');
const built = await build({ configFile: false,
  plugins: [{ name: 'production-daylight-snapshot', resolveId: id => id === entry ? entry : undefined,
    load: id => id === entry ? original : undefined }],
  build: { write: false, target: 'es2022', minify: false,
    lib: { entry, name: 'BaselineDaylight', formats: ['iife'], fileName: () => 'baseline-daylight.js' } },
});
const baselineCode = (Array.isArray(built) ? built : [built]).flatMap(one => one.output)
  .find(one => one.type === 'chunk').code;
await build({ configFile: false, build: { target: 'es2022', minify: false,
  outDir: 'mobile-frame-proof-out', emptyOutDir: false,
  lib: { entry: 'src/game/portable-scene.ts', name: 'PortableScene', formats: ['iife'], fileName: () => 'scene.js' } } });
const code = await readFile('mobile-frame-proof-out/scene.js', 'utf8');
const bare = {}; runInNewContext(code, bare, { timeout: 15000 });
const setup = `
  const state = new PortableScene.SceneState();
  let now = 0, shadows = 0, fits = 0;
  const rig = { graph: state.graph, lighting: state.lighting, fitShadow() { fits++; }, redrawShadows() { shadows++; } };
  const input = { time: 0.5, focusX: 4, focusZ: -2, heroX: 1, heroY: 2, heroZ: 3, lanternOn: false,
    season: { ground: [1, 1, 1], frost: 0, sky: [1.04, 0.94, 0.86], wetness: 0.4 }, wet: 0 };
`;
const before = {}; runInNewContext(code, before, { timeout: 15000 });
runInNewContext(baselineCode, before, { timeout: 15000 });
runInNewContext(setup + 'const cycle = new BaselineDaylight.DayCycle(rig);', before, { timeout: 15000 });
let baselineError;
try { runInNewContext('cycle.apply(input)', before, { timeout: 15000 }); }
catch (error) { baselineError = String(error); }
assert.match(baselineError ?? '', /performance is not defined/);

// With its browser clock present, the original is the numerical reference.
runInNewContext('globalThis.performance = { now: () => now };', before, { timeout: 15000 });
runInNewContext(setup + 'const cycle = new PortableScene.Daylight(rig, () => now);', bare, { timeout: 15000 });
const snapshots = `(() => {
  const out = [];
  for (const sky of [[1,1,1], [1.03,1,0.94], [1.04,0.94,0.86], [0.92,0.96,1.08]]) {
    for (const time of [0, 0.25, 0.4, 0.5, 0.73, 0.95]) for (const wet of [0, 1]) {
      now += 101;
      const night = cycle.apply({ ...input, season: { ...input.season, sky }, time, wet,
        flame: { x: 2, y: 3, z: 4 } });
      const glow = cycle.glowLinear ?? cycle.glowMaterial.color.toArray();
      out.push(JSON.parse(JSON.stringify({ night, lights: state.lighting, sky: state.graph.background,
        fog: state.graph.fog, glow })));
    }
  }
  return out;
})()`;
const normalize = value => JSON.parse(JSON.stringify(value));
const reference = normalize(runInNewContext(snapshots, before, { timeout: 15000 }));
const current = normalize(runInNewContext(snapshots, bare, { timeout: 15000 }));
assert.deepEqual(current, reference);
assert.equal(current.length, 48);
await writeFile('mobile-frame-proof-out/scene-proof.json', JSON.stringify({
  sourceSha: process.env.SCENE_SOURCE_SHA, baseSha, baselineError, matchedLightingFixtures: current.length,
  seasons: 4, wetStates: 2, daytimeSamples: 6,
}, null, 2) + '\n');
console.log('Production daylight matches all 48 season/weather/time fixtures without browser or GPU globals.');
