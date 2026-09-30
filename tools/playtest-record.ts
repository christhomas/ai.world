/*
 * The whole game, played with nothing drawn, to show that what it submits is a description and not
 * a three.js scene.
 *
 * `?record-only` keeps the entire game loop and swaps its one frame sink for the recording pipeline:
 * no WebGL draw is issued, and the frame the engine hands over is written down instead. That is the
 * seam #249 is about — the web client and the Flutter client fed the same description — and until
 * this ran, the only proof it held was a frame somebody had written by hand for a Dart test. Nothing
 * had ever played the game this way outside the Flutter feed, which nobody runs in a pipeline.
 *
 * So this plays it: the square of a village, the inside of a shop, a shrine and the dungeon floor
 * beneath it, and a boat out on the sea. In each it asks for a frame and checks three things — that
 * one arrives, that JSON carries it without losing anything (a NaN is `null` on the other side, a
 * Map is `{}`), and that it expands into the packet the Flutter feed would send. The packets are
 * written out, and one of them is the fixture `client/flutter/test/scene_frame_test.dart` draws, so
 * the Dart side is held to what this game really submits rather than to what a test assumed.
 *
 * It uses the same probes the screenshots do — `__enterShop`, `__enterShrine`, `__descend`,
 * `__sailing` — because a place the probes cannot reach is a place a player has to walk to, and a
 * walk is `playtest.cjs`'s job rather than this one's.
 *
 *   chore playtest-record       # serves the page, plays it, and stops the server again
 *
 *   PORT=5173 SEED=3 WORLD=road   the address, assembled
 *   CHANNEL=chrome                use system Chrome instead of installed Chromium
 *   OUT=...                       the account of the run, in docs/reports/ by default
 *   FRAMES=...                    where each place's packet is written, beside it by default
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameDescription } from '../src/core/scene';
import { disposeFlutterFrameGeometry } from '../src/render/flutter-frame';
import { flutterPacket, plainArrays, type FlutterPacket } from '../server/flutter-packet';
import { reportAt } from './reports';

const PORT = process.env.PORT || '5173';
const SEED = process.env.SEED || '3';
// The road country, which is the one the reference pictures of the shop, the dungeon and the boat
// are taken in: every place below is known to be reachable there on seed 3.
const WORLD = process.env.WORLD || 'road';
const ADDRESS = `http://localhost:${PORT}/?world=${WORLD}&seed=${SEED}&record-only=1`;
const CHANNEL = process.env.CHANNEL ?? '';
const OUT = process.env.OUT || reportAt('record-only-report.txt');
const FRAMES = process.env.FRAMES || reportAt('record-only');
mkdirSync(FRAMES, { recursive: true });

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const errs: string[] = [];
const say = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

/*
 * The page server, if nobody else is already running one. Lifted from `playtest.cjs`, detached
 * process group and all: killing only the `pnpm` leaves vite holding the port for the next run.
 */
let ours: ChildProcess | null = null;
let browser: Browser | null = null;
const origin = new URL(ADDRESS).origin;
const answering = async (): Promise<boolean> => {
  try { return (await fetch(origin, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
};
const stopServing = (): void => {
  if (!ours?.pid) return;
  try { process.kill(-ours.pid, 'SIGTERM'); } catch { /* it beat us to it */ }
  ours = null;
};
const startServing = async (): Promise<void> => {
  if (await answering()) { console.log(`playing against the server already on ${origin}`); return; }
  console.log(`nothing on ${origin} — starting one`);
  ours = spawn('pnpm', ['vite', '--port', PORT, '--strictPort'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await answering()) return;
  }
  throw new Error(`no page server answered on ${origin} after a minute`);
};
process.on('exit', stopServing);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopServing(); process.exit(130); });

const finish = async (): Promise<void> => {
  // A page error fails the run even when every place answered: a game that throws while it records
  // is a game whose next frame nobody can vouch for.
  say('the page threw nothing while it played', errs.length === 0, errs.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.ok).length;
  const errors = errs.length ? 'PAGE ERRORS: ' + errs.slice(0, 3).join(' | ') : 'no page errors';
  const tally = `${results.length - bad}/${results.length} passed`;
  writeFileSync(OUT, [
    'The game, played with nothing drawn.',
    '',
    `page     ${ADDRESS}`,
    `browser  ${CHANNEL || "playwright's own chromium"}`,
    `frames   ${FRAMES}`,
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
  process.exitCode = bad > 0 || results.length <= 1 ? 1 : 0;
  disposeFlutterFrameGeometry();
  if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  stopServing();
};

/** Where in a value JSON would drop or change something, as paths; empty when it carries it all. */
function lossesIn(value: unknown, path = '$', found: string[] = []): string[] {
  if (found.length >= 5) return found;
  if (typeof value === 'number') { if (!Number.isFinite(value)) found.push(`${path} is ${value}`); return found; }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return found;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    found.push(`${path} is a ${typeof value}`);
    return found;
  }
  if (ArrayBuffer.isView(value)) {
    for (const [at, n] of Array.from(value as Float32Array).entries()) {
      if (!Number.isFinite(n)) { found.push(`${path}[${at}] is ${n}`); break; }
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, at) => lossesIn(item, `${path}[${at}]`, found));
    return found;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    found.push(`${path} is a ${Object.prototype.toString.call(value)}`);
    return found;
  }
  // An absent optional field and one set to undefined are the same thing to the other side.
  for (const [key, item] of Object.entries(value)) if (item !== undefined) lossesIn(item, `${path}.${key}`, found);
  return found;
}

interface Sample { raw: string | null; drawn: number; lost: string[] }

/**
 * The next frame the game submits, as the feed takes it: stringified in the page, typed arrays as
 * plain ones. The replacer also notes anything JSON would quietly lose on the way, because once it
 * is a string the loss has already happened and cannot be seen from outside.
 *
 * No named functions inside: `tsx` wraps those in a helper that does not exist in the page.
 */
const capture = (page: Page): Promise<Sample> => page.evaluate(async () => {
  const recording = (window as unknown as { __recording: {
    frames: number; last: FrameDescription | null; captureNext(): void;
  } }).__recording;
  const before = recording.frames;
  recording.last = null;
  recording.captureNext();
  const deadline = performance.now() + 15000;
  while (!recording.last && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  if (!recording.last) return { raw: null, drawn: recording.frames - before, lost: [] };
  const lost: string[] = [];
  const raw = JSON.stringify(recording.last, function (this: unknown, key: string, value: unknown) {
    if (ArrayBuffer.isView(value)) {
      const numbers = Array.from(value as Float32Array);
      if (numbers.some((n) => !Number.isFinite(n))) lost.push(`${key} holds a non-finite number`);
      return numbers;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) lost.push(`${key} is ${value}`);
    else if (typeof value === 'function' || typeof value === 'symbol') lost.push(`${key} is a ${typeof value}`);
    else if (typeof value === 'bigint') { lost.push(`${key} is a bigint`); return String(value); }
    else if (value === undefined && Array.isArray(this)) lost.push(`[${key}] is undefined`);
    else if (value instanceof Map || value instanceof Set || value instanceof Date) {
      lost.push(`${key} is a ${Object.prototype.toString.call(value)}`);
    }
    return value;
  });
  return { raw, drawn: recording.frames - before, lost: lost.slice(0, 5) };
});

/** What a packet holds, in a line: its nodes by kind and the size of it on the wire. */
const tallyOf = (packet: FlutterPacket, bytes: number): string => {
  const kinds = new Map<string, number>();
  for (const node of packet.frame.nodes) kinds.set(String(node.kind), (kinds.get(String(node.kind)) ?? 0) + 1);
  const listed = [...kinds].sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind}×${n}`).join(' ');
  return `${listed}; ${Object.keys(packet.geometries).length} geometries; ${(bytes / 1024).toFixed(0)} KiB`;
};

/**
 * One place, sampled: a frame arrives, JSON carries it whole, and it becomes a Flutter packet that
 * JSON also carries whole. Returns the recorded frame so the caller can ask what is in it.
 */
const sample = async (page: Page, place: string): Promise<FrameDescription | null> => {
  const got = await capture(page);
  say(`${place}: the game submits a frame with nothing drawn`, got.raw !== null,
    got.raw === null ? `no frame in fifteen seconds; ${got.drawn} submitted meanwhile` : `${got.drawn} submitted while waiting`);
  if (got.raw === null) return null;
  const recorded = JSON.parse(got.raw) as FrameDescription;
  const again = JSON.stringify(recorded);
  say(`${place}: the recorded frame survives a JSON round trip`, got.lost.length === 0 && again === got.raw,
    got.lost.length ? got.lost.join('; ') : again === got.raw ? `${recorded.nodes.length} nodes` : 'parsed and restringified differently');
  let packet: FlutterPacket;
  try { packet = flutterPacket(recorded); }
  catch (error) {
    say(`${place}: it expands into the packet the Flutter feed sends`, false, error instanceof Error ? error.message : String(error));
    return recorded;
  }
  const wire = JSON.stringify(packet, plainArrays);
  const lost = lossesIn(packet);
  const batches = packet.frame.nodes.filter((node) => node.kind === 'prop-batch').length;
  say(`${place}: it expands into the packet the Flutter feed sends`,
    lost.length === 0 && batches === 0 && JSON.stringify(JSON.parse(wire)) === wire,
    lost.length ? lost.join('; ') : batches ? `${batches} prop batches left unexpanded` : tallyOf(packet, wire.length));
  writeFileSync(join(FRAMES, `${place}.json`), wire);
  return recorded;
};

(async () => {
  await startServing();
  browser = await chromium.launch({ headless: true, channel: CHANNEL || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.on('pageerror', (e) => errs.push(e.message));
  // A page with no WebGL to be had, which is where a record-only game has to be able to run (#529):
  // every ask for a WebGL context is counted and refused, and the checks below still need frames.
  await page.addInitScript(() => {
    const w = window as unknown as { __webglAsked: number };
    w.__webglAsked = 0;
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (/webgl/i.test(kind)) {
        w.__webglAsked++;
        throw new Error(`no ${kind} in a record-only run`);
      }
      return (context as (kind: string, ...rest: unknown[]) => RenderingContext | null).call(this, kind, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto(ADDRESS, { waitUntil: 'load' });
  const ready = await page.waitForFunction(() => {
    const w = window as unknown as { __world?: { online?: string }; __recording?: unknown; __teleport?: unknown };
    return w.__world?.online === 'online' && w.__recording !== undefined && typeof w.__teleport === 'function';
  }, null, { timeout: 180000, polling: 250 }).then(() => true, () => false);
  if (!ready) {
    say('the world in this tab answered with a recorder attached', false,
      JSON.stringify(await page.evaluate(() => (window as unknown as { __world?: unknown }).__world ?? null).catch(() => null)));
    await finish();
    return;
  }
  // Frames at all, before any place is asked for one: the loop runs and every draw reaches the
  // recorder, which counts them whether or not it was asked to keep one.
  const counted = () => page.evaluate(() => (window as unknown as { __recording: { frames: number } }).__recording.frames);
  const first = await counted();
  await page.waitForTimeout(2000);
  const second = await counted();
  say('the game loop keeps submitting frames', second > first, `${second - first} in two seconds`);
  // And the recorder is the only pipeline mounted, which is the claim this run exists to make. No
  // WebGL renderer is built in this mode at all (#529): the page was refused every context it asked
  // for, and asked for none. The draw count is kept as well, a live mount would have drawn every one
  // of the frames just counted (#249).
  const asked = await page.evaluate(() => (window as unknown as { __webglAsked: number }).__webglAsked);
  say('the game asked for no WebGL context, and ran without one', asked === 0, `${asked} asked for`);
  const drawnByWebGL = () => page.evaluate(() => (window as unknown as { __rig: { lastFrame(): { draws: number } } }).__rig.lastFrame().draws);
  const webgl = await drawnByWebGL();
  say('the WebGL renderer drew nothing while the recorder took the frames', webgl === 0, `${webgl} draw calls in its last frame`);

  type Probe = Record<string, (...args: never[]) => unknown>;
  const ask = <T>(fn: (w: Probe) => T): Promise<T> =>
    page.evaluate(`(${fn.toString()})(window)`) as Promise<T>;
  const place = () => ask((w) => String(w.__place()));

  // --- the surface: the middle village, once its ground has arrived ---
  const village = await ask((w) => {
    const all = (w as unknown as { __villages: Array<{ name: string; x: number; z: number }> }).__villages;
    return [...all].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0] ?? null;
  });
  if (village) await page.evaluate(([x, z]) => (window as unknown as { __teleport(x: number, z: number): void }).__teleport(x, z), [village.x, village.z]);
  // Settled or not, the frame is sampled: a half-streamed country is still a frame, and a wait that
  // failed here would hide whether the recorder works behind whether the ground arrived in time.
  const settled = await page.waitForFunction(() => {
    const state = (window as unknown as { __shotChunks?: () => { loaded: number; desired: number; pending: number } }).__shotChunks?.();
    return state && state.loaded >= Math.min(40, state.desired) && state.pending === 0;
  }, null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
  await page.waitForTimeout(3000);
  const surface = await sample(page, 'surface');
  if (surface) {
    const meshes = surface.nodes.filter((node) => node.kind === 'mesh' || node.kind === 'prop-batch').length;
    const sun = surface.nodes.some((node) => node.kind === 'directional');
    say('surface: the village is ground, props and a sun', (await place()) === 'surface' && meshes > 0 && sun,
      `${village?.name ?? 'no village'}; ground ${settled ? 'settled' : 'still streaming'}; ${meshes} meshes and batches; sun ${sun}`);
  }

  // --- an interior: the general store, and out again ---
  const shop = await ask((w) => w.__enterShop('store' as never));
  await page.waitForTimeout(3000);
  const inside = await place();
  say('interior: the probe puts the hero inside a shop', shop !== null && inside !== 'surface', `${shop} — ${inside}`);
  if (inside !== 'surface') await sample(page, 'interior');
  await ask((w) => w.__leaveShop());
  await page.waitForTimeout(2000);

  // --- a dungeon: the shrine, and the floor below it ---
  await ask((w) => w.__enterShrine());
  await page.waitForTimeout(3000);
  const shrine = await place();
  say('dungeon: the probe puts the hero inside a shrine', shrine !== 'surface', shrine);
  if (shrine !== 'surface') {
    await ask((w) => w.__descend());
    await page.waitForTimeout(4000);
    const floor = await ask((w) => (w.__floor() as { floor?: number } | null)?.floor ?? null);
    say('dungeon: and down a floor', floor !== null, `floor ${floor} — ${await place()}`);
    await sample(page, 'dungeon');
    await ask((w) => w.__climbOut());
    await page.waitForTimeout(3000);
  }

  // --- the sea: a boat of our own, rowed off a mainland jetty ---
  /*
   * Bought through the probe rather than the boatwright. The dialogue is the screenshot's to
   * play — `shots.cjs sea` presses every key of it — and a ferry that happens to be docked makes
   * it a timetable puzzle that has nothing to do with whether a sea can be recorded.
   */
  const pier = await ask((w) => {
    const piers = (w as unknown as { __piers?: Array<{ side?: string; dockX: number; dockZ: number; dx: number; dz: number }> }).__piers ?? [];
    const one = piers.find((p) => p.side === 'mainland') ?? piers[0];
    return one ? { x: one.dockX + 0.5, z: one.dockZ + 0.5, boat: [one.dockX + 0.5 + one.dx, one.dockZ + 0.5 + one.dz, Math.atan2(-one.dz, one.dx)] } : null;
  });
  const out = await place();
  if (!pier || out !== 'surface') say('sea: a mainland jetty to put out from', false, pier ? `still in ${out}` : 'this world raised no pier');
  else {
    await page.evaluate(([x, z]) => (window as unknown as { __teleport(x: number, z: number): void }).__teleport(x, z), [pier.x, pier.z]);
    await page.waitForTimeout(4000);
    await page.evaluate(([x, z, yaw]) => {
      const sailing = (window as unknown as { __sailing: { buy(x: number, z: number, yaw: number): void; board(): void } }).__sailing;
      sailing.buy(x, z, yaw);
      sailing.board();
    }, pier.boat);
    await page.keyboard.down('w');
    await page.waitForTimeout(3000);
    await page.keyboard.up('w');
    await page.waitForTimeout(1000);
    const afloat = await page.evaluate(() => (window as unknown as { __sailing: { sailing: boolean } }).__sailing.sailing);
    const sea = await sample(page, 'sea');
    const water = sea?.nodes.some((node) => node.material?.intent === 'water') ?? false;
    say('sea: the hero is afloat and the frame has water in it', afloat && water,
      `afloat ${afloat}; water ${water}; coast field ${sea?.coast ? `${sea.coast.size}²` : 'none'}`);
  }

  // every place above swapped the graph being drawn, and a swap is where a second mount could slip in
  const after = await drawnByWebGL();
  say('and drew nothing in any of the places either', after === 0, `${after} draw calls in its last frame`);
  await finish();
})().catch(async (e: unknown) => {
  say('the record-only playtest ran to the end', false, (e instanceof Error && e.message) || String(e));
  await finish();
});
