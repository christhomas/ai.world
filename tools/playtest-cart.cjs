/* A played hunt, cart load, mounted haul and final on-foot bait. Called by playtest.cjs. */
module.exports = async function playCart(page, say, go, face) {
  const phase = (name) => { if (process.env.CART_TRACE) console.log(`cartwalk: ${name}`); };
  const snapshot = () => page.evaluate(() => ({
    hero: { x: window.__player.x, z: window.__player.z,
      mounted: window.__player.entity.mounted?.id ?? null, steering: window.__player.steering,
      ground: window.__player.ground.heightAt(window.__player.x, window.__player.z) },
    horse: window.__mount(),
    shoulder: window.__state.shouldering,
    bodies: window.__bodies(),
  }));
  const waitForWalk = async (destination, label) => {
    try {
      await page.waitForFunction(() => !window.__player.steering, null, { timeout: 8000, polling: 100 });
    } catch (error) {
      const state = await snapshot();
      const movement = await page.evaluate(() => ({ mode: window.__player.mode, placed: window.__player.placed,
        steer: window.__player.steered, dialogue: document.getElementById('dialogue')?.className,
        visibility: document.visibilityState, world: window.__world,
        clock: { day: window.__state.day, time: window.__state.time },
      }));
      throw new Error(`${label} did not finish within 8 seconds: ${JSON.stringify({ destination, state, movement })}; ${error.message}`);
    }
  };
  const choose = async (label) => {
    await page.waitForFunction(() => document.getElementById('dialogue')?.classList.contains('show'), null,
      { timeout: 5000 }).catch(async () => {
        throw new Error(`no cart dialogue for ${label}: ${JSON.stringify(await snapshot())}`);
      });
    if (!await page.locator('#dialogue').evaluate((el) => el.classList.contains('choosing'))) {
      await page.locator('#dialogue .dlg-panel').click();
    }
    await page.waitForFunction(() => document.getElementById('dialogue')?.classList.contains('choosing'), null,
      { timeout: 12000 });
    const row = page.locator('#dialogue .dlg-choice').filter({ hasText: label });
    if (await row.count() !== 1) throw new Error(`cart dialogue has no unique ${label}: ${await page.locator('#dialogue .dlg-choice').allTextContents()}`);
    await row.click();
  };

  // A planned perch identifies real high ground, far from the starting village. Hunt at its foot.
  const crag = await page.evaluate(() => window.__eyries()[0] ?? null);
  if (!crag) { say('a crag exists for hauling a carcass', false); return; }
  phase(`crag ${crag.x},${crag.z}`);
  // Stream the high country before asking collision about it; an unknown chunk is solid.
  await go(crag.x, crag.z, 7000);
  phase('crag streamed');
  let ground = null;
  for (let attempt = 0; attempt < 40 && !ground?.hunt; attempt++) {
    ground = await page.evaluate((crag) => {
      const turns = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6];
      const clear = (x, z, angle, length) => [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
        .filter((d) => d <= length)
        .every((d) => window.__canStand('horse', x + Math.cos(angle) * d, z + Math.sin(angle) * d));
      for (let r = 18; r <= 70; r += 2) for (let a = 0; a < 6.3; a += 0.4) {
        const x = crag.x + Math.cos(a) * r, z = crag.z + Math.sin(a) * r;
        if (window.__canStand('horse', x, z) && window.__canStand('goat', x + 2, z) &&
            window.__canStand('goat', x + 3, z + 1) && window.__canStand('goat', x + 1, z - 1)) {
          const toward = Math.atan2(crag.z - z, crag.x - x);
          const lanes = turns.filter((turn) => clear(x, z, toward + turn, 5)).length;
          const open = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]
            .filter((turn) => clear(x, z, toward + turn, 3)).length;
          if (lanes >= 2 && open >= 10) return { crag, hunt: { x, z, lanes } };
        }
      }
      return { crag, hunt: null };
    }, crag);
    if (!ground.hunt) await page.waitForTimeout(500);
  }
  if (!ground?.hunt) { say('a walkable hunt ground lies below a crag', false,
    JSON.stringify({ crag, landed: await snapshot() })); return; }
  say('the hunt site has clear horse lanes', ground.hunt.lanes >= 2,
    `${ground.hunt.lanes} clear lanes toward the crag`);
  await go(ground.hunt.x, ground.hunt.z, 2000);
  phase(`hunt ground ${ground.hunt.x},${ground.hunt.z}`);
  await page.evaluate(() => {
    window.__state.give('cart', 1);
    // A hunter may buy an axe; one landed blow is enough to finish this goat.
    window.__state.give('axe', 1);
    window.__state.equip('axe');
  });
  let put = null;
  for (let attempt = 0; attempt < 5 && !put; attempt++) {
    put = await page.evaluate(() => window.__spawn('goat', 2));
    if (!put) await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  let killed = false, swings = 0;
  for (let n = 0; n < 60 && !killed; n++) {
    const now = await snapshot();
    if (now.bodies.some((b) => b.kind === 'goat')) { killed = true; break; }
    const goat = await page.evaluate(() => window.__entitiesFull()
      .filter((e) => e.kind === 'goat' && !e.dead && e.hp > 0)
      .map((e) => ({ ...e, d: Math.hypot(e.x - window.__player.x, e.z - window.__player.z) }))
      .sort((a, b) => a.d - b.d)[0] ?? null);
    if (!goat) break;
    if (goat.d > 1.9) await go(goat.x + 0.7, goat.z + 0.7, 100);
    await face(goat.x, goat.z);
    // Turning the camera alone does not turn the hero's body; one short step aims the blow.
    await page.keyboard.down('w');
    await page.waitForTimeout(220);
    await page.keyboard.up('w');
    await page.keyboard.press('x');
    swings++;
    await page.waitForTimeout(260);
  }
  const dead = await snapshot();
  const body = dead.bodies.find((b) => b.kind === 'goat');
  say('a hunted goat leaves a carcass at the foot of the crag', !!put && killed && !!body,
    `${swings} swings; spawn ${JSON.stringify(put)}; ${body ? `${body.x.toFixed(1)},${body.z.toFixed(1)}` : 'no body'}`);
  if (!body) return;

  await go(body.x, body.z, 800);
  await page.evaluate(() => window.__ride(true));
  // The earlier wall check may already own a horse parked in the village. Give the mounted update
  // a frame to bring that horse under its rider before dismounting at this distant carcass.
  let under = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.waitForTimeout(250);
    under = await page.evaluate(() => window.__mount().under);
    if (under !== null && under < 0.2) break;
  }
  if (under === null || under >= 0.2) {
    throw new Error(`horse did not reach rider at carcass: ${JSON.stringify(await snapshot())}`);
  }
  await page.evaluate(() => window.__ride(false));
  phase(`at carcass ${JSON.stringify(await snapshot())}`);
  await page.keyboard.press('Enter');
  await choose('Load into the cart');
  const loaded = await snapshot();
  say('the cart takes the hunted carcass once', loaded.horse.cargo?.kind === 'goat' && !loaded.bodies.includes(body),
    JSON.stringify(loaded.horse.cargo));
  if (!loaded.horse.cargo) return;

  await page.keyboard.press('Enter');
  await choose('Ride');
  // The dialogue mounts the rider before the next frame brings the horse under him. Route
  // checks made in that gap start from a body that has not yet settled at the cart.
  await page.waitForFunction(() => window.__mount().under < 0.2, null,
    { timeout: 5000, polling: 100 });
  const start = await snapshot();
  // A clear five-tile ray at the hunt site does not promise one where the fight and dismount
  // leave the rider. Take short verified steps around the rock, then measure real progress.
  let hauled = start;
  const attempts = [];
  const tried = new Set();
  const distance = (hero) => Math.hypot(hero.x - ground.crag.x, hero.z - ground.crag.z);
  for (let attempt = 0; attempt < 12 && distance(start.hero) - distance(hauled.hero) <= 2; attempt++) {
    const lanes = await page.evaluate(({ crag, tried }) => {
      const p = window.__player;
      const toward = Math.atan2(crag.z - p.z, crag.x - p.x);
      const used = new Set(tried);
      const before = Math.hypot(crag.x - p.x, crag.z - p.z);
      const lanes = [];
      for (const length of [5, 4, 3, 2, 1, 0.5]) {
        for (const turn of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2, -2, 2.4, -2.4, Math.PI]) {
          const a = toward + turn, dx = Math.cos(a), dz = Math.sin(a);
          const x = p.x + dx * length, z = p.z + dz * length;
          const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
          if (used.has(key)) continue;
          let clear = true;
          for (let d = 0.25; d <= length; d += 0.25) {
            if (!window.__canStand('horse', p.x + dx * d, p.z + dz * d)) { clear = false; break; }
          }
          if (clear) lanes.push({ x, z, key, gain: before - Math.hypot(crag.x - x, crag.z - z) });
        }
      }
      return lanes.sort((a, b) => b.gain - a.gain);
    }, { crag: ground.crag, tried: [...tried] });
    const lane = lanes[0] ?? null;
    if (!lane) { attempts.push({ lane: null, at: hauled.hero }); break; }
    tried.add(lane.key);
    const walking = await page.evaluate(([x, z]) => window.__walkTo(x, z), [lane.x, lane.z]);
    await waitForWalk(lane, 'Mounted haul');
    hauled = await snapshot();
    attempts.push({ lane, walking, at: hauled.hero });
  }
  const moved = Math.hypot(hauled.hero.x - start.hero.x, hauled.hero.z - start.hero.z);
  const gained = distance(start.hero) - distance(hauled.hero);
  const hauledBody = moved > 2 && gained > 2 && hauled.horse.cargo?.kind === 'goat';
  say('the loaded horse hauls the body toward the crag', hauledBody,
    hauledBody ? `${moved.toFixed(1)} tiles, ${gained.toFixed(1)} nearer crag, cargo goat`
      : `${moved.toFixed(1)} tiles, ${gained.toFixed(1)} nearer crag, cargo ${hauled.horse.cargo?.kind ?? 'none'}; start ${JSON.stringify(start)}; attempts ${JSON.stringify(attempts)}`);
  await page.evaluate(() => window.__ride(false));
  await page.keyboard.press('Enter');
  await choose('Shoulder the carcass');
  const lifted = await snapshot();
  say('the hunter unloads for the on-foot climb', lifted.shoulder?.kind === 'goat' && lifted.horse.cargo === null,
    JSON.stringify(lifted.shoulder));
  if (!lifted.shoulder) return;

  const feet = await page.evaluate(() => {
    const p = window.__player;
    const sites = new Map();
    for (let r = 3; r <= 20; r += 1) for (let a = 0; a < 6.3; a += 0.45) {
      const x = Math.round(p.x + Math.cos(a) * r);
      const z = Math.round(p.z + Math.sin(a) * r);
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= 1 || sites.has(`${x},${z}`)) continue;
      if (window.__canStand('hero', x, z) && window.__baitWouldNest(x, z)) sites.set(`${x},${z}`, { x, z, d });
    }
    return [...sites.values()].sort((a, b) => a.d - b.d).slice(0, 30);
  });
  if (!feet.length) { say('a winning crag is reachable from the parked horse', false,
    JSON.stringify({ lifted, crag: ground.crag })); return; }
  const footStart = lifted.hero;
  // A candidate tile may be standable but cut off by rock between it and the hunter. Try
  // other seeded winning tiles and only spend the body after a real on-foot arrival.
  let reached = lifted, gap = Infinity;
  const footAttempts = [];
  for (const foot of feet) {
    await page.evaluate(([x, z]) => window.__walkTo(x, z, 0.2), [foot.x, foot.z]);
    await waitForWalk(foot, 'On-foot crag approach');
    reached = await snapshot();
    gap = Math.hypot(reached.hero.x - foot.x, reached.hero.z - foot.z);
    footAttempts.push({ foot, gap });
    if (gap < 0.5) break;
  }
  const footMoved = Math.hypot(reached.hero.x - footStart.x, reached.hero.z - footStart.z);
  say('the carcass reaches a standable crag on foot', gap < 0.5 && footMoved > 1 && reached.shoulder?.kind === 'goat',
    `${gap.toFixed(1)} tiles from the ledge; walked ${footMoved.toFixed(1)} tiles; attempts ${JSON.stringify(footAttempts)}`);
  if (gap >= 0.5 || footMoved <= 1) return;
  const beforeAnchors = await page.evaluate(() => window.__baitedEyries());
  const wouldNest = await page.evaluate(() => window.__baitWouldNest(window.__player.x, window.__player.z));
  await page.keyboard.press('Enter');
  await choose('Leave it for the eagles here');
  await page.locator('#dialogue .dlg-panel').click();
  const after = await snapshot();
  const answer = await page.locator('#dialogue .dlg-text').textContent();
  const afterAnchors = await page.evaluate(() => window.__baitedEyries());
  const anchorId = `eyrie:${Math.round(after.hero.x)},${Math.round(after.hero.z)}`;
  const anchor = afterAnchors.find((one) => one.id === anchorId);
  say('bait consumes the hauled body and creates an eyrie anchor',
    after.shoulder === null && wouldNest && !beforeAnchors.some((one) => one.id === anchorId)
      && anchor?.kind === 'eyrie' && anchor.x === Math.round(after.hero.x)
      && anchor.z === Math.round(after.hero.z) && /came down, and it stayed/i.test(answer ?? ''),
    `${anchorId}: ${anchor ? 'recorded' : 'missing'}; ${(answer ?? '').slice(0, 90)}`);
};
