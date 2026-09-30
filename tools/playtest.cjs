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
 *   PORT=5173  SEED=3                 the address, assembled
 *   ADDRESS=...                       or the whole address at once, if you want a different shape
 *   CHANNEL=chrome                    use system Chrome instead of installed Chromium
 *   DRIFT=0.35                        how far a creature may be drawn from where the world has it
 *   OUT=playtest-report.txt           where the account of the run is written
 *
 * Playwright is a development dependency. Install its matching browser once with
 * `pnpm browser:install`; browser binaries stay outside the repository and production image.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { chooseHouseApproach, chooseGroundedDoors } = require('./playtest-approach.cjs');
const playCart = require('./playtest-cart.cjs');

const PORT = process.env.PORT || '5173';
const SEED = process.env.SEED || '3';
const ADDRESS = process.env.ADDRESS || `http://localhost:${PORT}/?seed=${SEED}`;
// Empty means the Chromium binary installed for this project's pinned Playwright version.
const CHANNEL = process.env.CHANNEL ?? '';
// kept as a literal because this file is CommonJS and `src/core/reports.ts` is an ES module.
// The one place that decides this is that file; a second spelling of it here is the cost of the
// two module systems, and `reports.test.ts` fails if they ever disagree.
const REPORTS_DIR = 'docs/reports';
require('node:fs').mkdirSync(REPORTS_DIR, { recursive: true });
const OUT = process.env.OUT || require('node:path').join(REPORTS_DIR, 'playtest-report.txt');
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
const DRIFT_SAMPLES = 24;
const DRIFT_WINDOW_MS = 30000;

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
   * The page starts its own world in a worker. Vite answering says only that the page was served;
   * the worker still has to grow a country, admit the player, and send its welcome. On a busy CI
   * runner that can outlast a fixed sleep, leaving every later check to measure a world that has
   * not answered yet. Wait for the actual handshake and report that one failure if it never comes.
   */
  const ready = await page.waitForFunction(() => window.__world?.online === 'online', null,
    { timeout: 180000, polling: 250 }).then(() => true, () => false);
  if (!ready) {
    const world = await page.evaluate(() => window.__world ?? null).catch(() => null);
    say('the world in this tab answered', false, JSON.stringify(world));
    await finish();
    return;
  }
  /*
   * Welcome arrives before the worker finishes preparing the nearby country. At that point the
   * page says "online", but it has no wildlife to draw or measure yet. The creature check must
   * begin after a countable creature has arrived, not merely after the handshake.
   */
  const wildlifeReady = await page.waitForFunction(() => window.__creature?.() != null, null,
    { timeout: 60000, polling: 250 }).then(() => true, () => false);
  if (!wildlifeReady) {
    const seen = await page.evaluate(() => ({ wire: window.__wire, drift: window.__peekDrift }))
      .catch(() => null);
    say('the world sent a creature to measure', false, JSON.stringify(seen));
    await finish();
    return;
  }

  // The close tally only counts a creature when the world sends a second position for it. Find a
  // ground animal that actually moved between two readings, then stand close enough to measure it.
  // A recently reported but stationary villager can otherwise leave this check with no sample.
  const PREY = ['sheep', 'cow', 'goat', 'pig', 'chicken', 'boar', 'wolf', 'deer'];
  const seenPrey = () => page.evaluate((kinds) => window.__entitiesFull()
    .filter((e) => e.id !== null && kinds.includes(e.kind) && !e.dead)
    .map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z })), PREY);
  const tried = new Set();
  let beside = 'no moving animal found', driftReady = false;
  for (let tries = 0; tries < 3 && !driftReady; tries++) {
    const before = new Map((await seenPrey()).map((e) => [e.id, e]));
    await page.waitForTimeout(1200);
    const moving = (await seenPrey())
      .map((e) => ({ ...e, moved: Math.hypot(e.x - (before.get(e.id)?.x ?? e.x), e.z - (before.get(e.id)?.z ?? e.z)) }))
      .filter((e) => e.moved > 0.1 && !tried.has(e.id))
      .sort((a, b) => b.moved - a.moved)[0];
    if (!moving) { await page.waitForTimeout(2000); continue; }
    tried.add(moving.id);
    await page.evaluate(([x, z]) => window.__teleport(x, z), [moving.x + 1.2, moving.z + 1.2]);
    const atCreature = await page.evaluate(() => ({ x: window.__player.x, z: window.__player.z }));
    beside = `${moving.kind} ${Math.hypot(atCreature.x - moving.x, atCreature.z - moving.z).toFixed(1)} tiles away after moving ${moving.moved.toFixed(1)}`;
    // Let the server acknowledge the new position and discard corrections from the move itself.
    // The assertion is about steady nearby sync, not the one large correction caused by teleport.
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.__drift);
    // Stop after a fixed span of rendered play, rather than the first burst of updates. CI once
    // saw its first 12 corrections arrive around a goat's turn and averaged 0.38 against 0.35;
    // a second run of the same commit passed. A 30-second window samples both the turn and the
    // steady walk that follows it. Still require enough rendered corrections so quiet animals
    // cannot make an empty window look like perfect sync.
    await page.waitForTimeout(DRIFT_WINDOW_MS);
    driftReady = await page.evaluate((minimum) => window.__peekDrift.drawnClose.of >= minimum, DRIFT_SAMPLES);
  }
  const d = await page.evaluate(() => window.__drift);
  const driftTrace = await page.evaluate(() => window.__driftTrace());
  const largeCorrections = driftTrace.filter((entry) => entry.distance > DRIFT).slice(-8).map((entry) => {
    const previous = driftTrace.slice(0, driftTrace.indexOf(entry)).reverse().find((older) => older.id === entry.id);
    return {
      id: entry.id, kind: entry.kind, distance: +entry.distance.toFixed(2),
      interval: previous ? +(entry.at - previous.at).toFixed(2) : null,
      frames: previous ? entry.frame - previous.frame : null,
      drawn: entry.drawn, snapshot: entry.snapshot,
    };
  });

  const at = () => page.evaluate(() => ({ x: window.__player.x, z: window.__player.z, place: window.__place() }));
  const go = async (x, z, wait = 5000) => { await page.evaluate(([x, z]) => window.__teleport(x, z), [x, z]); await page.waitForTimeout(wait); };
  const walk = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(180); };
  const observedWalk = async (key, ms) => {
    await page.keyboard.down(key);
    const observedAfter = Math.min(180, Math.floor(ms / 2));
    await page.waitForTimeout(observedAfter);
    const during = await page.evaluate(() => {
      const p = window.__player;
      return { x: p.x, z: p.z, mode: p.mode, riding: p.riding,
        mounted: p.entity.mounted?.id ?? null, steered: p.steered !== null,
        solid: window.__solid(p.x, p.z), placed: p.placed,
        ground: p.ground.heightAt(p.x, p.z), place: window.__place() };
    });
    await page.waitForTimeout(ms - observedAfter);
    await page.keyboard.up(key);
    await page.waitForTimeout(180);
    return during;
  };
  const face = async (tx, tz) => { await page.evaluate(([tx, tz]) => { const p = window.__player; window.__iso.rotation = Math.atan2(tz - p.z, tx - p.x) + Math.PI; }, [tx, tz]); await page.waitForTimeout(150); };
  /**
   * Back out onto the grass, wherever the last check left him.
   *
   * `__teleport` refuses while the hero is indoors — *"you are inside The Bakker house in Blackby,
   * and there is no 46, 84 in here — climb out first"* — and it is right to: a hero moved bodily
   * out of a room he is standing in is exactly the class of bug the doorway checks exist for. So
   * the script leaves the way a player does, by walking through the door it came in by.
   *
   * It is here rather than at the end of whichever check wanders indoors because *any* of them
   * can: chasing a goat past an open door is enough. Asking once, before the one step that cannot
   * work indoors, costs a page evaluation and removes the whole family of failures.
   */
  const backOutside = async () => {
    for (let i = 0; i < 8 && (await at()).place !== 'surface'; i++) {
      // A room transition starts a game-time latch. On a software-rendered browser, five and a
      // half wall seconds need not contain five game seconds, so wait for the latch itself before
      // trying to leave. Otherwise each short walk can be ignored and the test reports a false
      // door failure.
      await page.waitForFunction(() => {
        const room = window.__room();
        return !room || room.resting <= 0;
      }, null, { timeout: 30000, polling: 100 }).catch(() => {});
      if ((await at()).place === 'surface') break;
      await walk('w', 260);
    }
    return (await at()).place === 'surface';
  };
  const enter = async () => {
    await backOutside();
    const candidates = await page.evaluate(chooseGroundedDoors);
    let doorway = null;
    // A record for a door can be known before its terrain patch is loaded. Only judge the door
    // after the player has actually settled on a grounded outside tile near that record.
    for (const candidate of candidates.slice(0, 6)) {
      await go(candidate.x, candidate.z, 0);
      const landed = await page.waitForFunction(({ x, z }) => {
        const p = window.__player;
        return p.placed && p.ground.heightAt(p.x, p.z) !== null &&
          Math.hypot(p.x - x, p.z - z) < 2;
      }, { x: candidate.x, z: candidate.z }, { timeout: 5000, polling: 100 }).then(() => true, () => false);
      if (landed) { doorway = candidate; break; }
    }
    if (!doorway) return { place: 'surface', restedOnArrival: 0,
      why: `no grounded doorstep after ${candidates.length} loaded candidates` };
    // A previous doorway may still be resting after backOutside has walked the hero out.
    // Wait for the game's own latch instead of counting wall-clock seconds on a slow renderer.
    let armed = await page.waitForFunction(() => window.__doorstep().ready, null,
      { timeout: 30000, polling: 100 }).then(() => true, () => false);
    // A slow page can arm on the timeout frame before Playwright polls it once more.
    if (!armed) armed = await page.evaluate(() => window.__doorstep().ready);
    if (!armed) return { place: 'surface', restedOnArrival: 0,
      why: `the outside doorstep did not arm: ${JSON.stringify(await page.evaluate(() => window.__doorstep()))}` };
    /* The outside doorstep faces the centre of its building, square through the door leaf. */
    const door = { x: doorway.bx + 0.5, z: doorway.bz + 0.5 };
    const from = await at();
    const doorstepAtStart = await page.evaluate(() => window.__doorstep());
    let place = from.place;
    let restedOnArrival = 0;
    let steps = 0;
    let firstPress = null;
    for (let i = 0; i < 14 && place === 'surface'; i++) {
      /*
       * Aimed again before every step, not once before the first.
       *
       * A hero who catches the frame of the door slides along the wall, and the walk carries on
       * along whatever line the camera was left on rather than along the line to the leaf. One
       * press of that is nothing; fourteen of them walk him down the side of the building and past
       * the corner, which is how this check failed intermittently on a seed it passes on.
       */
      await face(door.x, door.z);
      const pressed = await observedWalk('w', 220);
      if (i === 0) firstPress = pressed;
      steps = i + 1;
      place = (await at()).place;
      // read the rest at the moment we land, not after several more attempts to get in: five
      // seconds is a short time in a script that walks a step at a time
      if (place !== 'surface') restedOnArrival = await page.evaluate(() => window.__room()?.resting ?? 0);
    }
    /*
     * And where he actually finished, for the morning this fails again.
     *
     * "walking into a door takes you inside — surface" says the outcome and nothing about the
     * cause: it reads the same whether he never moved, walked past the door, or stood in the leaf
     * and bounced. Three different faults, one message. So the check carries the distance he
     * covered and how far he ended from the door he was aimed at.
     */
    const now = await at();
    const moved = Math.hypot(now.x - from.x, now.z - from.z);
    const short = Math.hypot(now.x - door.x, now.z - door.z);
    const crowd = place === 'surface' ? await page.evaluate((door) => window.__entitiesFull()
      .filter((e) => !e.dead && Math.hypot(e.x - door.x, e.z - door.z) < 4)
      .map((e) => ({ kind: e.kind, role: e.role, x: e.x, z: e.z })), door) : [];
    return { door, place, restedOnArrival,
      why: `${steps} steps, moved ${moved.toFixed(2)}, ${short.toFixed(2)} from the door; start ${JSON.stringify(from)}, candidate ${JSON.stringify(doorway)}, doorstep ${JSON.stringify(doorstepAtStart)} -> ${JSON.stringify(await page.evaluate(() => window.__doorstep()))}, crowd ${JSON.stringify(crowd)}, first press ${JSON.stringify(firstPress)}` };
  };
  // anything with hearts that is not a person and does not fly: something a swing can land on
  // slowest first: a hero can catch a sheep, and cannot catch a deer that has seen him
  // the same animal each time, by the number the world knows it by: "the nearest wolf" is two
  // different wolves either side of a swing, and a test that compares those is measuring nothing
  const quarryNow = (id) => page.evaluate((id) => {
    const p = window.__player;
    const e = window.__entitiesFull().find((c) => c.id === id && !c.dead);
    return e ? { kind: e.kind, x: e.x, z: e.z, hp: e.hp, d: Math.hypot(e.x - p.x, e.z - p.z) } : null;
  }, id);

  const w = await page.evaluate(() => window.__world);
  say('the running world is the endless country', w.world === 'endless' && w.online === 'online', JSON.stringify(w));

  // --- walking into things ---
  const nearbyHouses = await page.evaluate(() => {
    const p = window.__player;
    return window.__villages.flatMap((v) => v.houses.map((h) => ({
      x: h.tx + 0.5, z: h.tz + 0.5, rot: h.rot, name: v.name,
    }))).filter((h) => Math.hypot(h.x - p.x, h.z - p.z) < 60);
  });
  /*
   * One clear approach ray, used for both walks.
   *
   * The mounted run used to begin six tiles out while its control on foot began four tiles out.
   * That is not the same approach through a generated village: on seed 3 the extra two tiles held
   * other scenery, so Dusty stopped 4.53 tiles from the house and the check blamed its wall. The
   * wall had never held him there; the test had ridden him into something else.
   *
   * Keep the chosen side as a value so both walks use the same ray. The on-foot control starts four
   * tiles out; the mounted walk starts farther out to give the horse room to begin moving.
   */
  /* `page.evaluate` runs this same selection inside the game, using its live `__solid` probe. */
  // The first cottage can be boxed in by the village that grew around it. The collision question
  // needs an open ten-tile run-up, so search nearby houses before treating town scenery as a wall;
  // failing that, the nearest with a safe walk on foot. A house with neither is passed over rather
  // than walked at from a side already rejected for crossing its door (#523).
  let house = null, approach = null;
  for (const candidate of nearbyHouses) {
    const ray = await page.evaluate(chooseHouseApproach, candidate);
    if (!ray) continue;
    if (!approach) { house = candidate; approach = ray; }
    if (ray.fullRay) { house = candidate; approach = ray; break; }
  }
  if (!nearbyHouses.length) throw new Error('no nearby house to check collision against');
  // not the wall's fault, and not reported as the wall check: there was no clear walk to test it by
  if (!approach) throw new Error(`no house with a clear approach among ${nearbyHouses.length} nearby`);
  await go(approach.x, approach.z);
  let footFrom = await at();
  await face(house.x, house.z);
  const footPress = await observedWalk('w', 5000);
  let footTo = await at();
  let footMoved = Math.hypot(footTo.x - footFrom.x, footTo.z - footFrom.z);
  let retryPress = null;
  // An occasional first key press is lost while the page settles after teleport. It has not
  // tested the wall at all if the hero stayed four tiles away, so start that one attempt again.
  if (footMoved < 0.5 && footPress.placed && !footPress.solid) {
    await go(approach.x, approach.z);
    footFrom = await at();
    await face(house.x, house.z);
    retryPress = await observedWalk('w', 5000);
    footTo = await at();
    footMoved = Math.hypot(footTo.x - footFrom.x, footTo.z - footFrom.z);
  }
  const off = Math.hypot(footTo.x - house.x, footTo.z - house.z);
  // Indoors, x and z are the room's, so distances to the house outside mean nothing.
  const indoors = footTo.place !== 'surface' ? `went indoors to ${footTo.place}; ` : '';
  say('a house stops you at its wall', !indoors && footMoved > 0.5 && off > 1.1 && off < 3,
    `${indoors}closest ${off.toFixed(2)} tiles from its middle; moved ${footMoved.toFixed(2)}; first press ${JSON.stringify(footPress)}; retry ${JSON.stringify(retryPress)}`);
  if (indoors) await backOutside();

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
  /*
   * A nearby man at spawn need not move, and the world only sends changed creatures. The sample
   * above watched a ground animal move before standing beside it; this checks the corrections it
   * actually counted, rather than treating an empty tally as a perfect drawing.
   */
  // an empty tally and a good one are different failures, and the run has to say which: nothing
  // measured used to read exactly like a world drawing every creature perfectly
  const measured = driftReady && d.drawnClose.of > 0;
  say('creatures within reach are drawn where they are', measured && d.drawnClose.mean < DRIFT,
    measured
      ? `${d.drawnClose.of} rendered corrections in ${DRIFT_WINDOW_MS / 1000}s (${d.wrongClose.of} raw), mean ${d.drawnClose.mean.toFixed(2)}, worst ${d.drawnClose.worst.toFixed(2)} (${d.drawnClose.worstIs}), against ${DRIFT}; stood by ${beside}; large corrections ${JSON.stringify(largeCorrections)}`
      : `nothing was measured: ${d.drawn} creatures drawn, ${d.wrongClose.of} raw corrections, ${beside} — the ${DRIFT_WINDOW_MS / 1000}s window found fewer than ${DRIFT_SAMPLES} corrections with a rendered frame between snapshots`);

  // --- and the same wall, at a gallop ---
  /*
   * The mounted case, which is the one that made stepping over things visible in the first place
   * and which this script has never once played.
   *
   * A horse multiplies the hero's pace and carries its own longer collision body — so both the
   * length of the step and the body meeting the wall change. The collision bench walks that
   * arithmetic at a courser's pace already; this is the played half, at whatever frame rate this
   * machine actually manages, which is where the sweep is genuinely under load.
   *
   * `__ride` exists because mounting is only reachable through a stable's dialogue: a person does
   * that in ten seconds and a script cannot do it at all.
   */
  // Four tiles was enough for a person but left Dusty unable to move in the played check.
  // Start the larger mounted body ten tiles out on the same ray.
  const mountedApproach = {
    x: house.x + (approach.x - house.x) * 2.5,
    z: house.z + (approach.z - house.z) * 2.5,
  };
  await go(mountedApproach.x, mountedApproach.z);
  /*
   * Mount after `go`: the probe uses the game's teleport command, and teleporting correctly lets
   * go of a horse rather than carrying it across the country. Mounting first made this test walk
   * the wall on foot while an abandoned horse stood at the previous check, 8.79 tiles away.
   */
  const rode = await page.evaluate(() => window.__ride(true));
  await page.waitForTimeout(150);
  const carried = await page.evaluate(() => window.__mount());
  const under = carried?.under;
  say('the hero can get on a horse', rode && rode.riding === true && carried.horse !== null && typeof under === 'number' && under < 0.1,
    `${JSON.stringify(rode)}, horse ${typeof under === 'number' ? under.toFixed(2) : 'not'} tiles under rider`);
  const mountedFrom = await at();
  await face(house.x, house.z);
  const mountedPress = await observedWalk('w', 5000);
  const rider = await at();
  const horse = await page.evaluate(() => window.__mount());
  const galloped = Math.hypot(rider.x - house.x, rider.z - house.z);
  const ridden = Math.hypot(rider.x - mountedFrom.x, rider.z - mountedFrom.z);
  const outside = await page.evaluate(() => {
    const mount = window.__mount();
    return {
      rider: !window.__solid(mount.hero.x, mount.hero.z),
      horse: mount.horse !== null && !window.__solid(mount.horse.x, mount.horse.z),
    };
  });
  const crowdOnApproach = await page.evaluate(({ from, to }) => {
    const dx = to.x - from.x, dz = to.z - from.z, length2 = dx * dx + dz * dz;
    return window.__entitiesFull().filter((e) => !e.dead && e.role !== 'mount').map((e) => {
      const t = Math.max(0, Math.min(1, ((e.x - from.x) * dx + (e.z - from.z) * dz) / length2));
      return { kind: e.kind, role: e.role, x: Number(e.x.toFixed(1)), z: Number(e.z.toFixed(1)),
        ray: Number(Math.hypot(e.x - from.x - t * dx, e.z - from.z - t * dz).toFixed(1)) };
    }).filter((e) => e.ray < 2.2).sort((a, b) => a.ray - b.ray).slice(0, 5);
  }, { from: mountedFrom, to: house });
  const terrainOnApproach = await page.evaluate(({ from, to }) => {
    const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
    const along = dx / length, across = -dz / length;
    const samples = [];
    for (let distance = 9.5; distance >= 2.5; distance -= 0.5) {
      const blocked = [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2]
        .filter((side) => window.__solid(to.x - along * distance + across * side,
          to.z - dz / length * distance - along * side));
      if (blocked.length) samples.push({ distance: +distance.toFixed(1), blockedOffsets: blocked });
    }
    return samples;
  }, { from: mountedFrom, to: house });
  // The horse's long body reaches the wall before its centre does; its centre is several tiles
  // farther out than a person's, so use a bound that includes the horse's length.
  say('a house stops a horse at its wall too', approach.fullRay && ridden > 0.5 && galloped > 1.1 && galloped < 4.5 && outside.rider && outside.horse,
    `rode ${ridden.toFixed(2)} tiles from ${Math.hypot(mountedFrom.x - house.x, mountedFrom.z - house.z).toFixed(2)} out; full ray clear ${approach.fullRay}; first press ${JSON.stringify(mountedPress)}; closest ${galloped.toFixed(2)} tiles from its middle; rider outside ${outside.rider}, horse outside ${outside.horse}, separation ${horse.under}; crowd near ray ${JSON.stringify(crowdOnApproach)}; solid nearby ${JSON.stringify(terrainOnApproach)}`);
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
  let first = await page.evaluate((kinds) => {
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
  /*
   * Nothing loose to hit is a fact about where we are standing, not a failure of the fight.
   *
   * The village square of seed 3 in the polygon world had animals wandering across it; the road
   * world's has people, a well and a market. So if the country has offered nothing within forty
   * tiles with a clear line to it, one is put down — the same way `spawn` puts one down for
   * anybody at the console — and the check goes on measuring what it is named for, which is
   * whether a swing lands on the creature it was aimed at.
   */
  if (!first) {
    const put = await page.evaluate(() => window.__spawn('goat', 6));
    if (put) {
      await page.waitForTimeout(400);
      first = await page.evaluate(() => {
        const p = window.__player;
        const all = window.__entitiesFull().filter((e) => e.kind === 'goat' && !e.dead && e.hp > 0)
          .map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z, hp: e.hp, d: Math.hypot(e.x - p.x, e.z - p.z) }))
          .sort((a, b) => a.d - b.d);
        return all[0] ?? null;
      });
    }
  }
  if (!first) say('a blow lands on something', false, 'nothing to swing at, and none would be put down');
  else {
    await go(first.x + 2, first.z + 2, 4000);
    let quarry = first.id;
    await go(first.x + 2, first.z + 2, 4000);
    let landed = false, swings = 0, closest = 99, was = null;
    for (let i = 0; i < 45 && !landed; i++) {
      let near = await quarryNow(quarry);
      // Gone before any blow was thrown: it wandered out of the streamed ground or something else
      // killed it, and neither says anything about where a blow lands. Aim at the nearest other one.
      if (!near && was === null) {
        const next = await page.evaluate((kind) => {
          const p = window.__player;
          return window.__entitiesFull().filter((e) => e.kind === kind && !e.dead && e.hp > 0)
            .map((e) => ({ id: e.id, d: Math.hypot(e.x - p.x, e.z - p.z) }))
            .sort((a, b) => a.d - b.d)[0] ?? null;
        }, first.kind);
        if (next) { quarry = next.id; near = await quarryNow(quarry); }
      }
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
  say('walking into a door takes you inside', first_in.place !== 'surface',
    first_in.place === 'surface' ? `still outside — ${first_in.why}` : first_in.place);

  if (first_in.place !== 'surface') {
    say('and the door rests afterwards', first_in.restedOnArrival > 1, `${first_in.restedOnArrival}s left on arrival`);

    // --- furniture, while we are in here ---
    const furniture = await page.evaluate(() => {
      const r = window.__room();
      if (!r || r.furniture.length === 0) return null;
      let wide = 0;
      for (const f of r.furniture) {
        // A pew is 1.8 tiles wide. Probe beyond its tile's 0.5 edge and inside its 0.9 edge;
        // exactly 0.9 is the collision boundary and made a chapel look non-solid in CI.
        for (const [dx, dz] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
          if (r.solid(f.x + 0.5 + dx, f.z + 0.5 + dz)) { wide++; break; }
        }
      }
      return { pieces: r.furniture.length, wide };
    });
    say('furniture is solid where it is drawn, not only on its tile',
      furniture !== null && furniture.wide > 0, furniture ? `${furniture.wide} of ${furniture.pieces} reach past their own tile` : 'not indoors');

    // The door cooldown advances in game time, not wall time. Wait for the reported state so a
    // slow/headless browser does not begin the exit attempt while the door is still resting.
    await page.waitForFunction(() => {
      const room = window.__room();
      return !room || room.resting <= 0;
    }, null, { timeout: 30000, polling: 100 });
    let out = first_in.place;
    let lastAt = await at();
    const exitStart = lastAt;
    const doorState = () => page.evaluate(() => {
      const room = window.__room();
      return room && { door: room.door, atTheDoor: room.atTheDoor, armed: room.armed, resting: room.resting };
    });
    const exitBefore = await doorState();
    let veer = 0;
    let exitSteps = 0, travelled = 0;
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
      // Interior and outdoor coordinates are different spaces; the doorway transition itself is
      // not distance the player walked.
      const moved = now.place === lastAt.place ? Math.hypot(now.x - lastAt.x, now.z - lastAt.z) : 0;
      travelled += moved;
      exitSteps++;
      veer = moved < 0.08 ? (veer === 0 ? 0.9 : -veer) : 0;
      lastAt = now;
      out = now.place;
    }
    const exitEnd = await at();
    const exitAfter = await doorState();
    say('and walking into it again takes you out', out === 'surface', JSON.stringify({
      place: out, steps: exitSteps,
      start: { place: exitStart.place, x: +exitStart.x.toFixed(2), z: +exitStart.z.toFixed(2), door: exitBefore },
      end: { place: exitEnd.place, x: +exitEnd.x.toFixed(2), z: +exitEnd.z.toFixed(2), door: exitAfter },
      moved: exitEnd.place === exitStart.place
        ? +Math.hypot(exitEnd.x - exitStart.x, exitEnd.z - exitStart.z).toFixed(2)
        : null,
      travelled: +travelled.toFixed(2),
    }));
  }

  // Keep the village checks on their original ground; the hunt leaves the hero in high country.
  await playCart(page, say, go, face);
  await finish();
})().catch(async (e) => {
  // A crash halfway is a failed playtest, not a silent one. It is also the run whose account is
  // worth the most, so it gets written like any other, with the thing that threw as the last line
  // of it — and the server this started still has to be put away.
  say('the playtest ran to the end', false, (e && e.message) || String(e));
  await finish();
});
