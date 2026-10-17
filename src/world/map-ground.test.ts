import { describe, expect, it } from 'vitest';
import { BIOMES, Biome } from './biomes';
import type { RoadGraph } from './graph';
import { SEA_RGB, groundColour, knownSquares, mapPad, mapPicture, type MapGround } from './map-ground';

const meadow = Biome.Plains;
/** Land east of the middle, sea west of it, and a peak standing at (20, 0). */
const ground: MapGround = {
  probe: (x) => ({ land: x > 0, biome: meadow }),
  rock: (x, z) => Math.max(0, 60 - 10 * Math.hypot(x - 20, z)),
};
const graph = {
  nodes: [{ x: -10, z: 0 }, { x: 10, z: 4 }],
  edges: [{ a: 0, b: 1, roadWidth: 1.5 }],
} as unknown as RoadGraph;

/** The cells of a picture, decoded from its runs as an app decodes them. */
function cells(picture: ReturnType<typeof mapPicture>): number[] {
  const out: number[] = [];
  for (let i = 0; i < picture.runs.length; i += 2) {
    for (let n = 0; n < picture.runs[i + 1]; n++) out.push(picture.colours[picture.runs[i]]);
  }
  return out;
}

describe('the map, wherever it is drawn', () => {
  it('colours the ground as it is: sea, land, and rock going white at the top', () => {
    expect(groundColour(ground, -5, 50)).toBe(SEA_RGB);
    expect(groundColour(ground, 5, 50)).toBe(BIOMES[meadow].ground);
    expect(groundColour(ground, 20, 0), 'the summit is snow').toBe(0xeef2f5);
  });

  it('sends an app the same ground, cell by cell, in runs that never cross a row', () => {
    const picture = mapPicture(graph, ground, 4);
    expect(picture.pad).toBe(mapPad(graph));
    expect(picture.pad).toBe(10 + 32);
    expect(picture.size).toBe(Math.ceil((picture.pad * 2) / 4));
    const all = cells(picture);
    expect(all).toHaveLength(picture.size * picture.size);
    for (const [i, j] of [[0, 0], [picture.size - 1, 3], [16, 10], [15, 10]]) {
      const x = (i + 0.5) * 4 - picture.pad, z = (j + 0.5) * 4 - picture.pad;
      expect(all[j * picture.size + i], `cell ${i},${j}`).toBe(groundColour(ground, x, z));
    }
    let row = 0;
    for (let k = 1; k < picture.runs.length; k += 2) {
      row += picture.runs[k];
      expect(row).toBeLessThanOrEqual(picture.size);
      if (row === picture.size) row = 0;
    }
    expect(picture.runs.length / 2, 'mostly sea, so far fewer runs than cells').toBeLessThan(all.length / 4);
    expect(picture.roads).toEqual([-10, 0, 10, 4, 3]);
  });

  it('takes the dark off a walked chunk and a bought province, either side of nought', () => {
    // a chunk is sixteen tiles and a province five hundred and twelve (core/config, world/provinces)
    expect(knownSquares(['-1,2'], ['-1:2'])).toEqual([
      { x: -16, z: 32, side: 16 },
      { x: -512, z: 1024, side: 512 },
    ]);
    expect(knownSquares([]), 'nothing walked, nothing known').toEqual([]);
  });
});
