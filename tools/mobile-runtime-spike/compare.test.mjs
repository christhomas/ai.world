import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'spike-comparison-'));
const reference = { contractVersion: 1, stepsPerCycle: 2000, cycles: 10, stateHash: '123', geometryHash: '456', movedSteps: 1, blockedSteps: 1999, meshBytes: 1024, microtasks: 1, utf8: 'Ólafur 雪 🐺' };
const a = join(directory, 'reference.json'), b = join(directory, 'candidate.json');
writeFileSync(a, JSON.stringify(reference));
function compare(candidate) { writeFileSync(b, JSON.stringify(candidate)); return spawnSync(process.execPath, ['tools/mobile-runtime-spike/compare.mjs', a, b]); }
test('same deterministic results pass despite independent native timings', () => assert.equal(compare({ ...reference, totalMs: 999 }).status, 0));
test('every deterministic field is checked, including actual collision and geometry evidence', () => {
  for (const field of Object.keys(reference)) assert.notEqual(compare({ ...reference, [field]: null }).status, 0, field);
});
