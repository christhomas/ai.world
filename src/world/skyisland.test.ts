import { describe, expect, it } from 'vitest';
import { SKY, buildSkyIsland, onSkyIsland, planSkyIslands, skyIndex } from './skyisland';
import { attachIslands, generateRoadGraph, planIslands } from './graph';
import { generateWebGraph } from './roadweb';
import { Manifest } from './manifest';
import { TerrainSampler } from './terrain';
import { WORLD } from '../core/config';
import type { IslandInfo } from './graph';
import type { Massif } from './mountains';

const isle = (x: number, z: number, radius = 90): IslandInfo =>
  ({ id: `isle:${x},${z}`, seed: 1, x, z, radius, biome: 0, hub: 0, firstNode: 0 });
const range = (x: number, z: number, height: number): Massif => ({ x, z, radius: 80, height, hollow: 0 });

/**
 * A village in the clouds is the one place in this world you cannot get to on your own legs, so
 * what matters is that it exists somewhere worth looking up from, that it is the same shape on
 * every machine, and — above everything — that it is somewhere a person can stand.
 */
describe('where the sky islands hang', () => {
  it('puts one over an island, not over open water', () => {
    const [site] = planSkyIslands(1, [isle(1200, -400)], []);
    expect(Math.hypot(site.x - 1200, site.z + 400)).toBeLessThan(90 * SKY.DRIFT + 1);
    expect(site.over).toBe('isle:1200,-400');
  });

  it('gives a world no more than it should have of them', () => {
    const many = [isle(0, 1000), isle(1000, 0), isle(0, -1000), isle(-1000, 0), isle(700, 700)];
    expect(planSkyIslands(1, many, []).length).toBe(SKY.MOST);
  });

  it('stands well clear of the mountains, which are twice its height', () => {
    const tall = range(1200, -400, (SKY.FLOAT - SKY.HEADROOM) / WORLD.STEP + 20);
    expect(planSkyIslands(1, [isle(1200, -400)], [tall])).toEqual([]);
    // a hill under the same island is no trouble at all
    const low = range(1200, -400, 4);
    expect(planSkyIslands(1, [isle(1200, -400)], [low]).length).toBe(1);
  });

  it('floats above anything the ground can reach', () => {
    const [site] = planSkyIslands(1, [isle(1200, -400)], []);
    expect(site.y).toBeGreaterThan(WORLD.MAX_LEVEL * WORLD.STEP * 0.4);
  });

  it('is the same sky on every machine', () => {
    const once = planSkyIslands(9, [isle(900, 100), isle(-800, 300)], []);
    const twice = planSkyIslands(9, [isle(900, 100), isle(-800, 300)], []);
    expect(twice).toEqual(once);
  });
});

describe('the island itself', () => {
  const [site] = planSkyIslands(3, [isle(1000, 0)], []);
  const built = buildSkyIsland(site, 12345);

  it('comes out the same shape from the same anchor seed', () => {
    const again = buildSkyIsland(site, 12345);
    expect([...again.top]).toEqual([...built.top]);
    expect(again.props).toEqual(built.props);
    expect(again.perch).toEqual(built.perch);
  });

  it('is a different island from a different anchor seed', () => {
    const other = buildSkyIsland(site, 999);
    expect([...other.top]).not.toEqual([...built.top]);
  });

  it('is a lump of country rather than a disc or a smear', () => {
    let tiles = 0;
    for (const y of built.top) if (!Number.isNaN(y)) tiles++;
    const disc = Math.PI * site.radius * site.radius;
    expect(tiles).toBeGreaterThan(disc * 0.4);
    expect(tiles).toBeLessThan(disc);
  });

  it('is all of it above the highest terrace the ground can reach', () => {
    for (const y of built.top) {
      if (!Number.isNaN(y)) expect(y).toBeGreaterThanOrEqual(site.y - WORLD.STEP);
    }
  });

  it('has a spring in the middle and a stream that leaves it', () => {
    const middle = skyIndex(built, site.x, site.z);
    expect(built.water[middle]).toBeGreaterThan(0);
    // and the stream runs downhill: the lip is no higher than the spring
    expect(built.fall.lipY).toBeLessThanOrEqual(built.water[middle] + 1e-6);
  });

  it('pours off the edge and not out of the middle of the village', () => {
    const out = Math.hypot(built.fall.x - site.x, built.fall.z - site.z);
    expect(out).toBeGreaterThan(SKY.SQUARE + SKY.PLATEAU);
    // the tile the far side of the lip is off the island: that is what makes it a lip
    const beyond = { x: built.fall.x + built.fall.dx * 2, z: built.fall.z + built.fall.dz * 2 };
    expect(onSkyIsland(built, beyond.x, beyond.z)).toBe(false);
  });

  it('sets the eagle down somewhere a person can actually stand', () => {
    const i = skyIndex(built, built.perch.x, built.perch.z);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(built.top[i])).toBe(false);
    expect(built.water[i]).toBe(0);
    expect(built.blocked[i]).toBe(0);
  });

  it('leaves the loft standing on the island, on dry ground', () => {
    const i = skyIndex(built, built.loft.x, built.loft.z);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(built.top[i])).toBe(false);
    expect(built.water[i]).toBe(0);
  });

  it('lands the eagle a walk away from the loft, not on its doorstep', () => {
    expect(Math.hypot(built.perch.x - built.loft.x, built.perch.z - built.loft.z)).toBeGreaterThan(SKY.SQUARE);
  });

  it('builds a village, and nothing of it hanging in the air', () => {
    expect(built.props.length).toBeGreaterThan(SKY.HOUSES);
    for (const p of built.props) {
      const i = skyIndex(built, p.x, p.z);
      expect(i, `${p.kind} at ${p.x},${p.z}`).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(built.top[i])).toBe(false);
      expect(p.y).toBe(built.top[i]);
    }
  });

  it('never puts two things on the same tile', () => {
    const seen = new Set<number>();
    for (const p of built.props) {
      const i = skyIndex(built, p.x, p.z);
      expect(seen.has(i)).toBe(false);
      seen.add(i);
    }
  });
});

/**
 * The promise the whole idea rests on: what is underneath is still underneath. A sky island is
 * geometry added to the world, so nothing about the ground under it may move by a tile.
 */
describe('the land below', () => {
  it('is generated exactly as it would be with no island over it at all', () => {
    const graph = generateRoadGraph(5);
    const manifest = new Manifest(5);
    for (const p of planIslands(graph, 5)) manifest.ensure(p.id, 'island', p.x, p.z);
    attachIslands(graph, manifest.byKind('island'));
    const sampler = new TerrainSampler(graph);
    const sites = planSkyIslands(5, graph.islands, sampler.massifs);
    expect(sites.length).toBeGreaterThan(0);

    const before: number[] = [];
    const sample = sampler.newSample();
    const site = sites[0];
    for (let z = -site.radius; z <= site.radius; z += 3) {
      for (let x = -site.radius; x <= site.radius; x += 3) {
        sampler.sampleTile(Math.round(site.x + x), Math.round(site.z + z), sample);
        before.push(sample.type, sample.level, sample.water);
      }
    }
    // building the sky island is the whole of what this feature does to the world
    for (const s of sites) buildSkyIsland(s, manifest.ensure(s.id, 'skyisle', s.x, s.z, s.over).seed);
    const after: number[] = [];
    for (let z = -site.radius; z <= site.radius; z += 3) {
      for (let x = -site.radius; x <= site.radius; x += 3) {
        sampler.sampleTile(Math.round(site.x + x), Math.round(site.z + z), sample);
        after.push(sample.type, sample.level, sample.water);
      }
    }
    expect(after).toEqual(before);
  });

  /** Every sky island a seed grows, with the world underneath it, both ways of growing one. */
  const worldsWithSkies = function* (seeds: number[], mesh: boolean) {
    for (const seed of seeds) {
      const graph = mesh ? generateWebGraph(seed) : generateRoadGraph(seed);
      const manifest = new Manifest(seed);
      if (!mesh) {
        for (const p of planIslands(graph, seed)) manifest.ensure(p.id, 'island', p.x, p.z);
        attachIslands(graph, manifest.byKind('island'));
      }
      const sampler = new TerrainSampler(graph);
      const ground = (x: number, z: number): boolean => sampler.probe(x, z).land;
      for (const site of planSkyIslands(seed, graph.islands, sampler.massifs, ground)) {
        const anchor = manifest.ensure(site.id, 'skyisle', site.x, site.z, site.over);
        yield { seed, site, ground, built: buildSkyIsland(site, anchor.seed, ground) };
      }
    }
  };

  it('is what the waterfall comes down onto, which is the whole picture', () => {
    let seen = 0;
    for (const { seed, ground, built } of worldsWithSkies([1, 2, 5, 7, 11], false)) {
      seen++;
      // where the plume arrives: thrown clear of the lip by the time it has fallen the drop
      const lx = built.fall.x + built.fall.dx * SKY.PLUME;
      const lz = built.fall.z + built.fall.dz * SKY.PLUME;
      expect(ground(lx, lz), `${built.name} on seed ${seed} lands at ${Math.round(lx)},${Math.round(lz)}`).toBe(true);
    }
    expect(seen, 'every one of those seeds hangs a village in its sky').toBe(10);
  });

  it('never hangs a village over open water, whichever way the world was grown', () => {
    for (const mesh of [false, true]) {
      for (const { seed, site, ground, built } of worldsWithSkies([1, 3, 5, 7, 11, 42], mesh)) {
        expect(ground(site.x, site.z), `${built.name} on seed ${seed}`).toBe(true);
      }
    }
  });

  /**
   * The one that would be unforgivable. Everything else here is scenery; this is whether the place
   * can be got to at all, and a sky island whose eagles are standing in the sea is a village that
   * can be seen from the ground and never visited.
   */
  it('stands the eagles on dry ground, in every world it makes one for', () => {
    for (const mesh of [false, true]) {
      for (const { seed, ground, built } of worldsWithSkies([1, 2, 3, 4, 5, 6, 7, 11, 42, 99], mesh)) {
        expect(ground(built.crag.x, built.crag.z), `${built.name} on seed ${seed} (${mesh ? 'mesh' : 'road'})`).toBe(true);
        // and it stays under the island, so it is somewhere a person walking about would find
        expect(Math.hypot(built.crag.x - built.site.x, built.crag.z - built.site.z))
          .toBeLessThanOrEqual(built.site.radius + SKY.PLUME + SKY.CRAG_HUNT);
      }
    }
  });

  it('takes the direction it is given when there is no world to look down at', () => {
    const [site] = planSkyIslands(3, [isle(1000, 0)], []);
    const blind = buildSkyIsland(site, 4242);
    const nowhere = buildSkyIsland(site, 4242, () => false);
    // nothing underneath will do, so the dice keep their answer
    expect(nowhere.fall).toEqual(blind.fall);
  });
});
