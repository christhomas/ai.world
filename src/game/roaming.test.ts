import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from '../world/graph';
import { TerrainSampler } from '../world/terrain';
import { ROAM, bandAt, bandsOver, planBands, pressureOn, regionOf, tollOf } from './roaming';

const world = (seed: number) => new TerrainSampler(generateRoadGraph(seed)).structures;

describe('probe', () => {
  it('measures', () => {
    const lines: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const structures = world(seed);
      const bands = planBands(seed, structures);
      const villages = structures.villages;
      const home = villages[0];
      const region = regionOf(villages, home.x, home.z);

      // distinct bands over a window of BROKEN_FOR days: the number that must be held at once
      let regionWorst = 0, worldWorst = 0;
      for (let start = 1; start <= 60; start++) {
        const inRegion = new Set<string>();
        const inWorld = new Set<string>();
        for (let d = start; d < start + ROAM.BROKEN_FOR; d++) {
          for (const b of bandsOver(bands, region, d)) inRegion.add(b.id);
          for (const b of bandsOver(bands, villages, d)) inWorld.add(b.id);
        }
        regionWorst = Math.max(regionWorst, inRegion.size);
        worldWorst = Math.max(worldWorst, inWorld.size);
      }
      lines.push(`seed ${seed}: region ${region.length} villages worst ${regionWorst}; world ${villages.length} villages worst ${worldWorst}`);

      const tolls = villages.map((v) => {
        let toll = 0;
        for (let d = 1; d <= 60; d++) for (const b of bands) toll += tollOf(b, v, d, pressureOn(b, v, d));
        return toll;
      }).sort((a, b) => a - b);
      const week = bands.map((b) => {
        const start = bandAt(b, 1);
        let most = 0;
        for (let d = 2; d <= 8; d++) {
          const now = bandAt(b, d);
          most = Math.max(most, Math.hypot(now.x - start.x, now.z - start.z));
        }
        return most;
      });
      lines.push(`  tolls/60d low ${tolls[0]} med ${tolls[Math.floor(tolls.length / 2)]} high ${tolls[tolls.length - 1]}; week min ${Math.min(...week).toFixed(0)} mean ${(week.reduce((a, b) => a + b, 0) / week.length).toFixed(0)}`);
    }

    expect(lines.join('\n')).toBe('');
  });
});
