/* A played hunt, cart load, mounted haul and final on-foot bait. Called by playtest.cjs. */
module.exports = async function playCart(page, say, go, face) {
  const phase = (name) => { if (process.env.CART_TRACE) console.log(`cartwalk: ${name}`); };
  const snapshot = () => page.evaluate(() => ({
    hero: { x: window.__player.x, z: window.__player.z },
    horse: window.__mount(),
    shoulder: window.__state.shouldering,
    bodies: window.__bodies(),
  }));
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
      const candidates = [];
      for (let r = 18; r <= 70; r += 2) for (let a = 0; a < 6.3; a += 0.4) {
        const x = crag.x + Math.cos(a) * r, z = crag.z + Math.sin(a) * r;
        if (window.__canStand('horse', x, z) && window.__canStand('goat', x + 2, z) &&
            window.__canStand('goat', x + 3, z + 1) && window.__canStand('goat', x + 1, z - 1)) candidates.push({ x, z });
      }
      return { crag, hunt: candidates[0] ?? null };
    }, crag);
    if (!ground.hunt) await page.waitForTimeout(500);
  }
  if (!ground?.hunt) { say('a walkable hunt ground lies below a crag', false,
    JSON.stringify({ crag, landed: await snapshot() })); return; }
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
  const start = await snapshot();
  const approach = { x: ground.crag.x + (ground.hunt.x - ground.crag.x) * 0.35,
    z: ground.crag.z + (ground.hunt.z - ground.crag.z) * 0.35 };
  await page.evaluate(([x, z]) => window.__walkTo(x, z), [approach.x, approach.z]);
  await page.waitForTimeout(5500);
  const hauled = await snapshot();
  const moved = Math.hypot(hauled.hero.x - start.hero.x, hauled.hero.z - start.hero.z);
  say('the loaded horse hauls the body toward the crag', moved > 2 && hauled.horse.cargo?.kind === 'goat',
    `${moved.toFixed(1)} tiles, cargo ${hauled.horse.cargo?.kind ?? 'none'}`);
  await page.evaluate(() => window.__ride(false));
  await page.keyboard.press('Enter');
  await choose('Shoulder the carcass');
  const lifted = await snapshot();
  say('the hunter unloads for the on-foot climb', lifted.shoulder?.kind === 'goat' && lifted.horse.cargo === null,
    JSON.stringify(lifted.shoulder));
  if (!lifted.shoulder) return;

  const foot = await page.evaluate(() => {
    const p = window.__player;
    for (let r = 3; r <= 20; r += 1) for (let a = 0; a < 6.3; a += 0.45) {
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (window.__canStand('hero', x, z) && window.__baitChance(x, z) > 0) return { x, z };
    }
    return null;
  });
  if (!foot) { say('an eligible crag is reachable from the parked horse', false,
    JSON.stringify({ lifted, crag: ground.crag })); return; }
  const footStart = lifted.hero;
  await page.evaluate(([x, z]) => window.__walkTo(x, z), [foot.x, foot.z]);
  await page.waitForTimeout(7000);
  const reached = await snapshot();
  const gap = Math.hypot(reached.hero.x - foot.x, reached.hero.z - foot.z);
  const footMoved = Math.hypot(reached.hero.x - footStart.x, reached.hero.z - footStart.z);
  say('the carcass reaches a standable crag on foot', gap < 3 && footMoved > 1 && reached.shoulder?.kind === 'goat',
    `${gap.toFixed(1)} tiles from the ledge; walked ${footMoved.toFixed(1)} tiles`);
  await page.keyboard.press('Enter');
  await choose('Leave it for the eagles here');
  await page.locator('#dialogue .dlg-panel').click();
  const after = await snapshot();
  const answer = await page.locator('#dialogue .dlg-text').textContent();
  say('bait consumes the hauled body and the high country answers', after.shoulder === null && /eagle|bird|ledge|mountain|crag/i.test(answer ?? ''),
    (answer ?? '').slice(0, 110));
};
