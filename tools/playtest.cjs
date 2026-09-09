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
 * It is not a unit test and does not pretend to be: it needs a dev server up, it is slow, and a
 * village is different every seed. What it is good for is the question the unit tests cannot
 * answer — whether the thing on the screen and the thing in the simulation are the same thing.
 *
 *   npm run dev
 *   NODE_PATH=<somewhere with playwright> node tools/playtest.cjs
 *
 * Playwright is not a dependency of this project. Borrow one.
 */
const { chromium } = require('playwright');
const OUT = process.env.OUT;
const results = [];
const say = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1100, height: 720 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:5173/?world=mesh&seed=3', { waitUntil: 'load' });
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
  say('creatures within reach are drawn where they are', d.wrongClose.of > 0 && d.wrongClose.mean < 0.35,
    `${d.wrongClose.of} corrections, mean ${d.wrongClose.mean.toFixed(2)}, worst ${d.wrongClose.worst.toFixed(2)} (${d.wrongClose.worstIs})`);

  // --- a fight ---
  // something with nothing solid between us: a goat in a paddock is behind a fence, and the test
  // would be measuring the fence
  const first = await page.evaluate((kinds) => {
    const p = window.__player;
    const clearTo = (x, z) => {
      const steps = Math.ceil(Math.hypot(x - p.x, z - p.z) / 0.3);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (window.__solid(p.x + (x - p.x) * t, p.z + (z - p.z) * t)) return false;
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
      const near = await quarryNow(quarry);
      if (!near) { landed = was !== null; break; }      // gone from the world: it died
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

  console.log('');
  console.log(errs.length ? 'PAGE ERRORS: ' + errs.slice(0, 3).join(' | ') : 'no page errors');
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  await b.close();
})();
