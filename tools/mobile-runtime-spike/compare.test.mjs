import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'spike-comparison-'));
const reference = { sourceHash: 'abcdef00', contractVersion: 1, stepsPerCycle: 2000, cycles: 10, stateHash: '123', geometryHash: '456', movedSteps: 1, blockedSteps: 1999, meshBytes: 1024, microtasks: 1, utf8: 'Ólafur 雪 🐺', goldenHex: 'golden', invalidBufferRejected: true };
const a = join(directory, 'reference.json'), b = join(directory, 'candidate.json');
writeFileSync(a, JSON.stringify(reference));
function compare(candidate) { writeFileSync(b, JSON.stringify(candidate)); return spawnSync(process.execPath, ['tools/mobile-runtime-spike/compare.mjs', a, b]); }
test('same deterministic results pass despite independent native timings', () => assert.equal(compare({ ...reference, totalMs: 999 }).status, 0));
test('every deterministic field is checked, including actual collision and geometry evidence', () => {
  for (const field of Object.keys(reference).filter(k => k !== 'sourceHash')) assert.notEqual(compare({ ...reference, [field]: null }).status, 0, field);
});
test('all native cycles must complete both workloads with matching source and state', () => {
  const nativeCycles = Array.from({ length: 20 }, (_, i) => ({ nativeCycle: Math.floor(i / 2), phase: i % 2 ? 'recovered' : 'initial', sourceHash: 'abcdef00', workload: reference }));
  assert.equal(compare({ nativeCycles }).status, 0);
  assert.notEqual(compare({ nativeCycles: nativeCycles.slice(1) }).status, 0);
  assert.notEqual(compare({ nativeCycles: nativeCycles.map((r, i) => i === 19 ? { ...r, sourceHash: 'changed' } : r) }).status, 0);
  assert.notEqual(compare({ nativeCycles: nativeCycles.map((r, i) => i === 19 ? { ...r, workload: { ...reference, geometryHash: 'wrong' } } : r) }).status, 0);
});
