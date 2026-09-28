/* Run the carcass loop alone while developing; the required playtest calls the same function. */
const { chromium } = require('playwright');
const playCart = require('./playtest-cart.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    page.on('pageerror', (error) => console.error('PAGE ERROR', error.message));
    page.on('console', (message) => { if (message.type() === 'error') console.error('PAGE CONSOLE', message.text()); });
    await page.goto(process.env.ADDRESS || 'http://localhost:5177/?seed=3');
    console.log('cartwalk page loaded');
    await page.waitForFunction(() => window.__world?.world === 'endless' && window.__entitiesFull,
      null, { timeout: 60000 }).catch(async (error) => {
        console.error('WORLD STATE', await page.evaluate(() => ({ world: window.__world, probes: !!window.__entitiesFull })));
        throw error;
      });
    console.log('cartwalk world ready');
    // Match the main playtest, which has already bought and parked a horse at the village wall.
    await page.evaluate(() => window.__ride(true));
    await page.waitForFunction(() => window.__mount().under < 0.2, null, { timeout: 5000 });
    await page.evaluate(() => window.__ride(false));
    const results = [];
    const say = (name, ok, detail) => {
      results.push({ name, ok });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
    };
    const go = async (x, z, wait = 5000) => {
      await page.evaluate(([x, z]) => window.__teleport(x, z), [x, z]);
      await page.waitForTimeout(wait);
    };
    const face = async (x, z) => {
      await page.evaluate(([x, z]) => {
        const p = window.__player;
        window.__iso.rotation = Math.atan2(z - p.z, x - p.x) + Math.PI;
      }, [x, z]);
      await page.waitForTimeout(150);
    };
    await playCart(page, say, go, face);
    if (results.some((r) => !r.ok) || results.length < 5) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
