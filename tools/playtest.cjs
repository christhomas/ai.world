/*
 * A game of the game, played by a script, that says what worked and what did not.
 *
 * Written because a day of "collision is fixed" turned out to mean "collision is fixed in the
 * places I measured". Every fault in this session was invisible to the tests and obvious in thirty
 * seconds of playing: a house you walk through from one side, a wolf drawn a tile from where the
 * world has it, a bed you stand inside, a door that fires twice a second. So this plays instead of
 * asking: it walks into a house, watches the world's own creatures against where they are drawn,
 * chases one animal by the number the world knows it by and swings at it, buys a horse and rides it
 * at the same wall and then at a paddock rail, walks through a door both ways, and looks at the
 * furniture from inside.
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
  /*
   * Wait for a world rather than for eighteen seconds. The page has to build a countryside before
   * any of this means anything, and how long that takes is a fact about the machine: eighteen was
   * plenty on the desk it was written on and is not always plenty on a box running four browsers.
   */
  await page.waitForTimeout(6000);
  const worldIsUp = async () => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      const up = await page.evaluate(() => {
        try { return Boolean(window.__player) && !window.__solid(window.__player.x, window.__player.z); }
        catch { return false; }
      });
      if (up) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  };
  if (!await worldIsUp()) errs.push('the page never finished building a world');

  const at = () => page.evaluate(() => ({ x: window.__player.x, z: window.__player.z, place: window.__place() }));
  /**
   * Wait for something the game only settles between frames, and give up rather than hang.
   *
   * Asking rather than counting seconds, because everything worth waiting for here is measured in
   * game time and game time is not wall time: the loop clamps a frame to a tenth of a second, so a
   * page holding three frames a second lives at a third speed. Five seconds of patience is a second
   * and a half of the game, which is how a door that rests for five came to be still shut when
   * somebody walked into it.
   */
  const settles = async (ask, ok, ceiling = 45000, args = undefined) => {
    const until = Date.now() + ceiling;
    let answer = await page.evaluate(ask, args);
    while (!ok(answer) && Date.now() < until) {
      await page.waitForTimeout(300);
      answer = await page.evaluate(ask, args);
    }
    return answer;
  };

  /**
   * Put the hero somewhere, and wait for the country to arrive rather than for the clock.
   *
   * Ground nobody has streamed yet answers "solid" to everything asked about it, so a hero standing
   * where the world has not been built is a hero every check around him is wrong about — every side
   * of a paddock is walled, every lane is nought tiles long, and a wall is wherever he happens to be
   * standing. This used to be a fixed few seconds, which is enough on a quiet machine and is not on
   * one running four browsers: one run had him ride clean past a house that was not built yet and
   * then report that no village in the world keeps a paddock.
   */
  const go = async (x, z, ceiling = 20000) => {
    await page.evaluate(([x, z]) => window.__teleport(x, z), [x, z]);
    await page.waitForTimeout(500);
    // the country round him, not only the tile he is standing on. The tile under a hero is built
    // first and the rest arrives after it, so a check that starts the moment he can stand is a check
    // asking about a village half of which is not there yet — and half a village reads as walls
    await settles(() => {
      const p = window.__player;
      if (window.__solid(p.x, p.z)) return 0;
      let clear = 0;
      for (let a = 0; a < 6.283; a += 0.785) if (!window.__solid(p.x + Math.cos(a) * 5, p.z + Math.sin(a) * 5)) clear++;
      return clear;
    }, (clear) => clear >= 4, ceiling);
    await page.waitForTimeout(400);       // and a beat for whatever stands on it to be put there too
  };
  /**
   * Take a step: hold a key until the hero has covered some ground, and let go.
   *
   * A step used to be a quarter of a second held, which is a step only on a machine that is drawing
   * frames. The loop clamps a frame to a tenth of a second, so a page given three frames a second
   * runs the game at a third speed and a page given one at a tenth — and a quarter of a second of
   * that is a hero who has not moved, which every loop below reads as "something is in the way" and
   * veers round. That is how the door out of a shop came to fail on a busy machine and pass on a
   * quiet one, with nothing between the two runs but what else the box was doing.
   *
   * So: ground, with a count of frames and a wall clock behind it. On a page holding sixty the frame
   * count is what ends it and this is the quarter-second it always was; on a page holding three the
   * ground is, and it takes a second instead. What comes back is how far he actually got, because
   * "he did not move" is the answer half of these loops are looking for.
   */
  const walk = async (key, tiles = 1.2, mostFrames = 14, ceiling = 6000) => {
    await page.keyboard.down(key);
    const run = await page.evaluate(async ([tiles, mostFrames, ceiling]) => {
      const p = window.__player;
      const from = { x: p.x, z: p.z };
      const until = performance.now() + ceiling;
      let frames = 0;
      while (frames < mostFrames && performance.now() < until
        && Math.hypot(p.x - from.x, p.z - from.z) < tiles) {
        await new Promise((r) => requestAnimationFrame(r));
        frames++;
      }
      return { frames, moved: Math.hypot(p.x - from.x, p.z - from.z) };
    }, [tiles, mostFrames, ceiling]);
    await page.keyboard.up(key);
    await page.waitForTimeout(120);
    return run;
  };
  const face = async (tx, tz) => { await page.evaluate(([tx, tz]) => { const p = window.__player; window.__iso.rotation = Math.atan2(tz - p.z, tx - p.x) + Math.PI; }, [tx, tz]); await page.waitForTimeout(150); };
  const enter = async () => {
    const door = await page.evaluate(() => {
      const v = window.__villages[0];
      const d = window.__doors.filter((x) => x.village === v.name)[0];
      const ox = d.x - d.bx, oz = d.z - d.bz, len = Math.hypot(ox, oz) || 1;
      window.__teleport(d.x + 0.5 + (ox / len) * 2, d.z + 0.5 + (oz / len) * 2);
      return { x: d.x + 0.5, z: d.z + 0.5 };
    });
    await settles(() => !window.__solid(window.__player.x, window.__player.z), (there) => there === true);
    await page.waitForTimeout(400);
    await face(door.x, door.z);
    let place = (await at()).place;
    let restedOnArrival = 0;
    for (let i = 0; i < 14 && place === 'surface'; i++) {
      // faced again every step, because a step is over a tile long and a hero who drifts past the
      // doorway he was aimed at goes on walking into the village and lets himself into somebody's
      // cottage instead, which is a different building with a different door and a different rest
      await face(door.x, door.z);
      await walk('w');
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

  /**
   * Walk at something and stop once he has stopped getting anywhere, however long that takes.
   *
   * Held for a count of *frames the page actually drew* rather than for a count of seconds, because
   * a frame is where the hero moves and this browser is not given many of them. Several agents run
   * browsers on this machine at once, and the loop clamps a frame to a tenth of a second — so a page
   * at three frames a second runs the game at a third speed and a page at one runs it at a tenth,
   * and "hold w for five seconds" is a measurement of the machine rather than of the wall. It read
   * as a wall two and a half tiles out on a quiet box and four on a busy one, which is the width of
   * a house, and the check either side of it never noticed.
   *
   * The watching happens inside the page rather than by polling from here, because a round trip
   * costs more than a frame does and the question is entirely about frames. What comes back is where
   * he ended and how many frames it took, so a run that never got going says so instead of passing
   * for a wall.
   *
   * Progress is read over a window of frames rather than frame by frame. A mounted hero moves in
   * fits — a full stride, then a dead frame, then a stride — so "he did not move this frame" is
   * ordinary on a horse and means nothing on its own; a whole window of them is a wall.
   */
  /*
   * How many frames of getting nowhere count as having arrived at something, and how little ground
   * over them counts as nowhere.
   *
   * Generous on both, because a mounted hero does not move smoothly: he takes a full stride and then
   * a dead frame, over and over, and on a machine under load he can crawl at a fifteenth of his own
   * pace while still plainly walking somewhere. A tighter window called that a wall and reported a
   * house three and a half tiles wider than it is. Somebody actually held against a wall moves
   * exactly nothing, frame after frame, so there is no need to be strict about it.
   */
  const STILL_FOR = 20;
  const NOWHERE = 0.06;
  const shoveInto = async (tx, tz, tries = 3, ceiling = 25000) => {
    let best = null, frames = 0, went = 0;
    for (let n = 0; n < tries; n++) {
      await face(tx, tz);
      await page.keyboard.down('w');
      const run = await page.evaluate(async ([tx, tz, held, nowhere, ceiling]) => {
        const p = window.__player;
        const from = { x: p.x, z: p.z };
        const until = performance.now() + ceiling;
        const trail = [];
        // the closest he ever got, rather than where he happened to be standing when the pressing
        // stopped. Those are the same thing on foot and are not on a horse: the world drags a
        // mounted hero back about half a stride at a time — the worklist has the numbers — so where
        // he ends up is where the last correction left him, and the wall is where he reached.
        let near = { x: from.x, z: from.z, d: Math.hypot(from.x - tx, from.z - tz) };
        let drawn = 0, moving = false, went = 0;
        while (performance.now() < until) {
          await new Promise((r) => requestAnimationFrame(r));
          drawn++;
          const d = Math.hypot(p.x - tx, p.z - tz);
          if (d < near.d) near = { x: p.x, z: p.z, d };
          went = Math.hypot(p.x - from.x, p.z - from.z);
          if (!moving) {
            // the first frames of a press are a key arriving and a hero turning round, and a window
            // of those reads exactly like a wall. But a press that never gets going at all is its
            // own answer — he is already against the thing — and must not wait out the ceiling.
            if (went >= 0.3) moving = true;
            else if (drawn >= held * 2) break;
            continue;
          }
          trail.push({ x: p.x, z: p.z });
          if (trail.length > held) trail.shift();
          if (trail.length === held && Math.hypot(p.x - trail[0].x, p.z - trail[0].z) < nowhere) break;
        }
        return { ...near, drawn, went };
      }, [tx, tz, STILL_FOR, NOWHERE, ceiling]);
      await page.keyboard.up('w');
      await page.waitForTimeout(250);
      frames += run.drawn;
      went = Math.max(went, run.went);
      if (!best || run.d < best.d) best = run;
      // A wall is the closest he can get, so it is a smallest over a few goes rather than one
      // reading. Anything that stops him short only ever stops him short — a villager crossing the
      // lane, a sheep against the rail, half a second of the machine being somewhere else — and all
      // of those have moved on by the next go, while a wall has not. Once a push gains nothing there
      // is nothing left to learn: he is against it.
      if (run.went < 0.35) break;
    }
    // `went` is the most ground any one push covered, which is how a check says "he did walk at it"
    // as against "he was standing there all along and nothing was ever measured"
    return { x: best.x, z: best.z, d: best.d, frames, went };
  };

  /**
   * Wait until nobody is standing on the ground he is about to walk over.
   *
   * A villager stops a hero exactly as a wall does, and the check that follows cannot tell the two
   * apart: it reads "he stopped three tiles out" and blames the house. That is not a hypothetical —
   * the mounted run at this same wall came back at 3.30 tiles one time in four, on ground the
   * walking run had crossed cleanly thirty seconds before, and nothing in the world had changed but
   * where somebody had wandered to.
   *
   * Waiting rather than picking somewhere else, because they wander: standing still is a thing a
   * villager does for a few seconds at a time and this is only ever a few seconds of patience.
   */
  const clearWay = async (fx, fz, tx, tz, tries = 12) => {
    for (let i = 0; i < tries; i++) {
      const inTheWay = await page.evaluate(([fx, fz, tx, tz]) => {
        const p = window.__player;
        const dx = tx - fx, dz = tz - fz, len = Math.hypot(dx, dz) || 1;
        return window.__entitiesFull().filter((e) => {
          if (e.dead) return false;
          // whatever is standing on the hero is the hero's own horse, which he is not stopped by
          if (Math.hypot(e.x - p.x, e.z - p.z) < 1.4) return false;
          const t = Math.max(0, Math.min(len, ((e.x - fx) * dx + (e.z - fz) * dz) / len));
          return Math.hypot(e.x - (fx + (dx / len) * t), e.z - (fz + (dz / len) * t)) < 1.1;
        }).map((e) => e.kind);
      }, [fx, fz, tx, tz]);
      if (inTheWay.length === 0) return true;
      await page.waitForTimeout(1200);
    }
    return false;
  };

  // --- walking into things ---
  const house = await page.evaluate(() => { const v = window.__villages[0]; const h = v.houses[0]; return { x: h.tx + 0.5, z: h.tz + 0.5, rot: h.rot }; });
  // the same spot for the walk and for the ride further down, so the two numbers are about one wall
  // approached over one stretch of ground rather than about two
  const runIn = { x: house.x - Math.cos(house.rot) * 6, z: house.z - Math.sin(house.rot) * 6 };
  await go(runIn.x, runIn.z);
  await clearWay(runIn.x, runIn.z, house.x, house.z);
  const walkedInto = await shoveInto(house.x, house.z);
  const off = walkedInto.d;
  say('a house stops you at its wall', off > 1.1 && off < 3 && walkedInto.went > 1,
    `closest ${off.toFixed(2)} tiles from its middle, over ${walkedInto.frames} frames`);

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
  await go(133.5, 67.5);
  /*
   * Watched in goes rather than for one fixed eight seconds.
   *
   * The world says where its creatures are three times a second, and how many of those land in
   * eight seconds is a fact about the machine rather than about the game: on a busy one none of
   * them do, and reading the tally then gives nought corrections with a mean of nought — which
   * reads as a perfect screen and means only that nobody looked. Reading the tally clears it, so
   * this cannot poll; it watches again instead, until there is something to take an average of.
   */
  let d = null;
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__drift);      // start it clean
    await page.waitForTimeout(8000);
    d = await page.evaluate(() => window.__drift);
    if (d.wrongClose.of > 0) break;
  }
  say('creatures within reach are drawn where they are', d.wrongClose.of > 0 && d.wrongClose.mean < DRIFT,
    `${d.wrongClose.of} corrections, mean ${d.wrongClose.mean.toFixed(2)}, worst ${d.wrongClose.worst.toFixed(2)} (${d.wrongClose.worstIs}), against ${DRIFT}`);

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
  /*
   * Looked for more than once, because what is loose round a village at any moment is not a fact
   * about the game. The world owns these creatures, they wander, and a look that catches every one
   * of them behind a hedge reports "nothing to swing at" — which is the shape of a check failing
   * because of where a sheep happened to be standing rather than because a blow does not land. So it
   * waits and looks again, which is what a player with a sword would do.
   */
  const lookForPrey = () => page.evaluate((kinds) => {
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
  let first = await lookForPrey();
  for (let i = 0; i < 8 && !first; i++) { await page.waitForTimeout(2500); first = await lookForPrey(); }
  if (!first) say('a blow lands on something', false, 'nothing loose to swing at in half a minute of looking');
  else {
    await go(first.x + 2, first.z + 2);
    const quarry = first.id;
    await go(first.x + 2, first.z + 2);
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
      await walk('w');
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

  // --- on horseback ---
  /*
   * The fast case, played rather than computed.
   *
   * Half of this was already done and nobody had noticed. `SPEEDS` in `src/world/collisions.test.ts`
   * walks the hero at a courser's pace — three and a half for a quarter of a second, 4.8 tiles in
   * one go, which is a cottage and out the far side — and that *is* the mounted case as arithmetic
   * sees it, because a horse does not carry the hero, it multiplies his pace. Three and a half is a
   * ceiling rather than a guess, and the game agrees with it: the quickest thing alive is a riding
   * horse on a made road with a cart behind it, at 2.6 by 1.3.
   *
   * What a bench cannot answer is whether that holds in a village. It walks a bare world with one
   * prop standing in it; the walls a player meets are the ones the drawing put there, and this file
   * exists because those two have been different before. So: the same wall the walking check just
   * measured, taken at a gallop, and then a paddock rail — one tile of fence with grass on both
   * sides of it, which is the thinnest solid a village has and so the shape a long step goes over
   * rather than into.
   *
   * A saddle has exactly one door in the game — walk up to a stablehand, have his price on you, pick
   * a line out of his list — which is why none of this had ever been played from a script. `__ride`
   * lends a horse and `__unride` takes it back. Taking it back is not manners: a mount is *saved*,
   * name, palette and breed, so a playtest that bought one would leave the hero owning an animal he
   * never paid for, and a hero still in the saddle changes what every check after this one measures.
   *
   * What is *not* checked here is that a horse gets him there any quicker, and that is deliberate:
   * it does not, and the reason is a fault of the game's rather than of this file's. It is written
   * up in `docs/worklist.md` with the numbers and how to see it again in two lines. The collision
   * checks below are honest in spite of it — a mounted hero's individual stride is still a courser's
   * 1.155 tiles at a clamped frame, which is exactly the step the bench treats as its worst.
   */
  await go(runIn.x, runIn.z);
  const saddled = await page.evaluate(() => window.__ride('horse'));
  /*
   * Buying a horse does not put it under the hero: `buy` stands it beside him and the frame after
   * moves it, so what this waits for is the frame, not a length of time. On a machine with the cores
   * fought over that frame is a second away, and a fixed pause of a second is a check that passes on
   * a quiet desk and fails in a pipeline for a reason that has nothing to do with horses.
   */
  const seated = await settles(() => window.__mount(), (m) => m.riding && m.horse !== null && m.under < 0.15 && m.pace > 1);
  say('the horse is under the hero and not beside him',
    seated.riding && seated.horse !== null && seated.under < 0.15
      && Math.abs((seated.hero.y - seated.horse.y) - saddled.saddle) < 0.05,
    `${saddled.on} drawn ${seated.under} tiles off, the hero ${(seated.hero.y - seated.horse.y).toFixed(2)} above its feet against a ${saddled.saddle} saddle`);

  await clearWay(runIn.x, runIn.z, house.x, house.z);
  const rode = await shoveInto(house.x, house.z);
  const offRidden = rode.d;
  // the same wall from the same side, so the two numbers are about one thing. A wider step does not
  // buy a wider stopping distance: a move is walked in slices of a fifth of a tile and the first
  // slice that is refused ends it, so a courser meets a wall where a walker does or the sweep is
  // wrong about one of them.
  say('and the wall that stops a walker stops a horse in the same place',
    rode.went > 1 && Math.abs(offRidden - off) < 0.5,
    `closest ${offRidden.toFixed(2)} tiles from its middle, against ${off.toFixed(2)} on foot, over ${rode.frames} frames`);

  /*
   * And a rail: one tile of fence with grass on both sides of it.
   *
   * The yard is read off the village rather than hunted for by probing the ground, because a thin
   * band of solid is also what the corner of a cottage looks like from one angle. The gate's own
   * side is left out whole — a gate is a way in, and a hero who slides along a rail and out through
   * the gap has not been stopped by anything, though the check would read where he ended up as the
   * rail having failed.
   *
   * Which rail is not decided in advance, because where a paddock has room to be ridden at is a fact
   * about wherever that village happened to fence one. Stonemere's, the nearest to home on seed 3,
   * is hemmed in on all three of its sides: the best approach it offers is a tile and a half, which
   * is not a gallop, and every earlier version of this check failed there for that reason and
   * blamed the fence. So every paddock in the world is offered the same questions and the one with
   * the longest clear approach wins — Elderton's, six and a half tiles of open field.
   *
   * The questions are asked of a corridor rather than of a line. A prop's box reaches past its own
   * tile, on purpose and by design, so a run-up that is clear along its middle can still be too
   * narrow for a man on a horse — which is exactly what stopped him two tiles short of Stonemere's
   * north rail with nothing whatever in front of him.
   */
  /** Half the width of the gap a rider needs: his own shoulders, and whatever a prop overhangs by. */
  const WIDE = 0.6;
  const paddocks = await page.evaluate(() => {
    const home = window.__villages[0];
    return window.__villages.filter((v) => v.stable)
      .sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))
      .map((v) => ({
        village: v.name, x: v.stable.x + 0.5, z: v.stable.z + 0.5, half: v.stable.half,
        gx: v.stable.gate[0] + 0.5, gz: v.stable.gate[1] + 0.5,
      }));
  });
  let yard = null, rail = null;
  // nearest first, and stop as soon as one is plainly good enough: this costs a teleport and the
  // seconds it takes the page to stream a village each time, and four is already further than any
  // world has needed to be searched
  for (const one of paddocks.slice(0, 4)) {
    // stand in the yard first: `__solid` answers about ground this page has built, and country
    // nobody has streamed reads as solid, so a paddock looked at from three villages away is walled
    // on every side and has no rails at all
    await go(one.x, one.z);
    // a yard whose rails are not there yet is a yard nobody has streamed, which is a different thing
    // from a yard with no rails — and on a busy machine it is the answer that comes back first
    await settles(([cx, cz, half]) => {
      let rails = 0;
      for (let t = -half; t <= half; t++) {
        for (const [x, z] of [[cx + t, cz - half], [cx + t, cz + half], [cx - half, cz + t], [cx + half, cz + t]]) {
          if (window.__solid(x, z)) rails++;
        }
      }
      return rails;
    }, (rails) => rails >= 8, 15000, [one.x, one.z, one.half]);
    const found = await page.evaluate(([cx, cz, half, gx, gz, wide]) => {
      const clear = (x, z, px, pz) => !window.__solid(x, z)
        && !window.__solid(x + px * wide, z + pz * wide) && !window.__solid(x - px * wide, z - pz * wide);
      /** How much open ground there is to ride at this rail across before something else stops him. */
      const runUp = (x, z, dx, dz, px, pz) => {
        let t = 0.7;
        while (t < 7 && clear(x + dx * t, z + dz * t, px, pz)) t += 0.3;
        return t - 0.7;
      };
      const gate = [Math.round((gx - cx) / half), Math.round((gz - cz) / half)];
      const out = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (dx === gate[0] && dz === gate[1]) continue;
        const px = -dz, pz = dx;
        // along the side as well as at its middle, and never the corners, which are two rails meeting
        for (const along of [0, 1, -1, 2, -2]) {
          const x = cx + dx * half + px * along, z = cz + dz * half + pz * along;
          if (!window.__solid(x, z)) continue;                      // a gap in the rails
          // one tile thick with grass on both sides of it, which is what makes it a rail rather
          // than the wall of the stable it belongs to
          if (!clear(x + dx, z + dz, px, pz) || !clear(x - dx, z - dz, px, pz)
            || !clear(x - dx * 2, z - dz * 2, px, pz)) continue;
          out.push({ dx, dz, x, z, run: runUp(x, z, dx, dz, px, pz) });
        }
      }
      return out.sort((a, b) => b.run - a.run)[0] ?? null;
    }, [one.x, one.z, one.half, one.gx, one.gz, WIDE]);
    if (found && (!rail || found.run > rail.run)) { yard = one; rail = found; }
    if (rail && rail.run >= 4.5) break;
  }
  // a stride or two of clear ground behind the fence is all this needs — a hero is at his full pace
  // from the first frame, so a run-up is about having room to be measured in, not about winding up
  if (!rail || rail.run < 1.8) {
    say('and a rail one tile thick stops him as well', false,
      paddocks.length === 0 ? 'no village in this world keeps a paddock'
        : `no paddock in ${paddocks.length} villages has open ground to ride at`);
  } else {
    const back = Math.min(3.2, 0.35 + rail.run);
    await go(rail.x + rail.dx * back, rail.z + rail.dz * back);
    // and the same patience about passers-by: the animals a paddock is full of stand against its
    // rails, and one of them on the outside is a hero held off a fence he never reached
    await clearWay(rail.x + rail.dx * back, rail.z + rail.dz * back, rail.x, rail.z);
    // straight at the rail tile itself and out the far side. Aiming at the middle of the yard
    // instead would be a diagonal whenever the tile chosen is not the middle of its side, and a
    // diagonal rides at the rail beside the one that was measured.
    const stop = await shoveInto(rail.x - rail.dx * 5, rail.z - rail.dz * 5);
    // measured along the way he came, because that is the axis the rail lies across
    const held = Math.abs((stop.x - yard.x) * rail.dx + (stop.z - yard.z) * rail.dz);
    say('and a rail one tile thick stops him as well',
      stop.went > 0.8 && held > yard.half - 0.4 && held < yard.half + 1.6,
      `held ${held.toFixed(2)} tiles from the middle of ${yard.village}'s paddock, rails at ${yard.half}, over ${stop.frames} frames`);
  }

  /*
   * And down again, leaving the world as it was found.
   *
   * The last of these is the one that matters to every check after it rather than to horses. A hero
   * left in the saddle walks at a different pace, sits a saddle's height off the ground and owns an
   * animal he never paid for — and the horse is *saved*, so that outlives the run that did it.
   */
  await page.evaluate(() => window.__unride());
  const afoot = await settles(() => window.__mount(), (m) => !m.riding && m.pace === 1);
  const standing = await page.evaluate(() => !window.__solid(window.__player.x, window.__player.z) && window.__place() === 'surface');
  say('and getting down leaves him on his feet, with the horse put away',
    !afoot.riding && !afoot.owns && afoot.horse === null && afoot.pace === 1 && standing,
    `on foot at pace ${afoot.pace}, ${afoot.owns ? `still owning ${afoot.on}` : 'owning no horse'}, on ground he can stand on`);

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

    /*
     * Step off the doormat before asking to be let out.
     *
     * A doorstep re-arms by being stood off and by nothing else — `game/doorways.ts` argues the case
     * and the argument is right: a shop is a small room, and any rule with a distance in it leaves a
     * hero by the counter unable to get out. But walking into a shop leaves him standing exactly on
     * the threshold, so a script that presses forward from there is pressing at a latched door and
     * will go on doing it until it runs out of tries. Which it did, about one run in three, and
     * blamed the door. A player steps into the shop without noticing they have done it.
     *
     * Waited out by asking the door rather than by counting seconds. A door also rests for a few
     * seconds after it has been through, and those are the game's seconds: on a page holding three
     * frames a second, five on the wall is a second and a half of them.
     */
    await page.evaluate(() => {
      const r = window.__room(); const p = window.__player;
      if (r) window.__iso.rotation = Math.atan2(r.door[1] + 0.5 - p.z, r.door[0] + 0.5 - p.x);
    });
    for (let i = 0; i < 6; i++) {
      if (await page.evaluate(() => window.__room()?.armed ?? true)) break;
      await walk('w');
    }
    const latched = await settles(() => window.__room()?.armed ?? true, (ready) => ready === true);
    let out = first_in.place;
    let lastAt = await at();
    let veer = 0;
    for (let i = 0; i < 25 && out !== 'surface'; i++) {
      // Head through the doorway and out, rather than at it. Aimed at the door's own tile, a step
      // that carried him a hand's breadth past its middle turned him round to face it again, and he
      // paced back and forth across the threshold until the tries ran out. `entry` is the tile
      // inside the door, so the way out is the door and the same again beyond it.
      //
      // And when a step gets nowhere — a table, a barrel, the counter — try a heading either side
      // of it. A room has furniture in it and walking at a door in a straight line is not how
      // anybody crosses one.
      await page.evaluate((veer) => {
        const r = window.__room(); const p = window.__player;
        if (!r) return;
        const ox = r.door[0] - r.entry[0], oz = r.door[1] - r.entry[1];
        window.__iso.rotation = Math.atan2(r.door[1] + 0.5 + oz * 3 - p.z, r.door[0] + 0.5 + ox * 3 - p.x) + Math.PI + veer;
      }, veer);
      await walk('w');
      const now = await at();
      const moved = Math.hypot(now.x - lastAt.x, now.z - lastAt.z);
      veer = moved < 0.08 ? (veer === 0 ? 0.9 : -veer) : 0;
      lastAt = now;
      out = now.place;
    }
    say('and walking into it again takes you out', out === 'surface',
      out === 'surface' ? out : `${out}, with the doorstep ${latched ? 'unlatched' : 'still latched'}`);
  }

  await finish();
})().catch(async (e) => {
  // A crash halfway is a failed playtest, not a silent one. It is also the run whose account is
  // worth the most, so it gets written like any other, with the thing that threw as the last line
  // of it — and the server this started still has to be put away.
  say('the playtest ran to the end', false, (e && e.message) || String(e));
  await finish();
});
