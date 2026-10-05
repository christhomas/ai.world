import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const reference = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const candidate = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const reports = candidate.nativeCycles ?? [{ workload: candidate }];
if (candidate.nativeCycles) {
  const phases = candidate.engine === 'jsc' ? 1 : 2;
  assert.equal(reports.length, 10 * phases, 'ten runtimes, including supported recovery workloads');
  assert.equal(new Set(reports.map(r => r.sourceHash)).size, 1, 'same bundled source every runtime');
  for (const report of reports) assert.equal(report.sourceHash, reference.sourceHash, 'native evaluated the reference source bytes');
  for (let i = 0; i < 10; i++) {
    assert.equal(reports[i * phases].nativeCycle, i);
    assert.equal(reports[i * phases].phase, 'initial');
    if (phases === 2) {
      assert.equal(reports[i * phases + 1].nativeCycle, i);
      assert.equal(reports[i * phases + 1].phase, 'recovered');
    }
  }
}
for (const report of reports) for (const field of ['contractVersion', 'stepsPerCycle', 'cycles', 'stateHash', 'geometryHash', 'worldHash', 'sceneHash', 'chunkHash', 'peerHash', 'keepingHash', 'movedSteps', 'blockedSteps', 'meshBytes', 'microtasks', 'utf8', 'goldenHex', 'invalidBufferRejected']) assert.equal(report.workload[field], reference[field], field);
console.log('Same bundle state, terrain and rig hashes match');
