// GitHub-only proof (#563): the whole game, bundled exactly as the installed apps bundle it, played
// in a bare JavaScript context with no browser and no Node: no window, no timers, no performance
// clock, no structuredClone, no require. What it has is what QuickJS and JavaScriptCore have.
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { jobThread } from './job-thread.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await build({ configFile: false, logLevel: 'warn',
  define: { __GAME_NAME__: JSON.stringify('AI World'), __GAME_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', minify: false, outDir: 'mobile-frame-proof-out', emptyOutDir: false,
    lib: { entry: 'src/mobile/game-engine.ts', name: 'AiWorldGameEngine', formats: ['iife'], fileName: () => 'game.js' } } });
const source = await readFile('mobile-frame-proof-out/game.js', 'utf8');
await build({ configFile: false, logLevel: 'warn',
  build: { target: 'es2022', minify: false, outDir: 'mobile-frame-proof-out', emptyOutDir: false,
    lib: { entry: 'src/mobile/job-engine.ts', name: 'AiWorldJobEngine', formats: ['iife'], fileName: () => 'jobs.js' } } });
const jobSource = await readFile('mobile-frame-proof-out/jobs.js', 'utf8');
let jobs = await jobThread(jobSource);

// the one thing both native hosts put in the engine's context before the bundle: identifiers from
// the platform's own secure randomness (state_engine.c, StateEngineBridge.swift)
const bare = { crypto: { randomUUID: () => randomUUID() } };
const call = (code) => runInNewContext(code, bare, { timeout: 120000 });
for (const name of ['window', 'document', 'setTimeout', 'performance', 'structuredClone', 'process', 'require', 'Worker', 'WebSocket']) {
  assert.equal(runInNewContext(`typeof ${name}`, {}), 'undefined', `${name} exists in a bare context`);
}
const loaded = performance.now();
call(source);
const loadMs = performance.now() - loaded;

const session = 'bare-game';
bare.__options = JSON.stringify({ seed: 3, kind: 'road', slot: 'bare', name: 'Rowan', viewport: { width: 1200, height: 540 }, jobs: 'host' });
call(`globalThis.engine = AiWorldGameEngine.create(${JSON.stringify(session)}, __options)`);

let sequence = 0;
let tick = -1;
let time = 0;
const stepTimes = [];
// where the engine's time went, by kind of job, as the game last said (#559)
let work = {};
// what the app keeps of the private world, as the replies hand it over
const worldRecords = {};
let requestsWhileMeshing = 0;
const ask = (type, payload, engine = 'engine', id = session) => {
  if (jobs.pendingMeshes) requestsWhileMeshing++;
  const replies = jobs.take();
  if (replies) { bare.__jobs = replies; call(`${engine}.deliverJobs(__jobs)`); }
  bare.__request = JSON.stringify({ version: 1, session: id, sequence, id: `r${sequence}`, type, payload });
  sequence++;
  const reply = JSON.parse(call(`${engine}.request(__request)`));
  assert.equal(reply.requestId, `r${sequence - 1}`);
  if (reply.type !== 'result') throw new Error(`${type} failed: ${JSON.stringify(reply.payload)}`);
  jobs.send(reply.jobs);
  if (reply.payload.state?.models?.world) Object.assign(worldRecords, reply.payload.state.models.world);
  return reply.payload.state;
};
// an app's engine runs what was promised once the request returns; here that is the event loop's turn
const settle = () => new Promise((resume) => setTimeout(resume, 16));
const still = { move: [0, 0], look: [0, 0], held: { guard: false, run: false }, actions: [], owner: 'WORLD', busy: null };
const step = async (input = {}, ms = 1000 / 30) => {
  tick++;
  time += ms;
  const began = performance.now();
  const state = ask('step', { tick, dtSeconds: ms / 1000, renderTimeMs: time, input: { ...still, ...input } });
  if (state.models.perf) work = state.models.perf.jobs;
  stepTimes.push(performance.now() - began);
  await settle();
  return state;
};
const sceneNow = async () => {
  ask('resync', { reason: 'scene' });
  const state = await step();
  assert.ok(state.models.scene, 'a scene was asked for and none came');
  return state.models.scene;
};

// how long opening a world takes here, with a JIT, is the yardstick the phones' engines are held to
const starting = performance.now();
const opened = ask('start', { mode: 'local', world: 'bare' });
const startMs = performance.now() - starting;
assert.equal(opened.owner, 'WORLD');
await settle();

// the world in this engine answers and the ground arrives, a budget of geometry at a time
// held as an app holds it: what arrives is kept, and what the engine says has left the scene is let go
const geometries = new Set();
const nodes = new Map();
let nodeOrder = [];
let sceneGeneration = 0;
let sent = 0;
let released = 0;
let nodeChanges = 0;
const nodeKey = (node) => node.part === undefined ? `${node.id}` : `${node.id}.${node.part}`;
const hold = (scene) => {
  assert.equal(scene.version, 1);
  assert.equal(scene.generation, sceneGeneration + 1, 'the app receives contiguous scene generations');
  sceneGeneration = scene.generation;
  if (scene.full) { nodes.clear(); geometries.clear(); nodeOrder = []; }
  for (const id of Object.keys(scene.geometries)) { geometries.add(id); sent++; }
  for (const key of scene.removed) assert.ok(nodes.delete(key), `unknown removed node ${key}`);
  for (const node of scene.frame.nodes) nodes.set(nodeKey(node), node);
  for (const change of scene.changes) {
    const key = nodeKey(change);
    assert.ok(nodes.has(key), `unknown changed node ${key}`);
    nodes.set(key, { ...nodes.get(key), ...change });
    nodeChanges++;
  }
  nodeOrder = scene.order ?? nodeOrder;
  assert.equal(nodeOrder.length, nodes.size);
  assert.equal(new Set(nodeOrder).size, nodes.size);
  const parents = new Set();
  for (const key of nodeOrder) {
    const node = nodes.get(key);
    assert.ok(node, `missing ordered node ${key}`);
    if (node.parent !== null) assert.ok(parents.has(node.parent), `missing parent ${node.parent}`);
    parents.add(key);
    if (node.geometryId) {
      assert.ok(geometries.has(node.geometryId), `${node.geometryId} named but not held`);
      assert.ok(!scene.released.includes(node.geometryId), `${node.geometryId} released while live`);
    }
  }
  for (const id of scene.released) { assert.ok(geometries.delete(id), `${id} released but never held`); released++; }
};
let meshes = 0;
let packetBytes = 0;
const arriving = performance.now();
for (let round = 0; round < 200 && meshes < 40; round++) {
  for (let n = 0; n < 15; n++) await step();
  const scene = await sceneNow();
  hold(scene);
  packetBytes = Math.max(packetBytes, JSON.stringify(scene).length);
  meshes = [...nodes.values()].filter((node) => node.kind === 'mesh').length;
}
const groundMs = performance.now() - arriving;
const scene = await sceneNow();
hold(scene);
const kinds = new Set([...nodes.values()].map((node) => node.kind));
assert.ok(meshes >= 40, `only ${meshes} meshes arrived`);
for (const kind of ['mesh', 'directional', 'ambient']) assert.ok(kinds.has(kind), `no ${kind} in the frame`);

// a thumb on the stick walks him
let state = await step();
const from = state.models.hero;
const beforeWalkingChanges = nodeChanges;
for (let n = 0; n < 45; n++) state = await step({ move: [0, 1] });
hold(await sceneNow());
assert.ok(nodeChanges > beforeWalkingChanges, 'walking produces node changes instead of complete records');
state = await step();
const walked = Math.hypot(state.models.hero.x - from.x, state.models.hero.z - from.z);
assert.ok(walked > 1, `the hero walked ${walked} tiles from ${JSON.stringify(from)} to ${JSON.stringify(state.models.hero)}`);

// the pack opens as a book and takes the controls, and closing it gives them back
state = ask('action', { action: 'inventory', target: null, args: null });
assert.equal(state.owner, 'BOOK');
state = ask('action', { action: 'close', target: null, args: null });
assert.equal(state.owner, 'WORLD');

// a save comes back to the app to keep: with the very reply that asked for it when the store writes
// at once, or with the next reply when the write finishes after the request has returned
const asked = ask('resync', { reason: 'save' });
await settle();
state = await step();
const save = asked.models.save ?? state.models.save;
assert.ok(save, 'the game saved nothing');
assert.equal(save.state.playerId, state.models.hero.playerId);

const left = state.models.hero;
ask('dispose', {});
assert.ok(requestsWhileMeshing > 0, 'no game request completed while ground was still on its own thread');
const completedJobs = jobs.completed;
await jobs.close();
assert.ok(Object.keys(worldRecords).length > 0, 'the private world kept nothing for the app to keep');

// and the app opens it again from what it kept: the save, and the world's own records
bare.__continued = JSON.stringify({ seed: 3, kind: 'road', slot: 'bare', name: 'Rowan', viewport: { width: 1200, height: 540 },
  saved: save, world: worldRecords, jobs: 'host' });
jobs = await jobThread(jobSource);
call(`globalThis.again = AiWorldGameEngine.create('bare-again', __continued)`);
sequence = 0;
tick = -1;
time = 0;
const resumed = ask('start', { mode: 'local', world: 'bare' }, 'again', 'bare-again');
assert.equal(resumed.models.hero.playerId, left.playerId, 'a continued game is the same hero');
assert.ok(Math.hypot(resumed.models.hero.x - left.x, resumed.models.hero.z - left.z) < 0.5,
  `continued at ${JSON.stringify(resumed.models.hero)}, left at ${JSON.stringify(left)}`);
ask('dispose', {}, 'again', 'bare-again');
await jobs.close();

const sorted = [...stepTimes].sort((a, b) => a - b);
const evidence = {
  sourceSha: process.env.GAME_SOURCE_SHA, bundleBytes: source.length, loadMs: Math.round(loadMs),
  startMs: Math.round(startMs), groundMs: Math.round(groundMs), jobs: work,
  jobBundleBytes: jobSource.length, completedJobs, requestsWhileMeshing,
  steps: stepTimes.length, stepMedianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
  stepP95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), meshes, geometriesSent: sent,
  geometriesHeld: geometries.size, geometriesReleased: released,
  largestScenePacketBytes: packetBytes, nodeChanges, sceneGeneration, walked: +walked.toFixed(2),
  worldRecords: Object.keys(worldRecords).length, continuedAt: resumed.models.hero,
};
await writeFile('mobile-frame-proof-out/game-proof.json', JSON.stringify(evidence, null, 2) + '\n');
console.log('The whole game ran in a bare host from the app bundle:', JSON.stringify(evidence));
