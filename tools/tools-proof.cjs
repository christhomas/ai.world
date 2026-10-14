/* Hosted browser acceptance against the production build and a real, empty server database. */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');

const out = 'docs/reports/tools-proof';
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), 'tools-proof-'));
const origin = 'http://127.0.0.1:8798';
const server = spawn(process.execPath, ['server/dist/server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...process.env, PORT: '8798', DATA_DIR: data, STATIC_DIR: resolve('dist'),
  TOOLS_SECRET: 'hosted-tools-proof-secret', TOOLS_ADMIN_USER: 'proof', TOOLS_ADMIN_PASSWORD: 'hosted-tools-proof-password',
} });
let log = '';
server.stdout.on('data', chunk => { log += chunk; });
server.stderr.on('data', chunk => { log += chunk; });
let browser;
(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${origin}/tools/login`)).ok) break; } catch {}
    if (attempt === 59) throw new Error(`Server did not start: ${log}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/tools/login`);
  await page.locator('[name=name]').fill('proof');
  await page.locator('[name=password]').fill('hosted-tools-proof-password');
  await Promise.all([page.waitForURL(`${origin}/tools/`), page.locator('button[type=submit]').click()]);
  await page.waitForFunction(() => document.querySelector('#tools-world option')?.textContent.includes('No saved worlds'));
  const before = await page.evaluate(async () => (await (await fetch('/tools/registry/data?worlds=1')).json()).worlds);
  assert.deepEqual(before, [], 'server really starts with no saved worlds');

  // The same databases, stores and records the game writes. No mocked tools endpoint or worker.
  await page.evaluate(async () => {
    const write = (database, store, rows) => new Promise((resolve, reject) => {
      const request = indexedDB.open(database);
      request.onupgradeneeded = () => request.result.createObjectStore(store);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(store, 'readwrite');
        for (const [key, value] of rows) tx.objectStore(store).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    await write('ai-world-authority', 'files', [
      ['worlds/world-records.json', JSON.stringify([{ seed: 3, name: 'chris', kind: 'road' }])],
      ['worlds/3.json', JSON.stringify({ seed: 3, clock: { day: 2, time: 0.5 }, deltas: [],
        manifest: { rootSeed: 3, anchors: [], terrain: [] } })],
    ]);
    await write('keyval-store', 'keyval', [['ai.world/slot/1', {
      seed: 3, worldName: 'chris', world: 'road', cam: { x: 0, z: 0, rot: 0, zoom: 1 }, state: { day: 1 },
    }]]);
  });
  await page.goto(`${origin}/tools/registry`);
  await page.waitForFunction(() => document.querySelector('#note')?.textContent.includes('day 2'), null, { timeout: 60000 });
  assert.equal(await page.locator('#tools-world').inputValue(), 'browser:3');
  assert.match(await page.locator('#tools-world option:checked').textContent(), /chris/);
  assert.match(await page.locator('#note').textContent(), /saved snapshot/);
  assert.ok(await page.locator('.parish').count(), 'real road population was surveyed');
  await page.screenshot({ path: `${out}/domesday-desktop.png`, fullPage: true });
  await page.locator('.tools-nav a[href*="/tools/world-editor"]').click();
  await page.waitForFunction(() => document.querySelector('#message')?.textContent.includes('road world'));
  assert.equal(await page.locator('#tools-world').inputValue(), 'browser:3');
  assert.equal(await page.locator('#pin').isDisabled(), true);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, name] of [['', 'overview'], ['world-editor', 'world-editor'], ['character-builder', 'builder-offline'], ['build/pair', 'builder-connection']]) {
      await page.goto(`${origin}/tools/${path}?selected-world=browser:3`);
      await page.waitForFunction(() => document.querySelector('#tools-world')?.value === 'browser:3');
      assert.equal(await page.locator('.tools-topbar').count(), 1);
      assert.equal(await page.locator('.tools-nav').count(), 1);
      assert.equal(await page.locator('h1:visible').count(), 1, `${name} has one shared heading`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits ${width}px`);
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
    }
  }
  const after = await page.evaluate(async () => (await (await fetch('/tools/registry/data?worlds=1')).json()).worlds);
  assert.deepEqual(after, [], 'local inspection did not upload or claim a server world');
  assert.deepEqual(errors, []);
  console.log('PASS: shared tools shell; real saved chris world; restored day and population; source isolation; desktop/mobile navigation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server.kill('SIGTERM');
  writeFileSync(`${out}/server.log`, log);
});
