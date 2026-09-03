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

describe('caves and wrecks', () => {
  it('are placed on cliffs and beaches, kept apart, and named uniquely', async () => {
    const { CAVES, WRECKS } = await import('./structures');
    const { TileType } = await import('./terrain');
    const g = generateRoadGraph(11);
    const sampler = new TerrainSampler(g);
    const { caves, wrecks } = sampler.structures;
    expect(caves.length).toBe(CAVES);
    // beaches are scarcer than cliffs, so a mainland-only world may not fill every wreck slot
    expect(wrecks.length).toBeGreaterThan(0);
    expect(wrecks.length).toBeLessThanOrEqual(WRECKS);
    const names = new Set([...caves, ...wrecks].map((s) => s.name));
    expect(names.size).toBe(caves.length + wrecks.length);
    const sample = sampler.newSample();
    for (const c of caves) {
      sampler.sampleTile(Math.floor(c.x), Math.floor(c.z), sample);
      expect(sample.type).not.toBe(TileType.Skip);
    }
    for (const w of wrecks) {
      sampler.sampleTile(Math.floor(w.x), Math.floor(w.z), sample);
      expect(sample.level).toBeLessThanOrEqual(1);
    }
    // sites keep their distance from each other
    const all = [...caves, ...wrecks];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThan(20);
      }
    }
  });

  it('cave layouts are open and cramped, vaults are roomy and locked', async () => {
    const { generateDungeon } = await import('../dungeon/generate');
    const cave = generateDungeon(4242, 'cave');
    const vault = generateDungeon(4242, 'vault');
    expect(cave.doors.length).toBe(0);
    expect(cave.rooms.length).toBeGreaterThanOrEqual(vault.rooms.length);
    const area = (m: typeof cave) => m.rooms.reduce((s, r) => s + r.w * r.h, 0) / m.rooms.length;
    expect(area(cave)).toBeLessThan(area(vault));
  });
});
