import { describe, expect, it } from 'vitest';
import { growCountryState } from './country-state';
import { Manifest } from '../world/manifest';
import { elevationFor, growPatch, growWorld, islandsFor, stampFor, terrainFor } from '../world/growworld';
import { TerrainSampler } from '../world/terrain';
import { boundsOf, PATCH } from '../world/patchwork';
import { partsOf } from '../world/endless';

describe('production country boot without browser mounts', () => {
  it('keeps the bounded browser country, islands, structures and terrain identical', () => {
    const state = growCountryState({ seed: 7, world: 'road' });
    const manifest = new Manifest(7);
    const sampler = new TerrainSampler(growWorld(7, islandsFor(manifest, 7)));
    expect(state.graph).toEqual(sampler.graph);
    expect(state.structures).toEqual(sampler.structures);
    expect(state.manifest.toJSON()).toEqual(manifest.toJSON());
    expect(state.stamp).toBe(stampFor('road', 7, sampler.graph));
    for (const [x, z] of [[0, 0], [12, -8], [-50, 50]]) expect(state.sampler.probe(x, z)).toEqual(sampler.probe(x, z));
    expect(state.endless).toBeNull();
    expect(state.country.moveTo(1000, 1000)).toBeNull();
  }, 90000);

  it('restores pinned island locations and seeds instead of deriving a different country', () => {
    const manifest = new Manifest(7);
    manifest.ensure('island:kept', 'island', 420, -270);
    manifest.override('island:kept', 12345);
    const saved = manifest.toJSON();
    const first = growCountryState({ seed: 7, world: 'road', savedManifest: saved });
    const continued = growCountryState({ seed: 7, world: 'road', savedManifest: JSON.parse(JSON.stringify(first.manifest.toJSON())) });
    expect(continued.manifest.toJSON()).toEqual(saved);
    expect(continued.stamp).toBe(first.stamp);
    expect(continued.graph).toEqual(first.graph);
    expect(continued.manifest.get('island:kept')).toMatchObject({ x: 420, z: -270, seed: 12345 });
  }, 90000);

  it('starts in the saved endless patch and reads the actual new ground after a crossing', () => {
    const state = growCountryState({ seed: 11, world: 'endless', start: { x: -PATCH + 4, z: 10 } });
    expect(state.endless!.patch).toBe('-1,0');
    expect(state.endless!.store.has('0,0')).toBe(false);
    const before = state.sampler, stamp = state.stamp;
    expect(state.country.moveTo(10, 10)).toBe('0,0');
    expect(state.sampler).not.toBe(before);
    expect(state.graph).toBe(state.country.sampler.graph);
    expect(state.structures).toBe(state.country.sampler.structures);
    expect(state.highPlaces).toBe(state.highPlaces);
    expect(state.stamp).toBe(stamp);
    const nearby = state.around.villages(10, 10, 100);
    expect(nearby).toEqual(expect.arrayContaining(state.structures.villages.filter(v => Math.hypot(v.x - 10, v.z - 10) <= 100)));
    for (const village of nearby) expect(Math.hypot(village.x - 10, village.z - 10)).toBeLessThanOrEqual(100);
  }, 90000);

  it('reuses an authored home patch and preserves its saved elevation and terrain', () => {
    const manifest = new Manifest(11);
    const ridge = manifest.ensure('highland:kept', 'highland', 200, 200);
    ridge.layer = { reach: 120, lift: 10 };
    manifest.terrain.push({ x: 200, z: 200, reach: 75, seed: 42, kind: 'land' });
    const layers = elevationFor(manifest), terrain = terrainFor(manifest);
    const grown = growPatch(11, boundsOf('0,0'), layers, terrain);
    const state = growCountryState({ seed: 11, world: 'endless', savedManifest: manifest.toJSON(),
      home: { seed: 11, patch: '0,0', parts: partsOf(grown) } });
    expect(state.graph).toEqual(grown.graph);
    expect(state.structures).toEqual(grown.structures);
    expect(state.sampler.probe(200, 200)).toEqual(grown.probe(200, 200));
    expect(state.manifest.toJSON()).toEqual(manifest.toJSON());
    expect(state.stamp).toBe(stampFor('endless', 11, grown.graph, layers, terrain));
    expect(state.stamp).not.toBe(stampFor('endless', 11, grown.graph));
  }, 90000);
});
