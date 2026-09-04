import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from '../world/graph';
import { TerrainSampler } from '../world/terrain';
import { ROAM, bandAt, bandsOver, planBands, pressureOn, regionOf, tollOf } from './roaming';

const world = (seed: number) => new TerrainSampler(generateRoadGraph(seed)).structures;

describe('probe', () => {
  it('measures', () => {
    const lines: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
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

      // what a village with a band on it loses, and how long a press lasts
      let worst = { name: '', toll: 0, press: 0, days: 0, run: 0 };
      for (const v of villages) {
        let toll = 0, press = 0, days = 0, run = 0, streak = 0;
        for (let d = 1; d <= 60; d++) {
          let today = 0;
          for (const b of bands) {
            const p = pressureOn(b, v, d);
            press += p;
            today += p;
            toll += tollOf(b, v, d, p);
          }
          if (today > 0.05) { days++; streak++; run = Math.max(run, streak); } else streak = 0;
        }
        if (toll > worst.toll) worst = { name: v.name, toll, press, days, run };
      }
      lines.push(`  worst village ${worst.name}: ${worst.toll} taken / 60 days, pressed on ${worst.days} days, longest run ${worst.run}, pressure sum ${worst.press.toFixed(1)}`);
    }

    const bands = planBands(1, world(1));
    const far = bands.map((b) => {
      const start = bandAt(b, 1);
      let most = 0;
      for (let d = 2; d <= 8; d++) {
        const now = bandAt(b, d);
        most = Math.max(most, Math.hypot(now.x - start.x, now.z - start.z));
      }
      return Math.round(most);
    });
    lines.push(`furthest from home in a week: ${far.sort((a, b) => a - b).join(' ')}`);
    const standing = bands.filter((b) => bandAt(b, 5).standing).length;
    lines.push(`camped on day 5: ${standing} of ${bands.length}`);

    expect(lines.join('\n')).toBe('');
  });
});
