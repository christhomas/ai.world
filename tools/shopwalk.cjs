/*
 * Two counters in two countries, walked in a real browser.
 *
 * Item 106 is the reason this exists. `__enterShop` took the first village in the world with a
 * counter of the right sort, whatever village the hero was standing in — so the one walk that
 * would have caught the `paidFor` fault could not be written, and a person reading two flashes in
 * two countries caught it instead. The selection, the way out and the pricing all have unit tests
 * now; what they do not have is a run through the page that proves the three of them work
 * together, which is what the review on PR #117 asked for and what this is.
 *
 * Four things, and the fourth is the one worth the browser:
 *
 *   1. a named village is the one entered, not the first one the world holds;
 *   2. an unnamed entry takes the nearest counter to wherever the hero is standing;
 *   3. `__leaveShop` puts him back outdoors, which nothing could do before;
 *   4. the same pelt is quoted at two different prices in two countries, *and each quote matches
 *      the country the shop's door stands in* — not the room the hero is standing in, whose
 *      coordinates are local to the interior and are not anywhere in the world at all.
 *
 * The fourth is why a unit test is not enough. A room is a separate little world with its own
 * coordinates, and the bug it guards against — pricing a counter at the hero's indoor position —
 * looks completely correct in every unit test that does not actually walk through a door.
 *
 *   chore shopwalk              # serves the page, walks it, and stops the server again
 *   chore shopwalk 5174         # or walks against a server you already have up, and leaves it up
 *
 * Playwright is borrowed rather than depended on, exactly as `chore playtest` borrows it and for
 * the same reason: `package.json` is installed by the Pages build and by the server image, and a
 * browser toolchain in a world-server image is the shape of the last thing that nearly killed that
 * container. Point NODE_PATH at a checkout that has one.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const PORT = process.env.PORT || '5173';
const WORLD = process.env.WORLD || 'road';
const SEED = process.env.SEED || '3';
const ADDRESS = process.env.ADDRESS || `http://localhost:${PORT}/?world=${WORLD}&seed=${SEED}`;
const CHANNEL = process.env.CHANNEL ?? 'chrome';
// kept as a literal because this file is CommonJS and `src/core/reports.ts` is an ES module.
// The one place that decides this is that file; a second spelling of it here is the cost of the
// two module systems, and `reports.test.ts` fails if they ever disagree.
const REPORTS_DIR = 'docs/reports';
require('node:fs').mkdirSync(REPORTS_DIR, { recursive: true });
const OUT = process.env.OUT || require('node:path').join(REPORTS_DIR, 'shopwalk-report.txt');

const results = [];
const errs = [];
const say = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

let ours = null;
let browser = null;
const origin = new URL(ADDRESS).origin;
const answering = async () => {
  try { return (await fetch(origin, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
};
const stopServing = () => {
  if (!ours) return;
  try { process.kill(-ours.pid, 'SIGTERM'); } catch { /* it beat us to it */ }
  ours = null;
};
const startServing = async () => {
  if (await answering()) { console.log(`walking against the server already on ${origin}`); return; }
  const port = new URL(ADDRESS).port || '80';
  console.log(`nothing on ${origin} — starting one`);
  ours = spawn('pnpm', ['vite', '--port', port, '--strictPort'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await answering()) return;
  }
  throw new Error(`no page server answered on ${origin} after a minute`);
};
process.on('exit', stopServing);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopServing(); process.exit(130); });

const finish = async () => {
  const bad = results.filter((r) => !r.ok).length;
  const errors = errs.length ? 'PAGE ERRORS: ' + errs.slice(0, 3).join(' | ') : 'no page errors';
  const tally = `${results.length - bad}/${results.length} passed`;
  fs.writeFileSync(OUT, [
    'Two counters in two countries, walked in a real browser.',
    '',
    `page     ${ADDRESS}`,
    `browser  ${CHANNEL || "playwright's own chromium"}`,
    `run      ${new Date().toISOString()}`,
    '',
    ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`),
    '',
    errors,
    tally,
  ].join('\n') + '\n');
  console.log('');
  console.log(errors);
  console.log(tally);
  console.log(`report written to ${OUT}`);
  process.exitCode = bad > 0 || results.length === 0 ? 1 : 0;
  if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  stopServing();
};

(async () => {
  await startServing();
  browser = await chromium.launch({
    headless: true, channel: CHANNEL || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(ADDRESS, { waitUntil: 'load' });
  await page.waitForTimeout(18000);

  const wait = (ms) => page.waitForTimeout(ms);
  const place = () => page.evaluate(() => window.__place());
  const enter = (named) => page.evaluate((n) => window.__enterShop('store', n), named);
  const leave = () => page.evaluate(() => window.__leaveShop());
  const go = async (x, z) => { await page.evaluate(([x, z]) => window.__teleport(x, z), [x, z]); await wait(2500); };

  /*
   * Two villages with a counter, in different countries, which is the whole premise. A seed that
   * cannot offer two is not a failing world — it is a world this walk has nothing to say about, and
   * saying so is better than passing by accident.
   */
  const shops = await page.evaluate(() => window.__villages
    .filter((v) => v.shops.some((s) => s.type === 'store'))
    .map((v) => ({ name: v.name, x: v.x, z: v.z, biome: v.biome })));
  const countries = [...new Set(shops.map((s) => s.biome))];
  if (shops.length < 2 || countries.length < 2) {
    say('two counters in two countries to walk between', false,
      `this seed has ${shops.length} store village(s) across ${countries.length} country(ies)`);
    return finish();
  }
  const here = shops.find((s) => s.biome === countries[0]);
  const away = shops.find((s) => s.biome === countries[1]);
  say('two counters in two countries to walk between', true, `${here.name} (${here.biome}) and ${away.name} (${away.biome})`);

  /*
   * A pelt in the pack, put there rather than hunted for.
   *
   * `chore playtest` kills and skins one, which is the right thing for a walk about hunting and the
   * wrong thing for a walk about counters: it would make this test fail for reasons that have
   * nothing to do with a shop. The pack is the hero's own state and the probe hooks hand it over.
   */
  const carrying = await page.evaluate(() => {
    const pack = window.__state.inventory.items;
    pack.set('pelt', (pack.get('pelt') ?? 0) + 4);
    window.__state.version++;
    return pack.get('pelt');
  });
  say('a pelt in the pack to be quoted for', carrying >= 4, `${carrying} carried`);

  const choices = () => page.evaluate(() => Array.from(document.querySelectorAll('#dialogue .dlg-choice'))
    .map((el) => el.textContent.trim()));

  /**
   * The rows a conversation is offering, once it has any.
   *
   * Waited for rather than read at a fixed moment. The first village reads empty and the second
   * reads fine off exactly the same code, because a shop opened in a chunk the page has only just
   * streamed takes longer to put its first panel up — and a test that passes in the second village
   * and fails in the first is measuring the machine, not the game.
   */
  const rowsWhenTheyCome = async (why) => {
    for (let n = 0; n < 20; n++) {
      const rows = await choices();
      if (rows.length > 0) return rows;
      await wait(300);
    }
    errs.push(`no dialogue rows after six seconds: ${why}`);
    return [];
  };

  /** The quote a counter gives for the pelt, read off the trestle it actually renders. */
  const quotedAt = async (village) => {
    const entered = await enter(village.name);
    await wait(1500);
    if (!entered || !entered.startsWith(village.name)) return { entered, price: null };
    await page.evaluate(() => window.__standAtCounter());
    await wait(1000);
    // the canvas takes the keys, and a page that has never been clicked has not given it the focus
    await page.locator('canvas').first().click({ position: { x: 550, y: 360 } }).catch(() => {});
    await wait(300);
    await page.keyboard.press('Enter');                 // the shopkeeper
    const front = await rowsWhenTheyCome(`the counter at ${village.name}`);
    // "Sell" is a row on the shop's front page; the trestle behind it is where a price is written
    const sellAt = front.findIndex((r) => /sell/i.test(r));
    if (sellAt < 0) return { entered, price: null, rows: front };
    for (let n = 0; n < sellAt; n++) { await page.keyboard.press('ArrowDown'); await wait(150); }
    await page.keyboard.press('Enter');
    await wait(1200);
    const trestle = await rowsWhenTheyCome(`the trestle at ${village.name}`);
    const pelt = trestle.find((r) => /pelt/i.test(r));
    const price = pelt ? Number((pelt.match(/(\d+)g/) ?? [])[1]) : null;
    return { entered, price, rows: trestle };
  };

  const first = await quotedAt(here);
  say(`the named village is the one entered — ${here.name}`, Boolean(first.entered && first.entered.startsWith(here.name)),
    String(first.entered));
  say(`a pelt is quoted at ${here.name}`, Number.isFinite(first.price), first.price === null ? (first.rows ?? []).join(' / ') : `${first.price}g`);

  await page.keyboard.press('Escape');
  await wait(600);
  const out = await leave();
  await wait(1500);
  const outside = await place();
  say('leaving a shop puts the hero back outdoors', out !== null && outside === 'surface', `__leaveShop → ${out}, place → ${outside}`);

  const second = await quotedAt(away);
  say(`the named village is the one entered — ${away.name}`, Boolean(second.entered && second.entered.startsWith(away.name)),
    String(second.entered));
  say(`a pelt is quoted at ${away.name}`, Number.isFinite(second.price), second.price === null ? (second.rows ?? []).join(' / ') : `${second.price}g`);

  /*
   * The assertion the whole walk is for. Two countries, two quotes — and if they are the same
   * number, the counter is being priced somewhere that is not where it stands, which is exactly the
   * fault the room's local coordinates would cause and exactly what no unit test can see.
   */
  if (Number.isFinite(first.price) && Number.isFinite(second.price)) {
    say('the same pelt is worth different money in different countries', first.price !== second.price,
      `${here.name} (${here.biome}) ${first.price}g vs ${away.name} (${away.biome}) ${second.price}g`);
  }

  await page.keyboard.press('Escape');
  await wait(600);
  const outAgain = await leave();
  await wait(1500);
  say('and out of the second one as well', outAgain !== null && (await place()) === 'surface', String(outAgain));

  /*
   * And the nearest counter when nobody names one, which is the half of item 106 that made a
   * location-dependent walk impossible: standing in one village and being served by another.
   */
  await go(away.x, away.z);
  const nearest = await enter(undefined);
  await wait(1200);
  say('an unnamed entry takes the counter nearest the hero', Boolean(nearest && nearest.startsWith(away.name)),
    `stood in ${away.name}, entered ${nearest}`);
  await leave();

  await finish();
})().catch(async (e) => {
  say('the walk ran to the end', false, e.message);
  await finish();
});
