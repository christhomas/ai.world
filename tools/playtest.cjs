/*
 * A game of the game, played by a script, that says what worked and what did not.
 *
 * Written because a day of "collision is fixed" turned out to mean "collision is fixed in the
 * places I measured". Every fault in this session was invisible to the tests and obvious in thirty
 * seconds of playing: a house you walk through from one side, a wolf drawn a tile from where the
 * world has it, a bed you stand inside, a door that fires twice a second. So this plays instead of
 * asking: it walks into a house, watches the world's own creatures against where they are drawn,
 * chases one animal by the number the world knows it by and swings at it, walks through a door
 * both ways, and looks at the furniture from inside.
 *
 * It is not a unit test and does not pretend to be: it drives a real browser, it takes a couple of
 * minutes, and a village is different every seed. What it is good for is the question the unit
 * tests cannot answer — whether the thing on the screen and the thing in the simulation are the
 * same thing.
 *
 *   chore playtest              # serves the page, plays it, and stops the server again
 *   chore playtest 5174         # or plays against a server you already have up, and leaves it up
 *
 * It used to need a dev server already running and to be pointed at port 5173 by hand, which is
 * why it never ran anywhere but on somebody's desk. It now looks at the address it is about to
 * open, and if nothing answers there it starts `vite` on that port itself and stops it again on
 * the way out, whether it passed, failed or threw. A server that was already answering is left
 * exactly as it was found — that is the case where somebody is playing the game in one window and
 * running this in another, and killing their dev server would be rude.
 *
 * Everything it needs is an environment variable with a sensible default, so nothing here is
 * pinned to one machine:
 *
 *   PORT=5173  WORLD=mesh  SEED=3     the address, assembled
 *   ADDRESS=...                       or the whole address at once, if you want a different shape
 *   CHANNEL=chrome                    which browser; empty means playwright's own chromium
 *   DRIFT=0.35                        how far a creature may be drawn from where the world has it
 *   OUT=playtest-report.txt           where the account of the run is written
 *
 * Playwright is deliberately not a dependency of this project and still is not. Borrow one with
 * NODE_PATH — a checkout that already has it locally, an `npm i -g playwright` in CI. The reason
 * is that `package.json` is installed by things that will never play the game: the Pages build, and
 * the server image, which does `pnpm install --frozen-lockfile` twice, once per architecture. A
 * browser toolchain in a world-server image is exactly the shape of the last thing that nearly
 * killed that container. And a devDependency would only half-declare it anyway: the browser
 * binaries are a separate download keyed by the playwright version, not something the lockfile has
 * ever held.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const PORT = process.env.PORT || '5173';
const WORLD = process.env.WORLD || 'mesh';
const SEED = process.env.SEED || '3';
const ADDRESS = process.env.ADDRESS || `http://localhost:${PORT}/?world=${WORLD}&seed=${SEED}`;
// Empty means playwright's own chromium. The default is the real Chrome because that is the one a
// borrowed playwright can always reach: its bundled chromium is a numbered download that matches
// the borrowed version and is usually not the one that checkout happens to have on disk.
const CHANNEL = process.env.CHANNEL ?? 'chrome';
const OUT = process.env.OUT || 'playtest-report.txt';
/*
 * How far a creature may be drawn from where the world has it, on average, before that counts as
 * wrong. Nameable rather than fixed, because it is not purely a fact about the game: the drawn body
 * is carried forward by the page between snapshots, so the gap when the next snapshot lands is
 * partly a measure of how many frames the page got. On a quiet machine it reads 0.11 to 0.13; the
 * same build on the same machine with the cores busy read 0.46 and failed. A pipeline's browser is
 * a software rasteriser on two shared cores, which is the worst case of that, so it has to be
 * allowed to name a looser line than a desk does — and every run prints the number it actually got,
 * so the line can be drawn from evidence rather than from nerve.
 */
const DRIFT = Number(process.env.DRIFT || '0.35');

const results = [];
const errs = [];
const say = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

/**
 * The page server, if nobody else is already running one.
 *
 * A server that is already answering belongs to somebody — play against it and leave it up. One we
 * started is ours and has to go afterwards whatever happened, which is why it is detached: killing
 * the process group takes vite with it, and killing only the `pnpm` that spawned it leaves vite
 * holding the port. The next run then dies at `--strictPort` complaining that the port is taken,
 * which looks nothing like "the last run did not clean up after itself".
 */
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
  if (await answering()) { console.log(`playing against the server already on ${origin}`); return; }
  const port = new URL(ADDRESS).port || '80';
  console.log(`nothing on ${origin} — starting one`);
  // stdout discarded so vite's banner does not land in the middle of the PASS lines; stderr kept,
  // because a server that refuses to start is the first thing worth knowing
  ours = spawn('pnpm', ['vite', '--port', port, '--strictPort'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await answering()) return;
  }
  throw new Error(`no page server answered on ${origin} after a minute`);
};
// Ctrl-C partway through a two-minute run is the ordinary way to stop it, and it must not leave a
// vite behind either.
process.on('exit', stopServing);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopServing(); process.exit(130); });

/**
 * The account of the run, and the number a pipeline stops on.
 *
 * Written to a file as well as printed, the way the benches do, because the run somebody wants to
 * read is the one that failed and the one that failed is the one whose output has scrolled away.
 * The exit code is the point of the whole exercise: before today this printed FAIL and exited 0,
 * which is precisely how a broken game gets merged.
 */
const finish = async () => {
  const bad = results.filter((r) => !r.ok).length;
  const errors = errs.length ? 'PAGE ERRORS: ' + errs.slice(0, 3).join(' | ') : 'no page errors';
  const tally = `${results.length - bad}/${results.length} passed`;
  fs.writeFileSync(OUT, [
    'A game of the game, played by a script.',
    '',
    `page     ${ADDRESS}`,
    `browser  ${CHANNEL || "playwright's own chromium"}`,
    `drift    ${DRIFT} tiles allowed`,
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
  // Nothing played at all is a failure too: a browser that never opened the page passes every
  // check it never ran.
  process.exitCode = bad > 0 || results.length === 0 ? 1 : 0;
  if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  stopServing();
};

(async () => {
  await startServing();
  browser = await chromium.launch({ headless: true, channel: CHANNEL || undefined, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(ADDRESS, { waitUntil: 'load' });
  await page.waitForTimeout(18000);

  const at = () => page.evaluate(() => ({ x: window.__player.x, z: window.__player.z, place: window.__place() }));
  const go = async (x, z, wait = 5000) => { await page.evaluate(([x, z]) => window.__teleport(x, z), [x, z]); await page.waitForTimeout(wait); };
  const walk = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(180); };
  const face = async (tx, tz) => { await page.evaluate(([tx, tz]) => { const p = window.__player; window.__iso.rotation = Math.atan2(tz - p.z, tx - p.x) + Math.PI; }, [tx, tz]); await page.waitForTimeout(150); };
  const enter = async () => {
    const door = await page.evaluate(() => {
      const v = window.__villages[0];
      const d = window.__doors.filter((x) => x.village === v.name)[0];
      const ox = d.x - d.bx, oz = d.z - d.bz, len = Math.hypot(ox, oz) || 1;
      window.__teleport(d.x + 0.5 + (ox / len) * 2, d.z + 0.5 + (oz / len) * 2);
      return { x: d.x + 0.5, z: d.z + 0.5 };
    });
    await page.waitForTimeout(5000);
    await face(door.x, door.z);
    let place = (await at()).place;
    let restedOnArrival = 0;
    for (let i = 0; i < 14 && place === 'surface'; i++) {
      await walk('w', 220);
      place = (await at()).place;
      // read the rest at the moment we land, not after several more attempts to get in: five
      // seconds is a short time in a script that walks a step at a time
      if (place !== 'surface') restedOnArrival = await page.evaluate(() => window.__room()?.resting ?? 0);
    }
    return { door, place, restedOnArrival };
  };
  // anything with hearts that is not a person and does not fly: something a swing can land on
  // slowest first: a hero can catch a sheep, and cannot catch a deer that has seen him
  const PREY = ['sheep', 'cow', 'goat', 'pig', 'chicken', 'boar', 'wolf', 'deer'];
  // the same animal each time, by the number the world knows it by: "the nearest wolf" is two
  // different wolves either side of a swing, and a test that compares those is measuring nothing
  const quarryNow = (id) => page.evaluate((id) => {
    const p = window.__player;
    const e = window.__entitiesFull().find((c) => c.id === id && !c.dead);
    return e ? { kind: e.kind, x: e.x, z: e.z, hp: e.hp, d: Math.hypot(e.x - p.x, e.z - p.z) } : null;
  }, id);

  const w = await page.evaluate(() => window.__world);
  say('the world is the one the link asked for', w.world === 'mesh' && w.online === 'online', JSON.stringify(w));

  // --- walking into things ---
  const house = await page.evaluate(() => { const v = window.__villages[0]; const h = v.houses[0]; return { x: h.tx + 0.5, z: h.tz + 0.5, rot: h.rot }; });
  await go(house.x - Math.cos(house.rot) * 4, house.z - Math.sin(house.rot) * 4);
  await face(house.x, house.z);
  await walk('w', 5000);
  const off = Math.hypot((await at()).x - house.x, (await at()).z - house.z);
  say('a house stops you at its wall', off > 1.1 && off < 3, `closest ${off.toFixed(2)} tiles from its middle`);

  // a tree, which is the thing that always worked, as a control
  const tree = await page.evaluate(() => {
    const p = window.__player;
    for (let r = 2; r < 20; r += 0.5) for (let a = 0; a < 6.28; a += 0.3) {
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (window.__solid(x, z)) return { x, z };
    }
    return null;
  });
  say('something solid stands near the village', tree !== null, tree ? `at ${tree.x.toFixed(1)},${tree.z.toFixed(1)}` : '');

  // --- creature sync ---
  await go(133.5, 67.5, 6000);
  await page.evaluate(() => window.__drift);
  await page.waitForTimeout(8000);
  const d = await page.evaluate(() => window.__drift);
  say('creatures within reach are drawn where they are', d.wrongClose.of > 0 && d.wrongClose.mean < DRIFT,
    `${d.wrongClose.of} corrections, mean ${d.wrongClose.mean.toFixed(2)}, worst ${d.wrongClose.worst.toFixed(2)} (${d.wrongClose.worstIs}), against ${DRIFT}`);

  // --- and the same wall, at a gallop ---
  /*
   * The mounted case, which is the one that made stepping over things visible in the first place
   * and which this script has never once played.
   *
   * A horse does not carry the hero, it multiplies his pace — so what changes is the length of a
   * step, and a step longer than the thing it is walking into is exactly how a wall gets stepped
   * over. The collision bench walks the arithmetic at a courser's pace already; this is the played
   * half, at whatever frame rate this machine actually manages, which is where the sweep is
   * genuinely under load.
   *
   * `__ride` exists because mounting is only reachable through a stable's dialogue: a person does
   * that in ten seconds and a script cannot do it at all.
   */
  const rode = await page.evaluate(() => window.__ride(true));
  say('the hero can get on a horse', rode && rode.riding === true, JSON.stringify(rode));
  await go(house.x - Math.cos(house.rot) * 6, house.z - Math.sin(house.rot) * 6);
  await face(house.x, house.z);
  await walk('w', 5000);
  const rider = await at();
  const galloped = Math.hypot(rider.x - house.x, rider.z - house.z);
  say('a house stops a horse at its wall too', galloped > 1.1 && galloped < 3,
    `closest ${galloped.toFixed(2)} tiles from its middle, riding`);
  await page.evaluate(() => window.__ride(false));

  // --- a fight ---
  // something with nothing solid between us: a goat in a paddock is behind a fence, and the test
  // would be measuring the fence.
  //
  // Measured at the range that actually matters, which is not where we are standing now. The fight
  // begins by teleporting two tiles off the animal's corner, so the only fence that can spoil it is
  // the one inside those two tiles. Asking instead for a clear line all the way from the drift
  // check's vantage — up to forty tiles — was the same test in name only: about a tenth of the
  // ground round there is trees, and a line that long crosses one essentially every time. So this
  // found nothing to swing at, said so, and the fight was never played at all. Discovered by
  // running the thing in a pipeline, which is the entire argument for running it in a pipeline.
  const first = await page.evaluate((kinds) => {
    const p = window.__player;
    const clearTo = (x, z) => {
      const fx = x + 2, fz = z + 2;
      if (window.__solid(fx, fz)) return false;   // nowhere to stand
      const steps = Math.ceil(Math.hypot(fx - x, fz - z) / 0.15);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (window.__solid(fx + (x - fx) * t, fz + (z - fz) * t)) return false;
      }
      return true;
    };
    const all = window.__entitiesFull().filter((e) => kinds.includes(e.kind) && !e.dead && e.hp > 0)
      .map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z, hp: e.hp, d: Math.hypot(e.x - p.x, e.z - p.z) }))
      .sort((a, b) => (kinds.indexOf(a.kind) - kinds.indexOf(b.kind)) || (a.d - b.d));
    return all.find((e) => e.d < 40 && e.id !== null && clearTo(e.x, e.z)) ?? null;
  }, PREY);
  if (!first) say('a blow lands on something', false, 'nothing to swing at');
  else {
    await go(first.x + 2, first.z + 2, 4000);
    const quarry = first.id;
    await go(first.x + 2, first.z + 2, 4000);
    let landed = false, swings = 0, closest = 99, was = null;
    for (let i = 0; i < 45 && !landed; i++) {
      let near = await quarryNow(quarry);
      if (!near) { landed = was !== null; break; }      // gone from the world: it died
      // Put him back within a swing when the chase has lost it, rather than jogging after a deer
      // for forty-five rounds. A hero cannot outrun a deer that has seen him — that is the design,
      // and the list above is ordered slowest-first to avoid depending on it — but around the
      // village on seed 3 there is nothing slower loose, so the chase decided the result and the
      // blow was never thrown. What this check is named for is whether a blow lands on the creature
      // it was aimed at, so the gap is closed and the swing is the thing measured. A swing reaches
      // two tiles (`COMBAT.RANGE`), which is why the corner it starts from — two out on each axis,
      // and so two and five-sixths away — was never inside one either.
      if (near.d > 2) {
        await go(near.x + 1.2, near.z + 1.2, 900);
        near = await quarryNow(quarry);
        if (!near) { landed = was !== null; break; }
      }
      closest = Math.min(closest, near.d);
      await face(near.x, near.z);
      await walk('w', 240);
      const before = await quarryNow(quarry);
      if (!before) { landed = true; break; }
      was = before.hp;
      await page.keyboard.press('x');
      swings++;
      await page.waitForTimeout(500);
      const after = await quarryNow(quarry);
      if (!after || after.hp < before.hp) landed = true;
    }
    say('a blow lands on the animal it was aimed at', landed,
      `${swings} swings at one ${first.kind}, closest ${closest.toFixed(1)} tiles`);
  }

  // --- doors, both ways ---
  const first_in = await enter();
  say('walking into a door takes you inside', first_in.place !== 'surface', first_in.place);

  if (first_in.place !== 'surface') {
    say('and the door rests afterwards', first_in.restedOnArrival > 1, `${first_in.restedOnArrival}s left on arrival`);

    // --- furniture, while we are in here ---
    const furniture = await page.evaluate(() => {
      const r = window.__room();
      if (!r || r.furniture.length === 0) return null;
      let wide = 0;
      for (const f of r.furniture) {
        for (const [dx, dz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) {
          if (r.solid(f.x + 0.5 + dx, f.z + 0.5 + dz)) { wide++; break; }
        }
      }
      return { pieces: r.furniture.length, wide };
    });
    say('furniture is solid where it is drawn, not only on its tile',
      furniture !== null && furniture.wide > 0, furniture ? `${furniture.wide} of ${furniture.pieces} reach past their own tile` : 'not indoors');

    await page.waitForTimeout(5500);
    let out = first_in.place;
    let lastAt = await at();
    let veer = 0;
    for (let i = 0; i < 35 && out !== 'surface'; i++) {
      // head for the doorway, and when a step gets nowhere — a table, a barrel, the counter — try
      // a heading either side of it. A room has furniture in it and walking at a door in a straight
      // line is not how anybody crosses one.
      await page.evaluate((veer) => {
        const r = window.__room(); const p = window.__player;
        if (r) window.__iso.rotation = Math.atan2(r.door[1] + 0.5 - p.z, r.door[0] + 0.5 - p.x) + Math.PI + veer;
      }, veer);
      await walk('w', 220);
      const now = await at();
      const moved = Math.hypot(now.x - lastAt.x, now.z - lastAt.z);
      veer = moved < 0.08 ? (veer === 0 ? 0.9 : -veer) : 0;
      lastAt = now;
      out = now.place;
    }
    say('and walking into it again takes you out', out === 'surface', out);
  }

  await finish();
})().catch(async (e) => {
  // A crash halfway is a failed playtest, not a silent one. It is also the run whose account is
  // worth the most, so it gets written like any other, with the thing that threw as the last line
  // of it — and the server this started still has to be put away.
  say('the playtest ran to the end', false, (e && e.message) || String(e));
  await finish();
});
