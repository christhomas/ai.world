import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const reference = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const candidate = JSON.parse(readFileSync(process.argv[3], 'utf8'));
for (const field of ['contractVersion', 'stepsPerCycle', 'cycles', 'stateHash', 'geometryHash', 'movedSteps', 'blockedSteps', 'meshBytes', 'microtasks', 'utf8']) assert.equal(candidate[field], reference[field], field);
console.log('Same bundle state, terrain and rig hashes match');
