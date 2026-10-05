// GitHub-only: two actual browser Workers share durable IndexedDB, never localStorage.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

await build({ configFile: false, build: { target: 'es2022', minify: false,
  outDir: 'mobile-frame-proof-out', emptyOutDir: false,
  lib: { entry: 'tools/mobile-frame-proof/worker-world-entry.ts', name: 'WorldProof',
    formats: ['iife'], fileName: () => 'worker-world.js' } } });
const bundle = await readFile('mobile-frame-proof-out/worker-world.js', 'utf8');
const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Worker world storage proof</title>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const evidence = await page.evaluate(async bundle => {
    const run = phase => new Promise((resolve, reject) => {
      const source = bundle + `\n(async () => {
        if (typeof localStorage !== 'undefined') throw new Error('Proof must run in a Worker');
        const vault = await WorldProof.BrowserVault.open();
        const heard = [];
        const host = new WorldProof.LocalWorldHost({ vault,
          clock: { now: () => 0, yield: () => Promise.resolve(), after: () => () => {}, every: () => () => {} },
          post: parcel => { if (typeof parcel === 'string' && parcel.startsWith('{')) heard.push(JSON.parse(parcel)); },
          closed() {},
        }, { ground: false }, true);
        host.receive(JSON.stringify({ type: 'join', seed: 3, version: WorldProof.PROTOCOL_VERSION, name: 'Rowan', day: 2, time: 0.4 }));
        if (${JSON.stringify(phase)} === 'save') {
          host.receive(JSON.stringify({ type: 'delta', delta: { kind: 'cleared', mine: 'Barrow', many: 4 } }));
          host.receive('shots-step:3');
        }
        const welcome = heard.find(message => message.type === 'welcome');
        host.dispose(); await vault.flush();
        self.postMessage({ phase: ${JSON.stringify(phase)}, welcome, files: vault.list('worlds'), localStorage: typeof localStorage });
      })().catch(error => self.postMessage({ failure: String(error), stack: error.stack }));`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const timer = setTimeout(() => { finish(); reject(new Error('Worker storage proof timed out')); }, 60000);
      function finish() { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); }
      worker.onmessage = event => { finish(); event.data.failure ? reject(new Error(event.data.failure)) : resolve(event.data); };
      worker.onerror = event => { finish(); reject(new Error(event.message)); };
    });
    const first = await run('save');
    const reopened = await run('reopen');
    return { first, reopened };
  }, bundle);
  assert.equal(evidence.first.localStorage, 'undefined');
  assert.equal(evidence.reopened.localStorage, 'undefined');
  assert.ok(evidence.first.files.length > 0);
  assert.ok(evidence.reopened.welcome.deltas.some(delta => delta.kind === 'cleared' && delta.mine === 'Barrow' && delta.many === 4));
  assert.ok(evidence.reopened.welcome.clock.day + evidence.reopened.welcome.clock.time > 2.4);
  await writeFile('mobile-frame-proof-out/worker-world-proof.json', JSON.stringify({ sourceSha: process.env.WORLD_SOURCE_SHA, evidence }, null, 2) + '\n');
  console.log('A fresh browser Worker restored actual simulation clock and deltas from durable IndexedDB.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
