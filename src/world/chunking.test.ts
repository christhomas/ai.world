import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from './roadtree';
import { TerrainSampler } from './terrain';
import { chunkOf } from './chunking';

/**
 * The seam between answering about a point and building a square out of many of them.
 *
 * #306 was filed the night `terrain.ts` hit 699 of the 700 lines `architecture.test.ts` allows and
 * was brought back under by rewrapping two import blocks. That is whitespace, not an answer, and the
 * next change to the file would have found nothing left to squeeze.
 */
const sampler = new TerrainSampler(generateRoadGraph(7));

describe('a square of country, built out of samples of it', () => {
  it('comes out the same through the door as through the function', () => {
    // `generateChunk` is now one line and every caller in the game still goes through it
    const door = sampler.generateChunk(1, -1);
    const direct = chunkOf(sampler, 1, -1);
    expect([...direct.type]).toEqual([...door.type]);
    expect([...direct.height]).toEqual([...door.height]);
    expect([...direct.prop]).toEqual([...door.prop]);
    expect(direct.empty).toBe(door.empty);
  });

  it('asks the rivers only where there were roads to ask about', () => {
    /*
     * The early-out that makes an ocean cheap. No roads in the box means open sea, the square is
     * not worth sampling, and the rivers need not be asked either — which is why `near` answers
     * both at once rather than handing out two indexes for a caller to query in the wrong order.
     */
    const far = sampler.near(80000, 80000, 80040, 80040);
    expect(far.roads, 'nothing should be built out there').toEqual([]);
    expect(far.rivers, 'and nothing should have been asked about').toEqual([]);
  });

  it('leaves an ocean square empty rather than building one', () => {
    const sea = chunkOf(sampler, 900, 900);
    expect(sea.empty).toBe(true);
  });

  it('keeps terrain.ts with room to change', () => {
    /*
     * The point of the whole exercise, held as the number it is. Not the cap itself —
     * `architecture.test.ts` owns that — but the margin, so a file that creeps back up to within a
     * line of it fails here first, where the message says what to do about it.
     */
    const lines = readFileSync(new URL('./terrain.ts', import.meta.url), 'utf8').split('\n').length;
    expect(lines, 'terrain.ts is back at the cap: extract, do not rewrap').toBeLessThan(660);
  });
});
