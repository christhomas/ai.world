/*
 * Hosted acceptance for the gameplay content catalogue (#624), against the production server
 * bundle, a real database and a real browser.
 *
 * Edits the wolf through the Content Catalogue page, as an operator would, and checks:
 * - a player already in a world is sent the published revision;
 * - the edit survives the server being stopped and started again on the same database;
 * - a stale edit and one naming a creature that does not exist are refused on the page;
 * - rolling back publishes the original again, and the player is sent that too.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const out = 'docs/reports/tools-proof';
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), 'content-proof-'));
const port = 8799;
const origin = `http://127.0.0.1:${port}`;
let log = '';
let server = null;

function start() {
  server = spawn(process.execPath, ['server/dist/server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, PORT: String(port), DATA_DIR: data, STATIC_DIR: resolve('dist'),
    TOOLS_SECRET: 'hosted-content-proof-secret', TOOLS_ADMIN_USER: 'proof', TOOLS_ADMIN_PASSWORD: 'hosted-content-proof-password',
  } });
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${origin}/tools/login`)).ok) return; } catch {}
    await new Promise(wake => setTimeout(wake, 500));
  }
  throw new Error(`Server did not start: ${log}`);
}

async function stop() {
  const stopping = new Promise(done => server.once('exit', done));
  server.kill('SIGTERM');
  await stopping;
}

/** A player in a world, listening for what the server says about content. */
async function player(version) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const heard = [];
  socket.on('message', raw => heard.push(JSON.parse(String(raw))));
  await new Promise((open, fail) => { socket.once('open', open); socket.once('error', fail); });
  socket.send(JSON.stringify({ type: 'join', seed: 5, name: 'Rowan', version, day: 1, time: 0.3 }));
  const until = async (found, what) => {
    for (let waited = 0; ; waited += 50) {
      const message = heard.find(found);
      if (message) return message;
      if (waited > 30000) throw new Error(`no ${what}; heard ${heard.map(m => m.type).join(', ')}`);
      await new Promise(wake => setTimeout(wake, 50));
    }
  };
  return { socket, heard, until };
}

async function signIn(page) {
  await page.goto(`${origin}/tools/login`);
  await page.locator('[name=name]').fill('proof');
  await page.locator('[name=password]').fill('hosted-content-proof-password');
  await Promise.all([page.waitForURL(`${origin}/tools/`), page.locator('button[type=submit]').click()]);
}

/** Open a record on the page and give back its body as the page shows it. */
async function openRecord(page, id) {
  await page.locator('#filter').fill(id.split(':')[1]);
  await page.locator(`.content-records button[title="${id}"]`).click();
  await page.waitForFunction(wanted => document.querySelector('#title')?.textContent === wanted, id);
  return JSON.parse(await page.locator('#body').inputValue());
}

async function publish(page, body, note) {
  await page.locator('#body').fill(JSON.stringify(body, null, 2));
  await page.locator('#note').fill(note);
  // whatever the last action said is cleared, so the wait below is for this one's answer
  await page.evaluate(() => { document.querySelector('#status').textContent = ''; });
  await page.locator('#publish').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.length > 0);
  return page.locator('#status').textContent();
}

let browser;
(async () => {
  start();
  await ready();
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await signIn(page);
  // The version this checkout's server speaks, read from the same source the bundle was built from.
  const protocol = Number(/PROTOCOL_VERSION = (\d+)/.exec(readFileSync('server/protocol.ts', 'utf8'))[1]);

  const rowan = await player(protocol);
  const first = await rowan.until(m => m.type === 'content', 'content before the welcome');
  await rowan.until(m => m.type === 'welcome', 'welcome');
  assert.equal(first.revision, 1);
  assert.deepEqual(first.changed, [], 'a fresh catalogue is the bundled content');

  await page.goto(`${origin}/tools/content-editor`);
  await page.waitForFunction(() => document.querySelector('#running')?.textContent.includes('revision 1'));
  assert.equal(await page.locator('h1:visible').count(), 1, 'the editor has one shared heading');
  const wolf = await openRecord(page, 'creature:wolf');
  assert.equal(typeof wolf.hp, 'number');
  const said = await publish(page, { ...wolf, hp: wolf.hp + 11 }, 'hosted proof: tougher wolves');
  assert.match(said, /Published revision 2/);
  const told = await rowan.until(m => m.type === 'content' && m.revision === 2, 'the published revision');
  assert.deepEqual(told.changed.map(w => [w.id, w.body.hp]), [['creature:wolf', wolf.hp + 11]]);
  await page.screenshot({ path: `${out}/content-editor-published.png`, fullPage: true });

  // The page was loaded at revision 2. Publishing over it from a second page makes this one stale.
  const other = await (await browser.newContext()).newPage();
  other.on('dialog', dialog => dialog.accept());
  await signIn(other);
  await other.goto(`${origin}/tools/content-editor`);
  await other.waitForFunction(() => document.querySelector('#running')?.textContent.includes('revision 2'));
  const deep = await openRecord(other, 'spawning:deep');
  assert.match(await publish(other, { ...deep, kinds: { ...deep.kinds, kraken: 1 } }, 'hosted proof: no krakens'),
    /creature:kraken, which does not exist/);
  assert.match(await publish(other, { ...deep, kinds: { shark: 4, orca: 3 } }, 'hosted proof: fewer sharks'),
    /Published revision 3/);
  assert.match(await publish(page, { ...wolf, hp: wolf.hp + 12 }, 'hosted proof: stale'),
    /made against revision 2, but the catalogue is at 3/);
  await page.screenshot({ path: `${out}/content-editor-stale.png`, fullPage: true });
  rowan.socket.close();

  // Stopped and started on the same database, the edits are what it runs.
  await stop();
  start();
  await ready();
  // Sessions are in the same database, so the operator is still signed in after the restart.
  await page.goto(`${origin}/tools/content-editor`);
  assert.equal(new URL(page.url()).pathname, '/tools/content-editor', 'the session survived the restart');
  await page.waitForFunction(() => document.querySelector('#running')?.textContent.includes('revision 3'));
  assert.equal((await openRecord(page, 'creature:wolf')).hp, wolf.hp + 11, 'the edit survived a restart');
  const bryn = await player(protocol);
  const restarted = await bryn.until(m => m.type === 'content', 'content after the restart');
  assert.equal(restarted.revision, 3);
  assert.deepEqual(restarted.changed.map(w => w.id).sort(), ['creature:wolf', 'spawning:deep']);

  // Rolling back to the seed publishes the bundled content again, and the player is told.
  await page.locator('.content-revisions li', { hasText: '#1 seed' }).locator('button').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Rolled back'));
  const back = await bryn.until(m => m.type === 'content' && m.revision === 4, 'the rollback');
  assert.deepEqual(back.changed, []);
  assert.equal((await openRecord(page, 'creature:wolf')).hp, wolf.hp);
  await page.screenshot({ path: `${out}/content-editor-rolled-back.png`, fullPage: true });
  bryn.socket.close();
  assert.deepEqual(errors, []);
  console.log('PASS: content edits published from the page reach a player, survive a restart, refuse stale and dangling edits, and roll back.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
  writeFileSync(`${out}/content-server.log`, log);
});
