// GitHub-only: the actual browser transport and sim.worker must acknowledge before termination.
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const directory = resolve('mobile-frame-proof-out');
const bundle = await readFile(resolve(directory, 'worker-world.js'), 'utf8');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Production world checkpoint proof</title>'); return;
  }
  const file = resolve(directory, '.' + pathname);
  if (!file.startsWith(directory + sep) || !file.endsWith('.js')) { res.writeHead(404); res.end(); return; }
  try { const bytes = await readFile(file); res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bytes); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: bundle });
  const evidence = await page.evaluate(async () => {
    const run = phase => new Promise((resolve, reject) => {
      let link, finished = false;
      const timer = setTimeout(() => finish(new Error('Production worker checkpoint timed out')), 90_000);
      function finish(error, welcome) {
        if (finished) return; finished = true; clearTimeout(timer); link?.close();
        error ? reject(error) : resolve({ phase, welcome, acknowledged: true, terminated: true });
      }
      link = WorldProof.workerLink({
        onOpen: () => link.send(JSON.stringify({ type: 'join', seed: 3, version: WorldProof.PROTOCOL_VERSION,
          name: 'Rowan', day: phase === 'save' ? 2 : 0, time: phase === 'save' ? 0.4 : 0 })),
        onClose: reason => finish(new Error(reason)),
        onMessage: parcel => {
          if (typeof parcel !== 'string' || !parcel.startsWith('{')) return;
          const welcome = JSON.parse(parcel);
          if (welcome.type !== 'welcome') return;
          if (phase === 'save') link.send(JSON.stringify({ type: 'delta', delta: { kind: 'cleared', mine: 'Barrow', many: 4 } }));
          // A flush uses the production sim.worker control message, strict Simulation.stop and
          // IndexedDB completion. close() terminates this worker only after its matching reply.
          void link.flush().then(() => finish(null, welcome), error => finish(error));
        },
      });
    });
    const first = await run('save');
    const reopened = await run('reopen');
    const vault = await WorldProof.BrowserVault.open();
    return { first, reopened, files: vault.list('worlds') };
  });
  assert.equal(evidence.first.acknowledged, true);
  assert.equal(evidence.first.terminated, true);
  assert.equal(evidence.reopened.acknowledged, true);
  assert.ok(evidence.files.length > 0);
  assert.ok(evidence.reopened.welcome.deltas.some(delta => delta.kind === 'cleared' && delta.mine === 'Barrow' && delta.many === 4));
  assert.ok(evidence.reopened.welcome.clock.day + evidence.reopened.welcome.clock.time >= 2.4);
  await writeFile(resolve(directory, 'production-worker-proof.json'), JSON.stringify({
    sourceSha: process.env.WORLD_SOURCE_SHA, evidence,
  }, null, 2) + '\n');
  console.log('Actual workerLink awaited sim.worker durable acknowledgement, terminated, and continued its saved world.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
