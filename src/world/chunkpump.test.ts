import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The order things happen in inside `ChunkManager.pump`, which is not a detail.
 *
 * `ChunkManager` needs a scene, a prop library, three materials and four `Worker`s to exist, so
 * there is no way to stand one up here — which is exactly why this bug lived as long as it did.
 * Read as source instead, the way `indoors.test.ts` reads `tryLandlord`: the fault was an ordering,
 * and an ordering is something you can see.
 *
 * ## What went wrong
 *
 * A chunk at the edge of the patch the hero is in belongs to the *next* patch, and if that patch is
 * not grown yet the chunk has to wait. The waiting was written, and it was written in the wrong
 * place — after the job had been spliced out of the queue, after a worker had been taken off
 * `idle`, and after the key had been written into `pending`. Nothing put any of those back.
 *
 * `keepNear` will not re-queue a chunk that is pending, so each such chunk was lost for good and
 * took a worker with it. Four of them and every worker was gone and the page never painted another
 * square of ground for as long as it ran. Measured in a browser: an endless world stuck at 32
 * chunks of 121 with 89 outstanding, unchanged after a minute, where a road world drains to nought
 * in five seconds. On screen it is a mountain standing in open blue with no country around it.
 *
 * The road world never saw it because it has no patchwork, so the branch never ran.
 */
describe('the order a chunk job is started in', () => {
  const source = readFileSync('src/world/chunkManager.ts', 'utf8');
  const pump = source.slice(source.indexOf('private pump()'), source.indexOf('private pump()') + 4000);

  it('asks whether the patch is grown before it takes anything', () => {
    const asks = pump.indexOf('this.patches.has(wanted)');
    const splices = pump.indexOf('this.queue.splice');
    const takes = pump.indexOf('this.idle.pop()');
    const marks = pump.indexOf('this.pending.set');

    expect(asks, 'the patch check should be in pump').toBeGreaterThan(-1);
    expect(splices, 'the splice should be in pump').toBeGreaterThan(-1);
    expect(asks).toBeLessThan(splices);
    expect(asks).toBeLessThan(takes);
    expect(asks).toBeLessThan(marks);
  });

  it('leaves the job in the queue when it cannot be started', () => {
    // the branch continues to the next job without splicing, which is what keeps it askable
    const branch = pump.slice(pump.indexOf('this.patches.has(wanted)'));
    const untilContinue = branch.slice(0, branch.indexOf('continue;'));
    expect(untilContinue).not.toContain('splice');
    expect(untilContinue).not.toContain('idle.pop');
    expect(untilContinue).not.toContain('pending.set');
  });
});
