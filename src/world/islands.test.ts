import { describe, expect, it } from 'vitest';
import { attachIslands, generateRoadGraph, planIslands, sectorMix } from './graph';
import { Manifest } from './manifest';
import { Simplex2D } from './noise';
import { TerrainSampler } from './terrain';
import { SALT, derive } from '../core/salts';

describe('islands', () => {
  it('plans islands past the mainland, attaches them deterministically, each one biome', () => {
    const build = () => {
      const g = generateRoadGraph(5);
      const m = new Manifest(5);
      for (const p of planIslands(g, 5)) {
        const a = m.ensure(p.id, 'island', p.x, p.z);
        expect(a.seed).toBe(p.seed); // planner and manifest agree on the default seed
      }
      attachIslands(g, m.byKind('island'));
      return g;
    };
    const a = build(), b = build();
    expect(a.islands.length).toBe(4);
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.islands.map((i) => i.seed)).toEqual(b.islands.map((i) => i.seed));
    const mainland = a.mainlandNodes;
    expect(a.nodes.length).toBeGreaterThan(mainland + 100);
    const noise = new Simplex2D(derive(5, SALT.BIOME));
    for (const isl of a.islands) {
      // clear of every mainland node
      for (let n = 0; n < mainland; n++) expect(Math.hypot(a.nodes[n].x - isl.x, a.nodes[n].z - isl.z)).toBeGreaterThan(isl.radius + 30);
      // hub registered as a town, biome override in force
      expect(a.towns).toContain(isl.hub);
      expect(sectorMix(a, noise, isl.x + 5, isl.z - 3).biome).toBe(isl.biome);
      expect(a.nodes[isl.hub].level).toBe(1);
      // island nodes parent within the island
      for (let n = isl.firstNode; n < a.nodes.length && (a.islands.find((o) => o.firstNode > isl.firstNode && n >= o.firstNode) === undefined); n++) {
        const p = a.nodes[n].parent;
        expect(p === -1 || p >= isl.firstNode).toBe(true);
      }
    }
  });

  it('every island gets a harbour town and a pier on each shore', () => {
    const g = generateRoadGraph(5);
    const m = new Manifest(5);
    for (const p of planIslands(g, 5)) m.ensure(p.id, 'island', p.x, p.z);
    attachIslands(g, m.byKind('island'));
    const sampler = new TerrainSampler(g);
    const { villages, piers } = sampler.structures;
    for (const isl of g.islands) {
      const town = villages.find((v) => Math.hypot(v.x - isl.x, v.z - isl.z) < 2);
      expect(town, `town on ${isl.id}`).toBeTruthy();
      const sides = piers.filter((p) => p.island === isl.id).map((p) => p.side).sort();
      expect(sides).toEqual(['island', 'mainland']);
    }
    for (const p of piers) {
      expect(p.tiles.length).toBe(6);
      // deck tiles land in the sea, not on the road
      const [x, z] = p.tiles[p.tiles.length - 1];
      expect(sampler.probe(x + 0.5, z + 0.5).land).toBe(false);
    }
  });
});
