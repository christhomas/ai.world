/** Choose a real thin rail, away from its gate and corners, with room for the mounted body. */
function chooseFenceApproach(
  yard, solid = globalThis.__solid, stands = globalThis.__mountClear,
  heightAt = (x, z) => globalThis.__player.ground.heightAt(x, z),
  crowd = globalThis.__entitiesFull(),
) {
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if ((yard.gate[0] - yard.x) * nx + (yard.gate[1] - yard.z) * nz === yard.half) continue;
    for (const along of [0, 1, -1]) {
      const x = yard.x + 0.5 + nx * yard.half - nz * along;
      const z = yard.z + 0.5 + nz * yard.half + nx * along;
      // Confirm the rail has arrived, is solid, and is thinner than a tile along our normal.
      if (!solid(x, z) || solid(x + nx * 0.55, z + nz * 0.55) ||
          solid(x - nx * 0.55, z - nz * 0.55)) continue;
      const ground = heightAt(x, z);
      if (ground === null) continue;
      // `yawFor(-nx, -nz)`: the model's length runs along x, not z.
      const yaw = Math.atan2(nz, -nx);
      let near = null, clear = true;
      for (let step = 3; step <= 25; step++) {
        const distance = step / 5;
        const px = x + nx * distance, pz = z + nz * distance;
        if (!stands(px, pz, yaw, ground)) {
          if (near !== null) { clear = false; break; }
          continue;
        }
        if (crowd.some((e) => !e.dead && e.role !== 'mount' && Math.hypot(e.x - px, e.z - pz) < 2)) {
          clear = false; break;
        }
        near ??= distance;
      }
      if (clear && near !== null && near <= 2.6) {
        return { x, z, nx, nz, near, yaw, start: { x: x + nx * 5, z: z + nz * 5 } };
      }
    }
  }
  return null;
}

/** Exercise the thin obstacle in the rendered game, and return the loan even if a driver fails. */
async function playFence(page, say, go, face, observedWalk) {
  const original = await page.evaluate(() => window.__mount().saved);
  // The nearest usable rail can be villages away. Whatever comes after this trial expects the hero
  // where it left him, so he is put back there: the hunt chooses its crag by distance from him.
  const home = await page.evaluate(() => ({ x: window.__player.x, z: window.__player.z }));
  // The first thing to go wrong is the one reported; cleanup that fails after it is only logged.
  let failure = null;
  try {
    const yards = await page.evaluate(() => {
      const p = window.__player;
      return window.__villages.filter((v) => v.stable)
        .sort((a, b) => Math.hypot(a.stable.x - p.x, a.stable.z - p.z) -
          Math.hypot(b.stable.x - p.x, b.stable.z - p.z))
        .slice(0, 6).map((v) => ({ ...v.stable, name: v.name }));
    });
    let fence = null;
    for (const yard of yards) {
      await go(yard.x + 0.5, yard.z + 0.5, 0);
      const loaded = await page.waitForFunction(({ x, z, half }) => {
        const p = window.__player;
        return p.placed && Math.hypot(p.x - x - 0.5, p.z - z - 0.5) < 1 &&
          (window.__solid(x + 0.5 + half, z + 0.5) || window.__solid(x + 0.5 - half, z + 0.5));
      }, yard, { timeout: 10000, polling: 100 }).then(() => true, () => false);
      if (!loaded) continue;
      await page.evaluate(() => window.__borrowHorse());
      const ray = await page.evaluate(chooseFenceApproach, yard);
      if (ray) { fence = { ...ray, name: yard.name }; break; }
    }
    say('a loaded thin paddock rail has a horse-sized runway', fence !== null,
      fence ? JSON.stringify(fence) : `no safe rail among ${yards.length} paddocks`);
    if (!fence) return;

    // Teleport clears the carrier. Take another loan only after the final move into position.
    await go(fence.start.x, fence.start.z, 0);
    await page.waitForFunction(() => window.__player.placed, null, { timeout: 10000 });
    await page.evaluate(() => window.__borrowHorse());
    await face(fence.x - fence.nx * 3, fence.z - fence.nz * 3);
    await page.waitForFunction(() => window.__mount().under < 0.1 && window.__player.placed,
      null, { timeout: 10000 });
    const before = await page.evaluate(() => window.__mount());
    say('the fence trial starts on a horse', before.riding && before.breed === 'horse' &&
      before.horse !== null && before.under < 0.1, JSON.stringify(before));
    if (!before.riding) return;

    await page.evaluate((rail) => {
      const trace = window.__fenceTrace = { frames: 0, mounted: true, minRider: Infinity, minHorse: Infinity };
      const sample = () => {
        const mount = window.__mount();
        const distance = (p) => (p.x - rail.x) * rail.nx + (p.z - rail.z) * rail.nz;
        trace.frames++;
        trace.mounted &&= mount.riding && mount.horse !== null && mount.under < 0.1;
        trace.minRider = Math.min(trace.minRider, distance(mount.hero));
        trace.minHorse = Math.min(trace.minHorse, mount.horse ? distance(mount.horse) : -Infinity);
        trace.frame = requestAnimationFrame(sample);
      };
      trace.frame = requestAnimationFrame(sample);
    }, fence);
    const pressed = await observedWalk('w', 5000);
    const after = await page.evaluate(() => window.__mount());
    const trace = await page.evaluate(() => {
      const trace = window.__fenceTrace;
      cancelAnimationFrame(trace.frame);
      return trace;
    });
    const moved = Math.hypot(after.hero.x - before.hero.x, after.hero.z - before.hero.z);
    const stopped = (after.hero.x - fence.x) * fence.nx + (after.hero.z - fence.z) * fence.nz;
    const outside = await page.evaluate(() => {
      const m = window.__mount();
      return !window.__solid(m.hero.x, m.hero.z) && m.horse !== null && !window.__solid(m.horse.x, m.horse.z);
    });
    say('a thin paddock rail stops both horse and rider', trace.frames > 0 && trace.mounted &&
      pressed.mounted === 'horse' && moved > 1 && stopped > 0 && stopped <= fence.near + 0.3 &&
      trace.minRider > 0 && trace.minHorse > 0 && outside,
      JSON.stringify({ moved, stopped, fence, pressed, trace, after }));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // Each step of tidying up is tried whatever the one before it did: every check after this one
    // needs the horse returned and the hero home. A stuck key is reported, as it always was; any
    // other cleanup failure is reported only when nothing went wrong before it, and logged if not.
    let stuckKey = null;
    const later = [];
    try { await page.keyboard.up('w'); } catch (error) { stuckKey = error; }
    try {
      await page.evaluate(() => {
        if (window.__fenceTrace) cancelAnimationFrame(window.__fenceTrace.frame);
        delete window.__fenceTrace;
        window.__returnHorse();
      });
      const restored = await page.evaluate(() => window.__mount().saved);
      say('the fence trial returns the original horse and cargo', JSON.stringify(restored) === JSON.stringify(original),
        JSON.stringify(restored));
    } catch (error) { later.push(error); }
    try {
      await go(home.x, home.z, 0);
      // The rail can be four hundred tiles from home (Elderford, once), and the country there has to
      // stream in again before he is placed; ten seconds was not always enough for that.
      await page.waitForFunction(({ x, z }) => window.__player.placed &&
        Math.hypot(window.__player.x - x, window.__player.z - z) < 1, home, { timeout: 60000, polling: 100 });
    } catch (error) { later.push(error); }
    if (stuckKey || failure) {
      for (const error of later) console.error('the fence trial could not also tidy up after itself:', error);
      if (stuckKey) throw stuckKey;
    } else if (later.length) {
      for (const error of later.slice(1)) console.error('the fence trial could not also tidy up after itself:', error);
      throw later[0];
    }
  }
}

module.exports = { chooseFenceApproach, playFence };
