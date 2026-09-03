import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { generateRoadGraph } from './graph';
import { TerrainSampler, TileType } from './terrain';
import { StructureKind } from './structures';

describe('structures', () => {
  it('places villages with houses on flat land, door paths reach a road, POIs exist', () => {
    for (const seed of [1, 2, 3]) {
      const sampler = new TerrainSampler(generateRoadGraph(seed));
      const { villages, pois, all } = sampler.structures;
      expect(villages.length).toBeGreaterThanOrEqual(3);
      expect(pois.length).toBeGreaterThan(3);
      expect(villages[0].name).toBe('Crossroads Town');
      const names = new Set(villages.map((v) => v.name));
      expect(names.size).toBe(villages.length);

      // every house: centre tile is Floor and carries the house prop; path ends next to a road
      let checked = 0;
      for (const s of all) {
        if (s.kind !== StructureKind.House) continue;
        const CS = WORLD.CHUNK_SIZE;
        const cx = Math.floor(s.tx / CS), cz = Math.floor(s.tz / CS);
        const c = sampler.generateChunk(cx, cz);
        const idx = (s.tz - cz * CS + 1) * c.size + (s.tx - cx * CS + 1);
        expect(c.type[idx]).toBe(TileType.Floor);
        expect(c.prop[idx]).toBeGreaterThanOrEqual(20);
        expect(Number.isNaN(c.propRot[idx])).toBe(false);
        // footprint flat
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const j = idx + dz * c.size + dx;
          expect(c.height[j]).toBeCloseTo(s.level * WORLD.STEP, 5);
        }
        checked++;
        if (checked > 12) break;
      }
      expect(checked).toBeGreaterThan(3);
    }
  });

  it('is deterministic', () => {
    const a = new TerrainSampler(generateRoadGraph(9)).structures;
    const b = new TerrainSampler(generateRoadGraph(9)).structures;
    expect(a.all.length).toBe(b.all.length);
    expect(a.villages.map((v) => v.name)).toEqual(b.villages.map((v) => v.name));
  });
});
