import { GameState } from '../../src/game/state';
import { Entity, Herd, tryMove, type TileWorld } from '../../src/entities/entity';
import { KINDS } from '../../src/entities/animals';
import { MODELS } from '../../src/entities/models';
import { cycleTurn } from '../../src/entities/motion';
import { Solids } from '../../src/world/solids';
import { buildChunkMesh } from '../../src/world/mesher';
import type { ChunkData } from '../../src/world/ground';
import { mulberry32 } from '../../src/core/rng';
import { RequestGate } from '../../shared/mobile/host-contract';
import { encodeScalars, decodeScalars } from '../../shared/mobile/binary';
import { worldWorkload } from './world-workload';
import { sceneWorkload } from './scene-workload';
import { chunkWorkload } from './chunk-workload';
import { peerWorkload } from './peer-workload';
import { keepingWorkload } from './keeping-workload';

declare const host: { now(): number; uuid(): string; echo(bytes: ArrayBuffer): ArrayBuffer; report(text: string): void };
const root = globalThis as typeof globalThis & { crypto: { randomUUID(): `${string}-${string}-${string}-${string}-${string}` } };
root.crypto = { randomUUID: () => host.uuid() as `${string}-${string}-${string}-${string}-${string}` } as Crypto;
function insist(yes: unknown, why: string): asserts yes { if (!yes) throw new Error(why); }
function hash(text: string): string {
  let n = 2166136261; for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return (n >>> 0).toString(16).padStart(8, '0');
}
function chunk(): ChunkData {
  const size = 18, n = size * size, height = new Float32Array(n), corners = new Float32Array(n * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const at = z * size + x, y = z < size / 2 ? 1 : 0;
    height[at] = y; corners.fill(y, at * 4, at * 4 + 4);
  }
  return { cx: 0, cz: 0, size, height, corners, type: new Uint8Array(n).fill(2), biome: new Uint8Array(n), prop: new Uint8Array(n), propRot: new Float32Array(n).fill(NaN), shore: new Float32Array(n), sloped: new Uint8Array(n), water: new Float32Array(n), empty: false };
}
export async function run(): Promise<Record<string, unknown>> {
  const started = host.now();
  const chunkHash = chunkWorkload(chunk(), hash);
  insist(typeof window === 'undefined' && typeof document === 'undefined', 'browser globals forbidden');
  const bridge = encodeScalars([1 / 3, Number.MAX_SAFE_INTEGER, 1e-200]);
  const bridgeStart = host.now(); const echoed = host.echo(bridge);
  insist(JSON.stringify(decodeScalars(echoed)) === JSON.stringify(decodeScalars(bridge)), 'native binary copy loses precision');
  const bridgeMs = host.now() - bridgeStart;
  const golden = encodeScalars([0, -0.5, 1]);
  const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  const goldenHex = '4d574941010008000300000000000000' + '0000000000000000' + '000000000000e0bf' + '000000000000f03f';
  insist(hex(golden) === goldenHex, 'binary golden layout mismatch');
  const copiedGolden = host.echo(golden);
  insist(copiedGolden !== golden && hex(copiedGolden) === goldenHex, 'native must return independent owned bytes');
  new Uint8Array(golden).fill(0);
  insist(hex(copiedGolden) === goldenHex, 'native retained borrowed source bytes');
  let invalidBufferRejected = false;
  try { host.echo(null as unknown as ArrayBuffer); } catch { invalidBufferRejected = true; }
  insist(invalidBufferRejected, 'native buffer precondition missing');
  let microtasks = 0; await Promise.resolve().then(() => microtasks++); insist(microtasks === 1, 'microtasks not delivered');
  let errorCaught = false; try { throw new Error('Ólafur 雪 🐺'); } catch (e) { errorCaught = (e as Error).message === 'Ólafur 雪 🐺'; }
  insist(errorCaught, 'UTF-8 exception mismatch');
  const cycleHashes: string[] = [], stepTimes: number[] = [];
  let geometryHash = '', blockedSteps = 0, movedSteps = 0, meshBytes = 0;
  for (let cycle = 0; cycle < 10; cycle++) {
    const state = GameState.fresh(); state.playerId = '00000000-0000-4000-8000-000000000001';
    state.give('sword'); insist(state.equip('sword')?.id === 'sword', 'equipment action failed');
    insist(state.count('sword') === 0 && state.worn('hand')?.id === 'sword', 'equipment inventory mismatch');
    const kind = KINDS.villager; insist(kind, 'real villager kind missing');
    const e = new Entity(kind, -3, 0, new Herd(kind, -3, 0, -3, 0, 0), 'spike', mulberry32(1)); e.y = 1;
    const solids = new Solids(); solids.put('wall', [{ x: 0, z: 0, hw: 0.5, hd: 5, rot: 0, high: 3 }]);
    const world: TileWorld = { heightAt: () => 1, waterAt: () => null, isRoad: () => true, blocked: (x, z, b) => solids.at(x, z, b), crosses: (x, z, nx, nz, b) => solids.crosses(x, z, nx, nz, b), depth: (x, z, b) => solids.depth(x, z, b) };
    const gate = new RequestGate(`spike:${cycle}`);
    gate.accept({ version: 1, session: `spike:${cycle}`, sequence: 0, id: 'start', type: 'start', payload: { mode: 'local', world: 'spike' } });
    for (let tick = 0; tick < 2000; tick++) {
      const before = host.now();
      gate.accept({ version: 1, session: `spike:${cycle}`, sequence: tick + 1, id: `tick:${tick}`, type: 'step', payload: { tick, dtSeconds: 1 / 60, renderTimeMs: tick * 1000 / 60, input: { move: [1, 0], look: [0, 0], held: { guard: false, run: false }, actions: [], owner: 'WORLD', busy: null } } });
      state.tick(1 / 60); if (tryMove(world, e, 0.05, 0)) movedSteps++; else blockedSteps++;
      e.phase += 1 / 60; e.walk = 1;
      if (cycle === 0) stepTimes.push(host.now() - before);
    }
    insist(e.x < -0.5 && e.x > -3, 'collision must move then stop at wall');
    const mesh = await Promise.resolve().then(() => buildChunkMesh(chunk(), 1));
    insist(mesh.land && mesh.land.indices.length > 0, 'actual terrain mesh empty');
    meshBytes = mesh.land.positions.byteLength + mesh.land.normals.byteLength + mesh.land.colors.byteLength + mesh.land.indices.byteLength;
    const poses = MODELS.villager.map(part => ({ shape: part.shape, offset: part.offset, turn: cycleTurn(part.anim, e).map(n => Math.round(n * 1e6) / 1e6) }));
    geometryHash = hash(JSON.stringify({ positions: Array.from(mesh.land.positions), normals: Array.from(mesh.land.normals), colors: Array.from(mesh.land.colors), indices: Array.from(mesh.land.indices), poses }));
    const saved = state.toJSON(); delete saved.savedAt;
    const restored = GameState.from(JSON.parse(JSON.stringify(saved))); const roundTrip = restored.toJSON(); delete roundTrip.savedAt;
    insist(JSON.stringify(saved) === JSON.stringify(roundTrip), 'real save restore mismatch');
    cycleHashes.push(hash(JSON.stringify({ state: saved, x: e.x, z: e.z })));
    gate.accept({ version: 1, session: `spike:${cycle}`, sequence: 2001, id: 'dispose', type: 'dispose', payload: {} });
    solids.drop('wall');
  }
  insist(new Set(cycleHashes).size === 1, 'create/dispose cycles diverge');
  insist(movedSteps > 0 && blockedSteps > 0, 'collision fixture must exercise both outcomes');
  stepTimes.sort((a, b) => a - b);
  const worldHash = hash(worldWorkload());
  const sceneHash = sceneWorkload(hash);
  const keepingHash = hash(await keepingWorkload());
  const peerHash = hash(peerWorkload());
  return { contractVersion: 1, stepsPerCycle: 2000, cycles: 10, stateHash: cycleHashes[0], geometryHash, worldHash, sceneHash, chunkHash, peerHash, keepingHash, movedSteps, blockedSteps, meshBytes, microtasks, utf8: 'Ólafur 雪 🐺', goldenHex, invalidBufferRejected, bridgeMs, stepP95Ms: stepTimes[Math.floor(stepTimes.length * 0.95)], totalMs: host.now() - started };
}
