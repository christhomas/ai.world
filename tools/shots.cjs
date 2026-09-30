/*
 * The pictures in the README, taken by a script so they can be taken again.
 *
 * Every shot in `docs/screenshots/` was taken by hand, in a browser somebody happened to have open,
 * at coordinates nobody wrote down. So they aged the way hand-taken pictures do: by September 11th
 * the newest was a week old and several showed a game that can no longer be played — hearts before
 * they were a bar, fields before the cattle stood in them, a roster with no column for what
 * everybody is doing. Nobody could tell which were stale without opening the game and comparing,
 * and nobody could retake one without rediscovering where it was taken from.
 *
 * This is that knowledge written down. Each shot names the world, the seed, where the camera goes
 * and what has to happen first, so retaking the lot is one command and retaking one is one word:
 *
 *   chore shots                 # all of them, into docs/screenshots/
 *   chore shots -- town night   # or only the ones named
 *   chore shots -- --list       # what there is to take
 *
 * And two overrides, for judging a country rather than photographing one:
 *
 *   WORLD=endless chore shots -- town   # the same shot in the other generator
 *   SEED=7 chore shots -- town          # or on another seed
 *
 * It uses the project's development Playwright install and starts a page server if nothing is
 * already answering, leaving one it did not start alone.
 *
 * A shot that cannot be set up says so and the run carries on: a sea that has no whales in it this
 * hour is not a reason to lose the other twenty pictures.
 */
const { chromium } = require('playwright');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || '5173';
/*
 * Which browser. Empty means the Chromium binary installed for this project's Playwright version.
 */
const CHANNEL = process.env.CHANNEL ?? '';

/**
 * How long anything here is allowed to take, in milliseconds.
 *
 * Playwright's own thirty seconds, and a minute for a world to raise itself, are right for the
 * machine this was written on and are not a property of the game. On a small ARM box with no GPU —
 * where chromium falls back to a software rasteriser — a dev-mode page takes half a minute to load
 * and a world a good two more to become driveable, and every one of those numbers is exceeded
 * before anything has gone wrong. The run then fails with a timeout that reads like a broken game.
 *
 * So the budget is one number and it can be raised: `PATIENCE=500000 chore shots mountain`. The
 * default is what it always was, so nothing changes for anybody already able to run this.
 *
 * And it is read rather than merely converted. `Number()` takes any word at all: `PATIENCE=oops`
 * is `NaN`, and `Math.max(60000, NaN)` is `NaN` rather than 60000 — so the guard that exists to
 * stop this ever making a wait *shorter* would hand playwright a timeout that is not a number. A
 * negative or infinite one gets past a truthy check and reaches `setDefaultTimeout` on its own.
 * None of those is a timeout playwright has a contract for, and the way it fails is the worst kind:
 * a mistyped flag comes back as a browser error about timeouts, which reads as the game being
 * broken rather than as the flag being wrong. So it says so, and stops.
 */
const PATIENCE = patienceFrom(process.env.PATIENCE);

/** How long to allow, read from the environment: nought for "as it always was", or a real wait. */
function patienceFrom(asked) {
  if (asked === undefined || asked === '') return 0;
  const ms = Number(asked);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`PATIENCE is milliseconds to wait, and "${asked}" is not — try PATIENCE=500000`);
  }
  return ms;
}
const OUT = process.env.OUT || 'docs/screenshots';
/*
 * Which way to draw, so the same seed and the same camera can be shot both ways and the judgement
 * is two pictures rather than a memory. `chore compare` reads them.
 *
 *   RIG=composer chore shots -- town      the second path (#250)
 *   RIG=classic  chore shots -- town      straight to the canvas
 *   (unset)                               whatever this browser profile remembers
 *
 * Set into localStorage before the page loads, because the rig is built from the answer at boot and
 * a switch flipped afterwards changes nothing until the next world.
 */
const RIG = process.env.RIG || '';
const COUNTS_OUT = process.env.FALLBACK_COUNTS || '';
const sweep = { visits: [], defaults: [] };

/** Add one page's module-global counters before that page is closed. */
const collectSweep = async (page) => {
  if (!COUNTS_OUT) return;
  const counts = await page.evaluate(() => globalThis.__sweep ?? null).catch(() => null);
  if (!counts) return;
  for (const key of ['visits', 'defaults']) {
    for (let i = 0; i < counts[key].length; i++) sweep[key][i] = (sweep[key][i] || 0) + (counts[key][i] || 0);
  }
};
const writeSweep = () => { if (COUNTS_OUT) fs.writeFileSync(COUNTS_OUT, JSON.stringify(sweep)); };
const origin = `http://localhost:${PORT}`;
/** The shape of the pictures in the README: wide enough to show a street, short enough to scroll past. */
const VIEW = { width: 1440, height: 900 };
/** Hide transient capture clutter without changing the running page or the rest of its HUD. */
const CLEAN_FRAME = '#areaName, #toast, #debug, #buildLine { visibility: hidden !important; }';
/** A phone held upright, for the one shot that is about the touch controls. */
/*
 * A phone, at the size the design is drawn at.
 *
 * 844x390 and landscape, which is what `design/mobile/README.md` states as its reference viewport:
 * "a landscape phone with the browser chrome gone". It was 420x900 — portrait — so the single phone
 * picture this repository had was of a shape nobody had designed, and every judgement made from it
 * was about a layout that does not exist on paper.
 *
 * `PHONE_TALL` is kept because a phone held upright is a real thing a player will do, and a layout
 * that collapses when they turn it is worth seeing. It is not what the design describes.
 */
const PHONE = { width: 844, height: 390 };
const PHONE_TALL = { width: 420, height: 900 };
const CAPTURE_DATE = new Date('2026-01-01T12:00:00Z');
const FRAME_MS = 100;

/**
 * The page's game loop and title animation both use animation frames. Intercept them before any
 * module is loaded, so a slow renderer cannot decide how many world steps happen before a photo.
 * Worker and network replies may arrive between explicit steps, never during one.
 */
async function captureClock(page) {
  await page.clock.setFixedTime(CAPTURE_DATE);
  await page.addInitScript(() => {
    const realRaf = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    const realNow = performance.now.bind(performance);
    let now = 0, next = 1;
    let pending = new Map();
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
    window.requestAnimationFrame = (callback) => {
      const id = next++;
      pending.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => { pending.delete(id); };
    window.__shotClock = {
      newsReady: false,
      step(frames) {
        for (let frame = 0; frame < frames; frame++) {
          now += 100;
          const due = pending;
          pending = new Map();
          for (const callback of due.values()) callback(now);
        }
      },
      /** Screenshot's own stability check uses rAF; the game callback stays in `pending`. */
      release() {
        window.requestAnimationFrame = realRaf;
        window.cancelAnimationFrame = realCancel;
        Object.defineProperty(performance, 'now', { configurable: true, value: realNow });
      },
    };
  });
}

/** A fixed number of game frames, with real time left free for chunk and world workers. */
// Setup pauses are mostly for asynchronous ground and server replies, not world simulation.
// Thirty frames give the camera and HUD time to settle without running an extra minute of combat
// merely because the browser was slow to mesh a chunk.
const framesFor = (ms) => Math.min(30, Math.max(1, Math.ceil(ms / FRAME_MS)));
async function advance(page, ms) {
  await page.evaluate((frames) => window.__shotClock.step(frames), framesFor(ms));
  if (page.url().includes('server=')) {
    const response = await fetch(`http://localhost:${WORLD_PORT}/__shots/step?count=1`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (!response.ok) throw new Error(`screenshot world tick failed: ${response.status}`);
  } else {
    await page.evaluate(() => window.__shotClock.worldStep?.(1));
  }
}


/** The page may render its next frame only after all requested ground has arrived and been meshed. */
async function settleCountry(page) {
  try {
    await page.waitForFunction(() => {
      const state = window.__shotChunks?.();
      return state && state.loaded >= Math.min(60, state.desired)
        && state.pending === 0 && state.grown === 0;
    }, null, { timeout: Number(process.env.SHOT_SETTLE_TIMEOUT || Math.max(120_000, PATIENCE)), polling: 100 });
  } catch (error) {
    const state = await page.evaluate(() => ({ chunks: window.__shotChunks?.(),
      world: window.__world, stream: window.__stream,
      details: (() => { const one = window.__grownDetails?.(); return one && {
        counted: one.counted, idle: one.idle, paused: one.paused, loaded: one.loaded.slice(0, 5),
      }; })() }));
    throw new Error(`country did not settle: ${JSON.stringify(state)}; ${error.message}`);
  }
  // The first daily news must read the complete register, not whichever village happened to stream
  // before the renderer's first frame. Open that gate and draw at one fixed step.
  await page.evaluate(() => { window.__shotClock.newsReady = true; window.__shotClock.step(1); });
}

/** Hold the photographed frame's light and HUD while the simulation finishes drawing. */
const lockSceneClock = (page, time) => page.evaluate((at) => {
  const state = window.__state;
  const day = state.day;
  Object.defineProperties(state, {
    day: { configurable: true, get: () => day, set: () => {} },
    time: { configurable: true, get: () => at, set: () => {} },
  });
  state.tick = () => {};
}, time);

/** Midday, dusk, and the dead of night, as the fraction of a day the `time` command wants. */
const NOON = 0.5, DUSK = 0.78, NIGHT = 0.02;
/*
 * Which day of the world each season falls on.
 *
 * A season is `SEASON_LENGTH` days — seven — and the year starts in spring, so days 1-7 are spring,
 * 8-14 summer, 15-21 autumn and 22-28 winter, and then round again. Worth spelling out because the
 * first pair of numbers here were 200 and 290, which look like late in a long year and are in fact
 * both spring and summer: `seasonOf` counts weeks, not months. The autumn shot came out green.
 */
const AUTUMN = 17, WINTER = 24;

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const listing = process.argv.includes('--list');

/**
 * The page server, if nobody else is already running one.
 *
 * Lifted from `playtest.cjs`, including the detached process group: killing only the `pnpm` that
 * spawned vite leaves vite holding the port, and the next run then dies at `--strictPort` in a way
 * that looks nothing like "the last run did not clean up after itself".
 */
let ours = null;
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
  if (await answering()) {
    if (COUNTS_OUT) throw new Error(`fallback sweep needs an unused PORT, but ${origin} already answers`);
    console.log(`taking them against the server already on ${origin}`);
    return;
  }
  console.log(`nothing on ${origin} — starting one`);
  ours = spawn('pnpm', ['vite', '--port', PORT, '--strictPort'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await answering()) return;
  }
  throw new Error(`no page server answered on ${origin} after a minute`);
};
process.on('exit', stopServing);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopServing(); process.exit(130); });

/**
 * The verbs a shot is set up with.
 *
 * All of them go through the probes the game already has, which is the point: a picture taken by
 * driving the console is a picture of the game somebody can play, and the day a probe stops working
 * the pictures stop being taken rather than quietly going stale.
 */
const verbs = (page) => ({
  /** Everything the page can be asked, for the odd shot that wants something of its own. */
  ask: (fn, arg) => page.evaluate(fn, arg),
  /** Put the hero somewhere. */
  stand: async (x, z, settle = 4000) => {
    await page.evaluate(([x, z]) => window.__teleport(x, z), [x, z]);
    await advance(page, settle);
  },
  /** Point the camera at something, from wherever the hero is standing. */
  face: async (x, z) => {
    await page.evaluate(([x, z]) => {
      const p = window.__player;
      window.__iso.rotation = Math.atan2(z - p.z, x - p.x) + Math.PI;
    }, [x, z]);
    await advance(page, 400);
  },
  /** How far back to stand, in the camera's own units. */
  zoom: async (n) => { await page.evaluate((n) => window.__zoom(n), n); await advance(page, 400); },
  time: async (f) => { await page.evaluate((f) => window.cmd(`time ${f}`), f); await advance(page, 600); },
  day: async (d) => { await page.evaluate((d) => window.cmd(`day ${d}`), d); await advance(page, 1200); },
  key: async (k, hold = 0) => {
    if (!hold) { await page.keyboard.press(k); }
    else { await page.keyboard.down(k); await advance(page, hold); await page.keyboard.up(k); }
    await advance(page, 600);
  },
  wait: (ms) => advance(page, ms),
  /**
   * The nearest village to the middle of the world, and the hero stood in the middle of it.
   *
   * Sorted rather than taken off the front, which is what this said it did and did not do.
   * `__villages` is the order the generator built them in: in the road tree that is the hub first,
   * on the crossroads the country grew outward from, so the first and the nearest are the same
   * place and the difference never showed. The endless country has no hub and founds its villages
   * from the patch's own list — so seed 5's first is Blackreach at 37,406 while Hartcross stands at
   * 119,90, and the shot walked past the near village to photograph one four hundred tiles out.
   *
   * A picture taken off a list order is a picture that moves when the order does, which is the one
   * thing a reference picture cannot do. Seed 3, which #299's pictures are taken on, is unmoved:
   * Blackby is both the first and the nearest.
   */
  village: async (n = 0) => {
    const v = await page.evaluate((n) => {
      const byDistanceFromTheMiddle = (a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z);
      return [...window.__villages].sort(byDistanceFromTheMiddle)[n];
    }, n);
    await page.evaluate(([x, z]) => window.__teleport(x, z), [v.x, v.z]);
    // long enough for the village to fill: the people are streamed in like everything else, and a
    // picture taken the moment the hero lands is a picture of an empty square
    await advance(page, 9000);
    return v;
  },
  /** Whatever is alive nearby, as the world has it rather than as it is drawn. */
  alive: () => page.evaluate(() => window.__entitiesFull()),
});

/**
 * What each picture needs, in the words of the game rather than in coordinates.
 *
 * `setup` may return `null` to say "not today" — a seed that raised no shop, a sea with no whales in
 * it this hour — and the run carries on without that one. Anything else it returns is printed
 * beside the shot, so a run says what it actually photographed.
 */
const SHOTS = [
  {
    name: 'town', title: 'The crossroads at midday',
    cleanFrame: true,
    setup: async (p, { village, time, zoom }) => {
      const v = await village();
      await time(NOON);
      await zoom(24);
      return v.name;
    },
  },
  {
    name: 'night', title: 'The same square after dark',
    setup: async (p, { village, time, zoom }) => {
      const v = await village();
      await time(NIGHT);
      await zoom(24);
      return v.name;
    },
  },
  {
    name: 'autumn', title: 'Autumn',
    setup: async (p, { village, day, time, zoom }) => {
      await day(AUTUMN); await time(NOON);
      await village();
      await zoom(22);
      return `day ${AUTUMN}`;
    },
  },
  {
    name: 'winter', title: 'Winter',
    setup: async (p, { village, day, time, zoom }) => {
      await day(WINTER); await time(NOON);
      await village();
      await zoom(22);
      return `day ${WINTER}`;
    },
  },
  {
    name: 'cattle', title: 'A farmer and his herd, out in the field', settle: 2500,
    setup: async (p, { village, time, zoom, stand, face, ask }) => {
      /*
       * The beasts a village lives off, and whoever is out with them.
       *
       * Both are the world's own, so this photographs the livelihood rather than a cow put there
       * for the picture — and it looks for a beast that has somebody standing near it, because a
       * field of cattle with no farmer in it is the fault this shot exists to show is fixed.
      */
      await time(NOON);
      const v = await village();
      await zoom(9);
      const spot = await ask(() => {
        const all = window.__entitiesFull().filter((e) => !e.dead);
        const beasts = all.filter((e) => ['cow', 'bull', 'sheep', 'goat'].includes(e.kind));
        const people = all.filter((e) => e.kind === 'villager' || e.person);
        let best = null;
        for (const beast of beasts) {
          const near = people.filter((q) => Math.hypot(q.x - beast.x, q.z - beast.z) < 14).length;
          if (!best || near > best.near) best = { x: beast.x, z: beast.z, kind: beast.kind, near };
        }
        return best;
      });
      if (!spot) return null;
      // The documented road/seed-3 frame looks into the hub's paddock from one fixed tile.
      // Following whichever cow happens to be closest shifts the entire camera by several tiles
      // between runs, making every building and patch of ground a false visual diff. Keep the
      // exploratory seed/world overrides useful by following their herd as before.
      if ((process.env.WORLD || 'road') === 'road' && Number(process.env.SEED || 3) === 3) {
        await stand(v.x + 18, v.z - 2, 2500);
        await face(v.x + 15.5, v.z - 4.5);
      } else {
        await stand(spot.x + 2.5, spot.z + 2.5, 2500);
        await face(spot.x, spot.z);
      }
      return `${spot.kind}, ${spot.near} people about`;
    },
  },
  {
    /*
     * The mountain, from its own foot.
     *
     * #307 asked for this by name — *"`tools/` has no mountain shot and should get one, since every
     * argument about this is an argument about how it looks"* — and it is right that it should: the
     * whole of that item is four claims about a picture (it is too dark, its facets have no
     * contrast, there is no snow on it, it meets the ground at a seam) and none of them can be
     * settled by reading a constant.
     *
     * Stood at the foot and looking up, rather than on top of it. All four complaints are about the
     * flank and the line where the rock meets the country, and from the summit there is no country
     * in the picture to compare it against.
     *
     * The massif is found rather than named: a shot with coordinates in it would photograph a
     * hillside on the next seed, and `__sampler` carries whichever kind of high ground this world
     * grew — `ranges.peaks` for the endless country, `massifs` for a world that plans them.
     *
     * Two things this turned up on the day it was written, both worth knowing before anybody argues
     * about the numbers in `render/mountains.ts`:
     *
     * The **road world has no mountains at all**. `sampler.ranges` is null and `sampler.massifs` is
     * empty, so `highPlaces` in `country.ts` is empty and there is nothing to photograph. This shot
     * returns null there, which is the supported "not today" — but it means every picture in #307
     * is a picture of the endless country whether or not it says so.
     *
     * And the framing was wrong in a way that hid what it was pointed at. `away` and the zoom were
     * the two numbers to move, the note said, and both of them had to: see `away` below. With them
     * moved, seed 3's Stonecrown Highlands photographs as a massif rather than as an empty hillside,
     * which is what settled the shape half of #307.
     */
    /*
     * And the endless country, because the road tree has no mountains to photograph.
     *
     * Every shot here defaults to `world: 'road'`, and this one inherited that and could therefore
     * never fire: a road-tree world is not `shaped`, so its high ground is `massifs` — and
     * `planMassifs` puts none on seed 3. `ranges` is null there by construction. So the search
     * below found nothing, said "nothing to photograph in this world today", and went on saying it
     * for as long as the shot has existed. There has never been a `mountain.png`.
     *
     * The massif #307 is about is the polygon country's, which is where `ranges.peaks` comes from
     * and where Stonecrown Highlands stands. That is the world this has to be taken in.
     */
    name: 'mountain', title: 'The rock, from the country at its foot', world: 'endless', settle: 3500,
    setup: async (p, { time, zoom, stand, face, ask }) => {
      await time(NOON);
      const peak = await ask(() => {
        const sampler = window.__sampler;
        const ranges = sampler?.ranges;
        const highs = ranges
          ? ranges.peaks.map((one) => ({ x: one.x, z: one.z, height: one.lift }))
          : (sampler?.massifs ?? []).map((one) => ({ x: one.x, z: one.z, height: one.height }));
        // the tallest within a walk of the middle: the tallest anywhere may be a patch away in the
        // endless country, and a shot of country that has to be grown first is a shot of fog
        const near = highs.filter((one) => Math.hypot(one.x, one.z) < 900);
        return near.sort((a, b) => b.height - a.height)[0] ?? null;
      });
      if (!peak) return null;                    // a seed with no mountain near the middle: not today
      /*
       * Forty-five tiles off, on whichever side of it is dry.
       *
       * Far enough out to be standing on ordinary country — the seam where rock meets ground is
       * half of what this photographs — and close enough that the rock fills the frame rather than
       * sitting on the horizon. The side is looked for rather than chosen: the first version walked
       * back along the line to the origin and put the hero in the sea, because a peak nearer the
       * middle than the standing distance is a peak you walk *past* doing that.
       *
       * It was seventy, with a twenty-six unit frustum, and that pair could not photograph a
       * mountain — which is why the previous attempt at #307 parked: *"neither has the massif in
       * frame, which is the blocker"*. The arithmetic says why rather than the eye. The camera is
       * fixed at forty-five degrees, so a point `d` tiles in front of the hero standing `h` units
       * up sits about `0.7·(d + h)` world units above the middle of the picture, and the picture is
       * only `zoom` units tall. Seventy tiles and a twenty-one unit peak is sixty-four units above
       * the middle against a half-frame of thirteen: the massif was five frames off the top.
       *
       * So both numbers moved, and a shot of a mountain is a wide shot whether or not one wanted it
       * to be: forty-five tiles out at ninety-six units tall puts `0.7·66 = 46` against a half-frame
       * of forty-eight, which is the summit near the top edge and the flank and its foot below it.
       * There is room in that for a taller peak than the game has, which is deliberate — #391 has
       * to be answered before `RANGE.TALLEST` can move, and this should not need retuning when it
       * does.
       */
      const away = 45;
      const sides = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [0, 1], [-1, 0], [0, -1]];
      const spot = await ask(([peak, away, sides]) => {
        for (const [dx, dz] of sides) {
          const len = Math.hypot(dx, dz) || 1;
          const x = peak.x + (dx / len) * away, z = peak.z + (dz / len) * away;
          if (window.__solid && window.__solid(x, z)) return { x, z };
        }
        return null;
      }, [peak, away, sides]);
      if (!spot) return null;                    // a mountain standing in the sea: not this one
      await stand(spot.x, spot.z, 6000);
      // An endless-world teleport can still have its new patch and visible chunks in flight.
      // A picture with a blue floor and zero drawn chunks is a picture of loading, not a mountain.
      await settleCountry(p);
      // a mountain will not fit in the zoom a village is photographed at; see `away` above
      await zoom(96);
      await face(peak.x, peak.z);
      return `${away} tiles from a peak ${Math.round(Math.hypot(peak.x, peak.z))} out`;
    },
  },
  {
    name: 'health', title: 'What is left of a wolf, and of you', settle: 2000,
    setup: async (p, { village, time, zoom, ask, key, stand, face, wait }) => {
      /*
       * Health is a bar and a number now, on the hero and over whatever he is fighting.
       *
       * Both halves have to be in the picture for it to say anything, so the hero takes a bite
       * before the shot: a hero at a hundred out of a hundred is a bar with nothing to show.
       */
      await time(NOON);
      await village();
      await zoom(8);
      const wolf = await ask(() => window.__spawn('wolf', 3));
      if (!wolf) return null;
      // the hero's own bar, which `__hurt` cannot touch: that probe bites whatever is nearest and
      // the hero is never his own nearest creature. A hero at a hundred out of a hundred is a bar
      // with nothing to say, so he is marked before the picture rather than after it
      await ask(() => { const st = window.__state; st.hp = Math.round(st.maxHpTotal * 0.62); st.version++; });
      const at = await ask(() => {
        const w = window.__entitiesFull().find((e) => e.kind === 'wolf' && !e.dead);
        return w ? { x: w.x, z: w.z } : null;
      });
      if (!at) return null;
      await stand(at.x + 2, at.z + 2, 1500);
      await face(at.x, at.z);
      await wait(400);
      await key('x');
      // he moves when he is hit, and a wolf behind the camera is not in the picture
      await ask(() => {
        const w = window.__entitiesFull().find((e) => e.kind === 'wolf' && !e.dead);
        const p = window.__player;
        if (w) window.__iso.rotation = Math.atan2(w.z - p.z, w.x - p.x) + Math.PI;
      });
      return `wolf at ${Math.round(at.x)},${Math.round(at.z)}`;
    },
  },
  {
    name: 'farming', title: 'A field of wheat, four days on', settle: 3000,
    setup: async (p, { village, day, time, zoom, ask, stand, face }) => {
      await time(NOON);
      const v = await village();
      // a patch of open ground beside the village, sown by hand and then left for four days, which
      // is what wheat wants
      const sown = await ask(([x, z]) => {
        const w = window.__player.ground;
        const tiles = [];
        for (let dx = 0; dx < 7 && tiles.length < 40; dx++) {
          for (let dz = 0; dz < 7 && tiles.length < 40; dz++) {
            const tx = Math.floor(x) + 8 + dx, tz = Math.floor(z) + 8 + dz;
            if (w.heightAt(tx, tz) === null || w.blocked(tx, tz)) continue;
            window.__sow(tx, tz);
            tiles.push([tx, tz]);
          }
        }
        return tiles;
      }, [v.x, v.z]);
      if (!sown.length) return null;
      const mid = sown[Math.floor(sown.length / 2)];
      await day(4);
      // standing in it rather than across the field from it: the camera follows the hero, so a
      // crop photographed from six tiles away is a crop along the top edge of the picture
      await stand(mid[0] + 1, mid[1] + 1, 3000);
      await face(mid[0], mid[1]);
      await zoom(11);
      return `${sown.length} tiles of wheat`;
    },
  },
  {
    name: 'horse', title: 'Riding out of the square', settle: 1200,
    setup: async (p, { village, time, zoom, ask, wait }) => {
      await time(NOON);
      const v = await village();
      const on = await ask(() => window.__ride(true));
      if (!on || !on.riding) return null;
      await zoom(12);
      /*
       * Photographed mid-canter, and walked there rather than teleported.
       *
       * `__walkTo` is the probe the hero's autopilot was built for, and this is the first picture
       * taken with it: the horse is worth showing at a gait, and a hero set down by a teleport is a
       * hero standing still in a market square with a horse somewhere under him.
       */
      await ask(([x, z]) => window.__walkTo(x, z), [v.x + 26, v.z + 4]);
      await wait(2600);
      return on.breed;
    },
  },
  {
    name: 'interior', title: 'Inside the general store',
    setup: async (p, { village, time, ask, wait }) => {
      await time(NOON);
      await village();
      const room = await ask(() => window.__enterShop('store'));
      if (!room) return null;
      await wait(3000);
      return room;
    },
  },
  {
    name: 'dungeon', title: 'A dungeon floor',
    setup: async (p, { ask, wait }) => {
      const shrine = await ask(() => window.__enterShrine());
      await wait(3000);
      const down = await ask(() => window.__descend());
      await wait(4000);
      const floor = await ask(() => window.__floor());
      if (!floor) return null;
      return `floor ${floor.depth ?? ''}`.trim();
    },
  },
  {
    name: 'rucksack', title: 'The rucksack',
    setup: async (p, { village, time, key }) => {
      await time(NOON);
      await village();
      await key('i');
      return 'open';
    },
  },
  {
    name: 'map', title: 'The full-screen map',
    setup: async (p, { village, time, key, wait, ask }) => {
      await time(NOON);
      await village();
      // The revealed-cell fog depends on which tile the hero crossed while the browser booted.
      // Equip the real Grand Survey so this reference judges the road map itself, whose pixels
      // are stable, instead of a race-dependent exploration mask around the player.
      await ask(() => { window.__state.give('map'); window.__state.equip('map'); });
      await key('m');
      await wait(1500);
      return 'open with the Grand Survey';
    },
  },
  {
    name: 'estate', title: 'A house of your own, and what you add to it', settle: 3500,
    setup: async (p, { village, time, zoom, stand, ask }) => {
      /*
       * Everything a builder will put up, standing together.
       *
       * Built through `__build`, which pays for each of them and back-dates it past its own number
       * of days — a picture of a week of waiting is a picture of pegs and string. What is being
       * photographed is the catalogue: a house, another floor on it, and the two things that go in
       * a yard rather than on a piece of ground.
       */
      await time(NOON);
      const v = await village();
      await stand(v.x + 18, v.z + 18, 5000);
      const built = await ask(() => {
        const hero = window.__player;
        const x = Math.floor(hero.x) + 0.5, z = Math.floor(hero.z) + 0.5;
        const house = window.__build(x, z, 'house');
        if (!house) return null;
        window.__build(x, z, 'storey', house.id);
        window.__build(x + 3.4, z, 'pool', house.id);
        window.__build(x, z + 3.4, 'fountain', house.id);
        return { x, z };
      });
      if (!built) return null;
      // stood in the yard rather than across the field: the camera follows the hero, so this is
      // what puts the house, the pool and the fountain in one picture
      await stand(built.x + 2, built.z + 2, 3000);
      await zoom(11);
      return 'house, storey, pool, fountain';
    },
  },
  {
    name: 'domesday', title: 'The Domesday Book', server: true,
    page: '/tools/registry.html?at=WORLD&seed=3',
    setup: async (p, { wait }) => {
      // the token is typed rather than put in the address, exactly as a person would: the page
      // deliberately never remembers one, because a tool that quietly keeps a password leaks it
      await p.fill('#token', TOKEN);
      // Enter lists the server's worlds, selects the addressed seed, then opens its book. The
      // button alone asks for whichever world is already chosen, and none is before that list.
      await p.press('#token', 'Enter');
      await p.waitForSelector('#out table', { timeout: 30000 });
      await wait(1500);
      return p.$eval('#note', (el) => el.textContent.trim());
    },
  },
  /*
   * The phone, which is a different product and was photographed once.
   *
   * There was one picture here — the square, at noon, with the touch controls up — and every other
   * screen of this game on a phone had never been looked at as an image at all. A panel that reads
   * well at 900 by 600 can be unusable at 420 wide: the rucksack is a grid, the map is full-screen,
   * a conversation is a box with a face in it, and all three are laid out against a width this
   * viewport does not have.
   *
   * So: the same screens, at phone size, named so `chore compare` can put two runs beside each
   * other. That is the difference between "it looks wrong on my phone" and a picture somebody can
   * point at.
   */
  {
    name: 'phone', title: 'The game on a phone', viewport: PHONE, touch: true,
    setup: async (p, { village, time, zoom }) => {
      await time(NOON);
      await village();
      await zoom(13);
      return 'touch controls';
    },
  },
  {
    name: 'phone-title', title: 'The title screen on a phone', viewport: PHONE, touch: true,
    page: '/', cleanFrame: true,
    /*
     * The title is up only once its slots are, and the land behind it only moves once it is up.
     *
     * `load` is not the title: `showTitle` reads the three saves out of IndexedDB first, and only
     * then starts the painted sky and fills the slots, in one synchronous breath. The sky paints
     * from animation frames, which the capture clock hands out only when it steps — so stepping
     * before the title had asked for its first one stepped nothing, and the picture was of a canvas
     * nobody had painted, with the HUD showing through it. Stepping after it painted the land.
     * Which of the two a run got was IndexedDB against a round trip to the browser, and it went
     * both ways on one commit (run 36601636894). Waiting for the slots means the sky's first frame
     * is pending before the first step, every time, and the picture is always the painted one.
     */
    setup: async (p) => {
      await p.waitForFunction(() => document.querySelector('#slots button[data-act]') !== null, null,
        { timeout: Math.max(60000, PATIENCE), polling: 100 });
      return 'the three slots, before a world is opened';
    },
  },
  {
    // the same square held upright, which is not the designed shape and is the shape a player will
    // sometimes be in. Worth a picture precisely because nothing has ever been laid out for it
    name: 'phone-upright', title: 'The square with the phone held upright', viewport: PHONE_TALL, touch: true,
    setup: async (p, { village, time, zoom }) => {
      await time(NOON);
      await village();
      await zoom(13);
      return 'portrait, which the design does not describe';
    },
  },
  {
    name: 'phone-rucksack', title: 'The rucksack on a phone', viewport: PHONE, touch: true,
    setup: async (p, { village, time, key }) => {
      await time(NOON);
      await village();
      await key('i');
      return 'open';
    },
  },
  {
    name: 'phone-map', title: 'The full-screen map on a phone', viewport: PHONE, touch: true,
    setup: async (p, { village, time, key, wait }) => {
      await time(NOON);
      await village();
      await key('m');
      await wait(400);
      return 'open';
    },
  },
  {
    name: 'phone-night', title: 'A phone after dark, when the HUD has to carry itself', viewport: PHONE, touch: true,
    setup: async (p, { village, time, zoom }) => {
      await time(NIGHT);
      await village();
      await zoom(13);
      return 'touch controls, after dark';
    },
  },
  {
    /*
     * The one picture that has to be *earned* rather than arranged.
     *
     * Everything else here can be photographed by standing somewhere, but a boat has to be bought
     * from the boatwright who stands at the end of a jetty, and then cast off, and then rowed far
     * enough out that there is water in the frame rather than decking. So the setup presses the
     * same three keys a player presses, in the same order, and the picture fails if any of them
     * stops working — which is the whole reason the shots go through the game rather than round it.
     *
     * The coin is handed over rather than earned, and that is the one shortcut. A hull is 220 gold
     * and a hero starts with fifty; hunting up the difference would make this a twenty-minute shot
     * of the fur trade rather than a picture of the sea.
     */
    name: 'sea', title: 'Your own boat, out on the water', settle: 3000,
    setup: async (p, { ask, wait, key, time, zoom, stand }) => {
      const dock = await ask(() => {
        // a mainland jetty, because an island one is reached by the boat this shot is buying
        const pier = (window.__piers || []).find((one) => one.side === 'mainland') || (window.__piers || [])[0];
        return pier ? { x: pier.dockX + 0.5, z: pier.dockZ + 0.5 } : null;
      });
      if (!dock) return null;                       // a world whose coast raised no jetty today
      await ask(() => { window.__state.inventory.gold = 400; window.__state.version++; });
      await stand(dock.x, dock.z, 4000);
      const pierState = () => ({
        player: { x: window.__player.x, z: window.__player.z },
        speaker: document.querySelector('.dlg-them .dlg-name')?.textContent,
        dialogue: document.getElementById('dialogue')?.className,
        choices: [...document.querySelectorAll('#dialogue .dlg-choice')].map((choice) => choice.textContent.trim()),
        prompt: document.getElementById('interactPrompt')?.textContent,
      });
      const pierChoices = async (speaker, firstChoice) => {
        const before = await ask(pierState);
        if (before.speaker !== speaker || !before.dialogue?.includes('show')) {
          throw new Error(`sea: expected ${speaker} dialogue: ${JSON.stringify(before)}`);
        }
        // A frozen screenshot clock need not finish the typewriter animation. Enter is the
        // player's ordinary way to reveal the complete page before choosing an option.
        if (!before.dialogue.includes('choosing')) await key('Enter');
        try {
          await p.waitForFunction(([name, label]) => {
            const box = document.getElementById('dialogue');
            return box?.classList.contains('show') && box.classList.contains('choosing')
              && document.querySelector('.dlg-them .dlg-name')?.textContent === name
              && box.querySelector('.dlg-choice')?.textContent.includes(label);
          }, [speaker, firstChoice], { timeout: 3_000, polling: 100 });
        } catch (error) {
          throw new Error(`sea: ${speaker} choices missing ${firstChoice}: ${JSON.stringify(await ask(pierState))}; ${error.message}`);
        }
      };
      const landed = await ask(pierState);
      if (Math.hypot(landed.player.x - dock.x, landed.player.z - dock.z) >= 4) {
        throw new Error(`sea: pier landing out of boatwright reach: ${JSON.stringify({ dock, landed })}`);
      }
      // The ferry sometimes calls at this pier at noon. When it does, Enter talks to its
      // ferryman and the first choice would board it instead of asking after our own boat.
      // Try fixed world times until the ferry is away and the timetable offers the boatwright.
      let timetable = false;
      for (const phase of [0.5, 0.515, 0.53, 0.545, 0.56, 0.575, 0.59, 0.605, 0.62, 0.635]) {
        await time(phase);
        await key('Enter');
        try {
          await p.waitForFunction(() => document.getElementById('dialogue')?.classList.contains('show'),
            null, { timeout: 5_000, polling: 100 });
        } catch (error) {
          throw new Error(`sea: no pier dialogue at phase ${phase}: ${JSON.stringify(await ask(pierState))}; ${error.message}`);
        }
        const speaker = await p.locator('.dlg-them .dlg-name').textContent();
        if (speaker === 'Ferryman') { await key('Escape'); continue; }
        if (speaker !== 'Timetable') throw new Error(`sea: expected pier timetable or ferryman at ${phase}, got ${speaker}`);
        await pierChoices('Timetable', 'Ask after a boat of your own');
        timetable = true;
        break;
      }
      if (!timetable) throw new Error('sea: ferry remained docked through every fixed timetable phase');
      await key('Enter');                           // ask after a boat of your own
      await p.waitForFunction(() => document.querySelector('.dlg-them .dlg-name')?.textContent === 'Boatwright'
        && document.getElementById('dialogue')?.classList.contains('show'), null, { timeout: 5_000, polling: 100 });
      await pierChoices('Boatwright', 'Buy the boat');
      await key('Enter');                           // buy her
      if (!(await ask(() => window.__sailing.bought))) {
        throw new Error(`sea: boat purchase did not complete: ${JSON.stringify(await ask(pierState))}`);
      }
      await wait(1200);
      await key('Enter');                           // cast off
      await wait(1200);
      await key('w', 3000);                         // row out past the end of the decking
      await zoom(16);
      const afloat = await ask(() => window.__sailing.sailing);
      if (!afloat) return null;                     // she never left the jetty: nothing worth a picture
      return 'under way';
    },
  },
  {
    /*
     * Two people in one world, which is the only shot that cannot be taken alone.
     *
     * `join: true` puts *this* page on the server as well as the second one, so what is
     * photographed is somebody's own screen with another player standing in it — a roster with two
     * names in it and a second hero in the square. Both go to the same village because two players
     * in one world who cannot see each other is exactly the fault this picture exists to disprove.
     */
    name: 'shared', title: 'Two players in one world', server: true, join: true, settle: 7000,
    setup: async (p, { ask, wait, village, time, zoom }, playing) => {
      await time(NOON);
      const here = await village();
      await wait(4000);
      await zoom(18);
      const others = await ask(() => (window.__online ? window.__online.count : 0));
      if (!others) return null;                     // nobody else arrived: not a shared world today
      // A newly teleported page may briefly draw a chunk while its server answer is in flight.
      // `grown` counts local chunks still on screen, not a historical total: wait for both views
      // to settle on the server's ground before judging the shared country.
      const settled = () => window.__stream?.arrived > 0 && window.__stream.grown === 0;
      try {
        await Promise.all([
          p.waitForFunction(settled, null, { timeout: 90_000, polling: 100 }),
          playing.waitForFunction(settled, null, { timeout: 90_000, polling: 100 }),
        ]);
      } catch (error) {
        const [mine, theirs] = await Promise.all([
          p.evaluate(() => ({ stream: window.__stream ?? null, grown: window.__grownDetails?.() })),
          playing.evaluate(() => ({ stream: window.__stream ?? null, grown: window.__grownDetails?.() })),
        ]);
        throw new Error(`shared stream did not settle: mine=${JSON.stringify(mine)} other=${JSON.stringify(theirs)}; ${error.message}`);
      }
      const sample = () => ({
        stream: window.__stream,
        mismatch: document.body.textContent.includes('This world grew differently')
          || document.body.textContent.includes('This world does not match'),
        creatures: window.__entitiesFull().filter((one) => one.id !== null && !one.dead)
          .map((one) => ({ id: one.id, kind: one.kind, x: one.x, z: one.z })),
      });
      const [mine, theirs] = await Promise.all([p.evaluate(sample), playing.evaluate(sample)]);
      if ([mine, theirs].some((one) => one.mismatch || one.stream.arrived === 0 || one.stream.grown !== 0)) {
        throw new Error(`road clients did not agree on streamed country: ${JSON.stringify([mine.stream, theirs.stream])}`);
      }
      const same = mine.creatures.find((one) => theirs.creatures.some((other) =>
        one.id === other.id && Math.hypot(one.x - other.x, one.z - other.z) < 2));
      if (!same) throw new Error('the two road clients saw no shared creature in the same place');
      return `${here.name}, ${others} other player${others > 1 ? 's' : ''}; ${mine.stream.arrived}/${theirs.stream.arrived} chunks arrived, none locally grown; both saw ${same.kind} ${same.id}`;
    },
  },
];

/**
 * The world server, for the shots that are of a tool rather than of the game.
 *
 * The Domesday Book is asked of a server and not of a page — that is the whole point of it, since
 * the interesting half of a world is the half nobody is standing in. `GET /domesday` grows a world
 * nobody has opened in order to answer, so nothing has to play the game first: a server, a token
 * and a seed are the whole setup.
 */
let serving = null;
const WORLD_PORT = process.env.WORLD_PORT || '8795';
const TOKEN = 'shots-only-token';
const startWorld = async () => {
  if (serving) return;
  const answers = async () => {
    try { return (await fetch(`http://localhost:${WORLD_PORT}/`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  };
  if (await answers()) throw new Error(`something is already on port ${WORLD_PORT} — set WORLD_PORT`);
  // The server imports portal HTML through Vite's ?raw loader. Build the same bundle used by the
  // published image; tsx cannot load that import when a shared or Domesday shot needs a server.
  execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'server/build.config.ts'], { stdio: 'inherit' });
  serving = spawn('node', ['server/dist/server.mjs'], {
    detached: true, stdio: ['ignore', 'ignore', 'inherit'],
    // its own worlds, thrown away with the directory: a screenshot must never be taken of, or write
    // to, the worlds somebody is actually playing
    env: { ...process.env, PORT: WORLD_PORT, OPERATOR_TOKEN: TOKEN, SHOTS_CAPTURE: '1', DATA_DIR: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shots-')) },
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await answers()) return;
  }
  throw new Error(`no world server answered on ${WORLD_PORT}`);
};
const stopWorld = () => {
  if (!serving) return;
  try { process.kill(-serving.pid, 'SIGTERM'); } catch { /* it beat us to it */ }
  serving = null;
};
process.on('exit', stopWorld);

/**
 * Somebody playing, so that there is a world to survey.
 *
 * The Domesday Book is a picture of a running world and a world server holds none until a player
 * knocks: `/domesday` grows the country to answer, but a village's people are settled by the
 * simulation putting them in their own street, which happens where a player is standing. So the
 * book is photographed with a game open beside it, touring a few villages to give the survey
 * something to survey — which is also, exactly, what the tool is for.
 */
async function playerJoins(browser, seed, villages = 3, world = 'endless') {
  console.log(`raising survey player: ${world}, ${villages} village(s)`);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  if (PATIENCE) page.setDefaultTimeout(PATIENCE);
  await captureClock(page);
  await page.goto(`${origin}/?world=${world}&seed=${seed}&server=ws://localhost:${WORLD_PORT}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__teleport === 'function', null, { timeout: Math.max(60000, PATIENCE), polling: 100 });
  await advance(page, FRAME_MS);
  // `?server=` joins automatically. Pressing Connect after that would disconnect back to the
  // private worker, turning a two-player picture into a solo one.
  await page.waitForFunction(() => window.__online?.away, null, { timeout: Math.max(120000, PATIENCE), polling: 100 });
  await advance(page, FRAME_MS);
  await settleCountry(page);
  console.log('survey player streamed initial country');
  for (let n = 0; n < villages; n++) {
    const v = await page.evaluate((n) => {
      const v = window.__villages[n];
      if (!v) return null;
      window.__teleport(v.x, v.z);
      return { name: v.name, x: v.x, z: v.z };
    }, n);
    await advance(page, 12000);
    if (v && world === 'endless' && villages > 1) {
      await untilSurveyed(page, seed, `${v.name} settled`,
        (book) => book.parishes.some((p) => p.name === v.name && p.souls > 0));
    }
  }
  /*
   * And back to the first, which is the one the book lists first.
   *
   * `doing` is the branch of a behaviour tree that claimed the last tick, and only somebody the
   * world has a body for has one — which is the village a player is standing in. Touring and then
   * stopping somewhere else photographs a book whose top parish has an empty column, and that
   * column is half of what the tool is for.
   */
  await page.evaluate(() => { const v = window.__villages[0]; window.__teleport(v.x, v.z); });
  await advance(page, 14000);
  if (world === 'endless' && villages > 1) {
    const book = await untilSurveyed(page, seed, 'somebody on their feet', (one) => one.standing > 0);
    console.log(`survey: ${book.souls} souls in ${book.parishes.map((p) => `${p.name} ${p.souls}`).join(', ')}`);
  }
  return page;
}

/**
 * What the world server's own survey says of a seed right now. A read: it ticks nothing.
 *
 * Null while the world is still being prepared or the door is busy, which both mean ask again.
 */
async function surveyed(seed) {
  const res = await fetch(`http://localhost:${WORLD_PORT}/registry?seed=${seed}`, {
    headers: { 'x-operator-token': TOKEN }, signal: AbortSignal.timeout(10000),
  });
  if (res.status === 503 || res.status === 429) return null;
  if (!res.ok) throw new Error(`the survey of world ${seed} answered ${res.status}`);
  return res.json();
}

/**
 * Hold the tour until the world server has actually done what the tour went there for (#538).
 *
 * Under the capture clock the server ticks once per `advance`, and whatever it learns between ticks
 * — where the survey player now stands, a patch its ground worker has just finished growing — only
 * counts at the next one. Whether that had landed before the one tick a stop was given was a race
 * on the runner's wall clock: one capture of a commit got a book of four villages and the other a
 * book of Blackby alone, because the tour had moved on before the other villages were settled.
 *
 * So each stop is read back from the survey itself, and only when it has not happened yet is the
 * world given another step. A run where it already has takes exactly the steps it always did.
 */
const SURVEY_TRIES = 40;
async function untilSurveyed(page, seed, what, done) {
  let book = null;
  for (let tries = 0; tries <= SURVEY_TRIES; tries++) {
    book = await surveyed(seed);
    if (book && done(book)) {
      // said in the log either way, so a capture shows which stops the world was behind at
      console.log(`survey: ${what} after ${tries} extra step${tries === 1 ? '' : 's'}`);
      return book;
    }
    // wall-clock room for whatever the server is waiting on, then one more step of both clocks
    await new Promise((r) => setTimeout(r, 750));
    await advance(page, FRAME_MS);
  }
  const had = book ? book.parishes.map((p) => `${p.name} ${p.souls}`).join(', ') || 'no parishes' : 'no answer';
  throw new Error(`world ${seed}: the survey never showed ${what} (${had})`);
}

/** Take one, and say what happened. */
async function take(browser, shot) {
  console.log(`raising ${shot.name}`);
  const page = await browser.newPage({ viewport: shot.viewport ?? VIEW });
  if (PATIENCE) page.setDefaultTimeout(PATIENCE);
  await captureClock(page);
  if (shot.join) await page.addInitScript(() => localStorage.setItem('ai.world/name', 'Ash'));
  if (RIG) {
    await page.addInitScript((on) => {
      try { localStorage.setItem('ai.world/new/composer', on); } catch { /* no storage, no switch */ }
    }, RIG === 'composer' ? 'on' : 'off');
  }
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  /*
   * The game at its best rather than at what this machine could keep up with.
   *
   * A headless browser draws with a software rasteriser at about ten frames a second, so the rig's
   * own auto-quality steps the picture down to `low` within seconds of the world appearing — no
   * shadows, plain resolution — and says so in the corner. That is right for somebody playing and
   * wrong for a picture of the game: nobody's machine is this browser. Written as the *player's*
   * choice, which is the one thing auto-quality will not argue with.
   */
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ai.world/quality', 'high');
      localStorage.removeItem('ai.world/quality-auto');
    } catch { /* private browsing: the picture is a little plainer, and that is all */ }
  });
  /*
   * `WORLD=endless chore shots -- town` takes the same shot in the other country.
   *
   * There are two generators behind one seam and they do not look alike, which is the whole of
   * #299. Judging that means the same shot, the same seed and the same camera, twice — and without
   * this the only way to get the second picture was to edit the spec, take it, and edit it back.
   */
  const world = process.env.WORLD || shot.world || 'road', seed = process.env.SEED || shot.seed || 3;
  let playing = null;
  if (shot.page) {
    // a tool rather than the game: no world to raise, so nothing to wait on but the page itself
    if (shot.server) { await startWorld(); playing = await playerJoins(browser, seed); }
    await page.goto(`${origin}${shot.page.replace('TOKEN', TOKEN).replace('WORLD', `http://localhost:${WORLD_PORT}`)}`, { waitUntil: 'load' });
  } else {
    /*
     * A shared-world shot needs this page on the server too, and somebody already standing in it.
     *
     * The second player goes first and deliberately: a world server holds no people until somebody
     * knocks, so a page that joins an empty world and photographs itself has photographed single
     * player with a socket attached.
     */
    if (shot.join) { await startWorld(); playing = await playerJoins(browser, seed, 1, world); }
    const joining = shot.join ? `&server=ws://localhost:${WORLD_PORT}` : '';
    await page.goto(`${origin}/?world=${world}&seed=${seed}${shot.touch ? '&touch=1' : ''}${joining}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__teleport === 'function', null, { timeout: Math.max(60000, PATIENCE), polling: 100 });
    await advance(page, FRAME_MS);
    await page.waitForFunction(() => window.__world?.online === 'online', null,
      { timeout: Math.max(120000, PATIENCE), polling: 100 });
    await advance(page, FRAME_MS);
    await settleCountry(page);
    console.log(`${shot.name}: initial country streamed`);
    if (shot.join) {
      // This page also joins automatically from `?server=`. Its saved name was set before boot.
      await page.waitForFunction(() => window.__online?.away && window.__online.count > 0,
        null, { timeout: Math.max(120000, PATIENCE), polling: 100 });
    }
  }
  let note;
  const done = async () => {
    await collectSweep(page);
    if (playing) await collectSweep(playing);
    await page.close();
    if (playing) await playing.close();
  };
  try { note = await shot.setup(page, verbs(page), playing); }
  catch (e) { await done(); return { ok: false, why: e.message }; }
  if (note === null) { await done(); return { ok: false, why: 'nothing to photograph in this world today' }; }
  console.log(`${shot.name}: setup complete (${note ?? 'ready'})`);
  if (!shot.page) await lockSceneClock(page, ['night', 'phone-night'].includes(shot.name) ? NIGHT : NOON);
  /*
   * Long enough for whatever was asked for to be drawn, and for the notices to clear.
   *
   * The game says things to the player — what the graphics settled on, what the villagers have
   * heard about bears — and they stack up in the corner for a few seconds. A picture taken at two
   * seconds is a picture of the game telling you about itself.
   */
  // Rain strength eases over several seconds after a teleport. Let the lighting converge before
  // comparing two renderer builds; the usual editorial shots keep their shorter requested delay.
  await advance(page, process.env.STATIC_SCENE === '1' ? Math.max(shot.settle ?? 9000, 30000) : shot.settle ?? 9000);
  if (!shot.page && !['interior', 'dungeon'].includes(shot.name)) await settleCountry(page);
  // Architecture comparisons can omit moving creatures while retaining terrain, props and light.
  // The scene keeps updating after setup, so changing the camera layer is stable across frames.
  if (process.env.STATIC_SCENE === '1') {
    if (shot.name !== 'town' && shot.name !== 'mountain') throw new Error('STATIC_SCENE supports town and mountain');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__state.time = 0.5;
      window.__scene?.traverse((object) => {
        if (object.userData.pool || object.type === 'Points') object.layers.disable(0);
      });
      const hero = window.__player.entity, iso = window.__iso, rig = window.__rig;
      if (!hero || !iso || !rig) throw new Error('static scene needs the live camera and rig');
      iso.rotation = Math.PI / 4;
      iso.lift = 18;
      iso.target.set(hero.x, hero.y, hero.z);
      iso.update({ isDown: () => false, dragDX: 0, dragDY: 0, wheelDelta: 0 }, 0, false);
      rig.follow(hero.x, hero.z, iso.zoom);
      rig.lighting.sun.position = [hero.x, 80, hero.z + 26];
      rig.lighting.sun.target = [hero.x, 0, hero.z];
      rig.lighting.sun.intensity = 2.6;
      rig.lighting.sun.colour = 0xfff3dc;
      rig.lighting.hemi.intensity = 1;
      rig.lighting.hemi.sky = 0xcfe6ff;
      rig.lighting.hemi.ground = 0x6f8f4f;
      rig.lighting.ambient.intensity = 0.45;
      rig.lighting.ambient.colour = 0xc9dcff;
      rig.graph.background = 0x8fc1e6;
      if (rig.graph.fog) rig.graph.fog.colour = 0x8fc1e6;
      rig.updateWater(0);
      rig.fitShadow();
      rig.redrawShadows();
      rig.draw(rig.graph, iso);
    });
    await page.addStyleTag({ content: '#actionCard, #debug { visibility: hidden !important; }' });
    const at = await page.evaluate(() => ({
      hero: [window.__player.entity.x, window.__player.entity.y, window.__player.entity.z],
      target: [window.__iso.target.x, window.__iso.target.y, window.__iso.target.z], lift: window.__iso.lift,
      angle: window.__iso.rotation, zoom: window.__iso.zoom,
      sky: window.__rig.graph.background, sun: window.__rig.lighting.sun.intensity,
    }));
    console.log(`static ${shot.name} ${JSON.stringify(at)}`);
  }
  console.log(`${shot.name}: final frame ready`);
  await page.evaluate(() => window.__shotClock.release());
  const file = path.join(OUT, `${shot.name}.png`);
  // Software rendering a wide mountain scene can take longer than Playwright's 30-second default
  // on the small host used to retake references. Keep the same frame; only allow it to finish.
  try {
    await page.screenshot({ path: file, animations: 'disabled',
      style: shot.cleanFrame ? CLEAN_FRAME : undefined,
      timeout: Math.max(120_000, PATIENCE) });
  } catch (error) {
    await done();
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  await done();
  return { ok: true, file, note, errs: errs.length };
}

(async () => {
  const taking = SHOTS.filter((s) => !wanted.length || wanted.includes(s.name));
  if (listing) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(12)} ${s.title}`);
    return;
  }
  if (!taking.length) throw new Error(`no such shot: ${wanted.join(', ')} — try --list`);
  fs.mkdirSync(OUT, { recursive: true });
  await startServing();
  const browser = await chromium.launch({
    headless: true, channel: CHANNEL || undefined, executablePath: process.env.BROWSER || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let missed = 0;
  for (const shot of taking) {
    const got = await take(browser, shot);
    if (got.ok) console.log(`took   ${shot.name.padEnd(12)} ${got.note ?? ''}${got.errs ? ` (${got.errs} page errors)` : ''}`);
    else { missed++; console.log(`missed ${shot.name.padEnd(12)} ${got.why}`); }
  }
  writeSweep();
  await browser.close();
  stopWorld();
  stopServing();
  console.log(`${taking.length - missed} of ${taking.length} taken into ${OUT}/`);
  // a missed shot leaves the old picture in place, which is the right thing to do and still wants
  // saying loudly enough that nobody ships a README half of which is a week older than the rest
  process.exitCode = missed ? 1 : 0;
})().catch((e) => { console.error(e); writeSweep(); stopWorld(); stopServing(); process.exit(1); });
