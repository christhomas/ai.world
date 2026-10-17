#!/usr/bin/env node
/*
 * The web half of the cross-platform journey (#583; docs/mobile/installed-journey.md).
 *
 * Starts a throwaway world server on WORLD_PORT (8787) and the page on PAGE_PORT (5173), and opens a
 * web player in the shared world `seed=SEED&world=road`. It prints CROSSPLAY_READY once that player
 * is in, then watches for anybody else arriving, which is the phone. When the phone is seen, it
 * takes a picture of the page; whatever happens, it writes `crossplay-web.json` to CROSSPLAY_OUT and
 * keeps playing until it is stopped, so the phone can see it back.
 */
const { chromium } = require('playwright');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WORLD_PORT = process.env.WORLD_PORT || '8787';
const PAGE_PORT = process.env.PAGE_PORT || '5173';
const SEED = process.env.CROSSPLAY_SEED || '7';
const OUT = process.env.CROSSPLAY_OUT || os.tmpdir();
const WAIT_MS = Number(process.env.CROSSPLAY_WAIT_MS || 20 * 60 * 1000);
const children = [];

const answers = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
};
const until = async (check, what, seconds) => {
  for (let i = 0; i < seconds; i++) {
    if (await check()) return;
    await new Promise((resume) => setTimeout(resume, 1000));
  }
  throw new Error(`${what} did not answer within ${seconds} s`);
};
const stop = () => { for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } } };
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

const result = { seed: SEED, webIn: false, sawPhone: false, others: 0, names: [], error: null };
const write = () => fs.writeFileSync(path.join(OUT, 'crossplay-web.json'), JSON.stringify(result, null, 2));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // the server as the published image runs it, with worlds of its own that are thrown away after
  execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'server/build.config.ts'], { stdio: ['ignore', 'ignore', 'inherit'] });
  children.push(spawn('node', ['server/dist/server.mjs'], {
    detached: true, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PORT: WORLD_PORT, OPERATOR_TOKEN: 'crossplay-only-token',
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'crossplay-')) },
  }));
  await until(() => answers(`http://localhost:${WORLD_PORT}/`), 'the world server', 60);
  children.push(spawn('pnpm', ['vite', '--port', PAGE_PORT, '--strictPort', '--host', '127.0.0.1'],
    { detached: true, stdio: ['ignore', 'ignore', 'inherit'] }));
  await until(() => answers(`http://127.0.0.1:${PAGE_PORT}/`), 'the page server', 90);

  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 540 } });
  page.setDefaultTimeout(5 * 60 * 1000);
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/?world=road&seed=${SEED}&server=ws://localhost:${WORLD_PORT}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__online?.connected && window.__online?.away, null, { polling: 500 });
  result.webIn = true;
  write();
  console.log('CROSSPLAY_READY');

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const seen = await page.evaluate(() => ({
      others: window.__online?.count ?? 0,
      names: [...document.querySelectorAll('#nameplates .nameplate')].map((one) => one.textContent),
    }));
    Object.assign(result, seen);
    if (seen.others > 0 && !result.sawPhone) {
      result.sawPhone = true;
      write();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(OUT, 'crossplay-web.png') });
      console.log(`CROSSPLAY_SAW_PHONE ${JSON.stringify(seen)}`);
    }
    write();
    await page.waitForTimeout(2000);
  }
})().catch((error) => {
  result.error = String(error && error.stack || error);
  write();
  console.log(`CROSSPLAY_FAILED ${result.error.split('\n')[0]}`);
  process.exit(1);
});
