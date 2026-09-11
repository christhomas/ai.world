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
 * It borrows playwright exactly the way `playtest.cjs` does and for the same reason — a browser
 * toolchain has no business in a world-server image — and it starts a page server if nothing is
 * already answering, leaving one it did not start alone.
 *
 * A shot that cannot be set up says so and the run carries on: a sea that has no whales in it this
 * hour is not a reason to lose the other twenty pictures.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || '5173';
/*
 * Which browser. Empty means playwright's own chromium, which a *borrowed* playwright usually
 * cannot reach: its bundled browser is a numbered download matching the version that was borrowed,
 * and the checkout it came from has a different number on disk. So the default is the real Chrome,
 * and `BROWSER=/path/to/one` covers the machine that has neither.
 */
const CHANNEL = process.env.CHANNEL ?? 'chrome';
const OUT = process.env.OUT || 'docs/screenshots';
const origin = `http://localhost:${PORT}`;
/** The shape of the pictures in the README: wide enough to show a street, short enough to scroll past. */
const VIEW = { width: 1440, height: 900 };
/** A phone held upright, for the one shot that is about the touch controls. */
const PHONE = { width: 420, height: 900 };
/** How long a fresh page is given to raise a world before anything is asked of it. */
const LOADING = 18000;

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
  if (await answering()) { console.log(`taking them against the server already on ${origin}`); return; }
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
    await page.waitForTimeout(settle);
  },
  /** Point the camera at something, from wherever the hero is standing. */
  face: async (x, z) => {
    await page.evaluate(([x, z]) => {
      const p = window.__player;
      window.__iso.rotation = Math.atan2(z - p.z, x - p.x) + Math.PI;
    }, [x, z]);
    await page.waitForTimeout(400);
  },
  /** How far back to stand, in the camera's own units. */
  zoom: async (n) => { await page.evaluate((n) => window.__zoom(n), n); await page.waitForTimeout(400); },
  time: async (f) => { await page.evaluate((f) => window.cmd(`time ${f}`), f); await page.waitForTimeout(600); },
  day: async (d) => { await page.evaluate((d) => window.cmd(`day ${d}`), d); await page.waitForTimeout(1200); },
  key: async (k, hold = 0) => {
    if (!hold) { await page.keyboard.press(k); }
    else { await page.keyboard.down(k); await page.waitForTimeout(hold); await page.keyboard.up(k); }
    await page.waitForTimeout(600);
  },
  wait: (ms) => page.waitForTimeout(ms),
  /** The nearest village to the middle of the world, and the hero stood in the middle of it. */
  village: async (n = 0) => {
    const v = await page.evaluate((n) => window.__villages[n], n);
    await page.evaluate(([x, z]) => window.__teleport(x, z), [v.x, v.z]);
    // long enough for the village to fill: the people are streamed in like everything else, and a
    // picture taken the moment the hero lands is a picture of an empty square
    await page.waitForTimeout(9000);
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
      await village();
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
      // stood a couple of tiles off rather than across the field: the camera follows the hero, so
      // anything further away than that is a picture of the hero with the subject in the corner
      await stand(spot.x + 2.5, spot.z + 2.5, 2500);
      await face(spot.x, spot.z);
      return `${spot.kind}, ${spot.near} people about`;
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
    setup: async (p, { village, time, key, wait }) => {
      await time(NOON);
      await village();
      await key('m');
      await wait(1500);
      return 'open';
    },
  },
  {
    name: 'domesday', title: 'The Domesday Book', server: true,
    page: '/tools/domesday.html?at=WORLD&seed=3',
    setup: async (p, { wait }) => {
      // the token is typed rather than put in the address, exactly as a person would: the page
      // deliberately never remembers one, because a tool that quietly keeps a password leaks it
      await p.fill('#token', TOKEN);
      await p.click('#ask');
      await p.waitForSelector('#out table', { timeout: 30000 });
      await wait(1500);
      return p.$eval('#note', (el) => el.textContent.trim());
    },
  },
  {
    name: 'phone', title: 'The game on a phone', viewport: PHONE, touch: true,
    setup: async (p, { village, time, zoom }) => {
      await time(NOON);
      await village();
      await zoom(13);
      return 'touch controls';
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
  serving = spawn('pnpm', ['tsx', 'server/index.ts'], {
    detached: true, stdio: ['ignore', 'ignore', 'inherit'],
    // its own worlds, thrown away with the directory: a screenshot must never be taken of, or write
    // to, the worlds somebody is actually playing
    env: { ...process.env, PORT: WORLD_PORT, OPERATOR_TOKEN: TOKEN, DATA_DIR: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shots-')) },
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
async function playerJoins(browser, seed, villages = 3) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(`${origin}/?world=road&seed=${seed}&server=ws://localhost:${WORLD_PORT}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__teleport === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(LOADING);
  // the address is in the box already — `?server=` fills it — and pressing connect is what leaves
  // the world in this tab for the one on the server
  await page.evaluate(() => document.getElementById('connectButton').click());
  await page.waitForTimeout(6000);
  for (let n = 0; n < villages; n++) {
    await page.evaluate((n) => { const v = window.__villages[n]; if (v) window.__teleport(v.x, v.z); }, n);
    await page.waitForTimeout(12000);
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
  await page.waitForTimeout(14000);
  return page;
}

/** Take one, and say what happened. */
async function take(browser, shot) {
  const page = await browser.newPage({ viewport: shot.viewport ?? VIEW });
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
  const world = shot.world ?? 'road', seed = shot.seed ?? 3;
  let playing = null;
  if (shot.page) {
    // a tool rather than the game: no world to raise, so nothing to wait on but the page itself
    if (shot.server) { await startWorld(); playing = await playerJoins(browser, seed); }
    await page.goto(`${origin}${shot.page.replace('TOKEN', TOKEN).replace('WORLD', `http://localhost:${WORLD_PORT}`)}`, { waitUntil: 'load' });
  } else {
    await page.goto(`${origin}/?world=${world}&seed=${seed}${shot.touch ? '&touch=1' : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__teleport === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(shot.loading ?? LOADING);
  }
  let note;
  const done = async () => { await page.close(); if (playing) await playing.close(); };
  try { note = await shot.setup(page, verbs(page)); }
  catch (e) { await done(); return { ok: false, why: e.message }; }
  if (note === null) { await done(); return { ok: false, why: 'nothing to photograph in this world today' }; }
  /*
   * Long enough for whatever was asked for to be drawn, and for the notices to clear.
   *
   * The game says things to the player — what the graphics settled on, what the villagers have
   * heard about bears — and they stack up in the corner for a few seconds. A picture taken at two
   * seconds is a picture of the game telling you about itself.
   */
  await page.waitForTimeout(shot.settle ?? 9000);
  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
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
  await browser.close();
  stopWorld();
  stopServing();
  console.log(`${taking.length - missed} of ${taking.length} taken into ${OUT}/`);
  // a missed shot leaves the old picture in place, which is the right thing to do and still wants
  // saying loudly enough that nobody ships a README half of which is a week older than the rest
  process.exitCode = missed ? 1 : 0;
})().catch((e) => { console.error(e); stopWorld(); stopServing(); process.exit(1); });
