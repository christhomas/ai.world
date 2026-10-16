// Bundling and execution run on GitHub only.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Compare the base revision's camera with the same bare-host construction. This records the
// actual pre-extraction failure without running a build or test on the developer's machine.
let baseline;
const baseSha = process.env.FRAME_BASE_SHA;
if (baseSha) {
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error('Invalid baseline source SHA');
  const source = execFileSync('git', ['show', `${baseSha}:src/render/camera.ts`], { encoding: 'utf8' });
  const entry = resolve('src/render/.portable-baseline-camera.ts');
  const built = await build({ configFile: false,
    plugins: [{ name: 'base-camera-snapshot', resolveId: (id) => id === entry ? entry : undefined,
      load: (id) => id === entry ? source : undefined }],
    build: { write: false, target: 'es2022', minify: false,
      lib: { entry, name: 'BaselineCamera', formats: ['iife'], fileName: () => 'baseline.js' } },
  });
  const outputs = (Array.isArray(built) ? built : [built]).flatMap((one) => one.output);
  const code = outputs.find((one) => one.type === 'chunk').code;
  const context = {};
  try {
    runInNewContext(code, context, { timeout: 5000 });
    runInNewContext('new BaselineCamera.IsoCamera(() => ({ width: 750, height: 342 }))', context, { timeout: 5000 });
    baseline = { sourceSha: baseSha, status: 'passed' };
  } catch (error) {
    baseline = { sourceSha: baseSha, status: 'failed', error: String(error) };
  }
  console.log('Base camera bare-host construction:', JSON.stringify(baseline));
}

const modules = new Set();
await build({
  configFile: false,
  plugins: [{ name: 'portable-dependency-manifest', generateBundle(_options, output) {
    for (const item of Object.values(output)) if (item.type === 'chunk') {
      for (const id of Object.keys(item.modules)) modules.add(id.replace(process.cwd() + '/', ''));
    }
  } }],
  build: { target: 'es2022', outDir: 'mobile-frame-proof-out', minify: false,
    lib: { entry: 'src/game/portable-frame.ts', name: 'PortableFrame', formats: ['iife'], fileName: () => 'frame.js' } },
});
const sandbox = {};
runInNewContext(await readFile('mobile-frame-proof-out/frame.js', 'utf8'), sandbox, { timeout: 5000 });
const result = runInNewContext(`(() => {
  const input = new PortableFrame.GameInput();
  const camera = new PortableFrame.IsoCamera(() => ({ width: 750, height: 342 }));
  input.hold('e'); camera.update(input, 0.1);
  let frames = 0, releases = 0;
  const session = new PortableFrame.SessionLifetime({ frame: () => frames++, pause() {}, resume() {}, release: () => releases++ });
  session.setActive(true); session.frame(0.1, 0); session.dispose(); session.frame(0.1, 1);
  let attacks = 0, actionLive = true;
  const actions = PortableFrame.bindKeys({ input, screen: { busy: () => null },
    host: { isLive: () => actionLive }, attack: () => attacks++ });
  actions.dispatch('attack'); input.press('x');
  actionLive = false; actions.dispatch('attack'); input.press('x');
  return { frames, releases, attacks, rotation: camera.rotation, projection: camera.frameCamera().projection };
})()`, sandbox, { timeout: 5000 });
assert.equal(result.frames, 1); assert.equal(result.releases, 1);
assert.equal(result.attacks, 2);
assert.ok(result.rotation > Math.PI / 4);
assert.ok(result.projection.every(Number.isFinite));
await writeFile('mobile-frame-proof-out/dependencies.json', JSON.stringify([...modules].sort(), null, 2) + '\n');
await writeFile('mobile-frame-proof-out/proof.json', JSON.stringify({
  sourceSha: process.env.FRAME_SOURCE_SHA, baseline, current: result,
}, null, 2) + '\n');
console.log('Bundled portable camera, controls and session lifetime ran without browser or Node host globals.');
