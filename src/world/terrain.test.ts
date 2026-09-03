import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from './graph';
import { TerrainSampler, TileType } from './terrain';
import { buildChunkMesh } from './mesher';
import { WORLD } from '../core/config';

describe('TerrainSampler', () => {
  const graph = generateRoadGraph(77);
  const sampler = new TerrainSampler(graph);

  it('hub is land and road, far corner is sea', () => {
    expect(sampler.probe(0, 0).land).toBe(true);
    expect(sampler.probe(0, 0).hub).toBe(true);
    const far = sampler.probe(graph.radius * 2, graph.radius * 2);
    expect(far.land).toBe(false);
    expect(far.roadDist).toBe(Infinity);
  });

  it('hub chunk meshes; open-sea chunk is empty', () => {
    const c = sampler.generateChunk(0, 0);
    expect(c.empty).toBe(false);
    let road = 0;
    for (let i = 0; i < c.type.length; i++) if (c.type[i] === TileType.Road) road++;
    expect(road).toBeGreaterThan(0);
    const { land } = buildChunkMesh(c, sampler.seed);
    expect(land).not.toBeNull();
    expect(land!.indices.length % 3).toBe(0);
    expect(land!.positions.length / 3).toBeGreaterThan(WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE * 4 - 1);
    for (let i = 0; i < land!.colors.length; i++) {
      expect(land!.colors[i]).toBeGreaterThanOrEqual(0);
      expect(land!.colors[i]).toBeLessThanOrEqual(1);
    }

    const far = Math.ceil((graph.radius * 2) / WORLD.CHUNK_SIZE);
    const sea = sampler.generateChunk(far, far);
    expect(sea.empty).toBe(true);
    expect(buildChunkMesh(sea, sampler.seed).land).toBeNull();
  });

  it('land heights sit above the water line; water tiles carry a surface above their bed', () => {
    const c = sampler.generateChunk(0, 0);
    for (let i = 0; i < c.type.length; i++) {
      const t = c.type[i];
      if (t === TileType.Skip || t === TileType.Seabed) continue;
      if (t === TileType.Water) {
        expect(c.water[i]).toBeGreaterThan(c.height[i]);
        continue;
      }
      expect(c.height[i]).toBeGreaterThan(WORLD.WATER_Y);
    }
  });
});

describe('hydrology', () => {
  it('rivers flow downhill and end at sea or in a lake; some seed has a waterfall', () => {
    let waterfalls = 0, waterTiles = 0, bridges = 0;
    for (const seed of [1, 2, 3, 77]) {
      const graph = generateRoadGraph(seed);
      const sampler = new TerrainSampler(graph);
      const { rivers, lakes } = sampler.hydro;
      expect(rivers.length).toBeGreaterThan(0);
      expect(lakes.length).toBeGreaterThan(0);
      for (const river of rivers) {
        expect(river.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < river.length; i++) {
          expect(river[i].level).toBeLessThanOrEqual(river[i - 1].level);
          expect(river[i].width).toBeGreaterThanOrEqual(river[i - 1].width - 1e-6);
        }
        const last = river[river.length - 1];
        const endsAtSea = !sampler.probe(last.x, last.z).land;
        const endsInLake = lakes.some((l) => Math.hypot(l.x - last.x, l.z - last.z) < 1e-6);
        expect(endsAtSea || endsInLake).toBe(true);
      }
      // scan chunks along the first river for water geometry
      const river = rivers[0];
      const seen = new Set<string>();
      for (const n of river) {
        const cx = Math.floor(n.x / WORLD.CHUNK_SIZE), cz = Math.floor(n.z / WORLD.CHUNK_SIZE);
        const k = `${cx},${cz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const c = sampler.generateChunk(cx, cz);
        for (let i = 0; i < c.type.length; i++) {
          if (c.type[i] === TileType.Water) waterTiles++;
          if (c.type[i] === TileType.Bridge) bridges++;
        }
        const { water } = buildChunkMesh(c, sampler.seed);
        if (water?.flow) for (let i = 0; i < water.flow.length; i++) if (water.flow[i] === 1) waterfalls++;
      }
    }
    expect(waterTiles).toBeGreaterThan(50);
    expect(waterfalls).toBeGreaterThan(0);
    expect(bridges).toBeGreaterThan(0);
  });
});
