import { describe, expect, it } from 'vitest';
import { Manifest } from './manifest';
import { Patchwork } from './patchwork';
import { assessSkyAccess, plannedSkySites } from './skyaccess';
import { impactOnReturningSave } from './editimpacts';
import { mountainAnchor } from './worldediting';

describe('saved sky villages under authored ground', () => {
  const seed = 322;
  // A sky village the planner really puts here, pinned as a save made before the edit would hold
  // it. It must be clear of conflict with no edit at all, or every refusal below proves nothing.
  const oldWorld = () => {
    const manifest = new Manifest(seed);
    const planned = plannedSkySites(seed, new Patchwork(seed).at(256, 256), manifest)[0];
    expect(planned).toBeDefined();
    manifest.anchors.set(planned.id, { id: planned.id, kind: 'skyisle', x: planned.x, z: planned.z,
      seed: manifest.deriveSeed(planned.id, 'skyisle', planned.over), parent: planned.over, version: 1,
      skySite: { radius: planned.radius, y: planned.y } });
    const json = manifest.toJSON();
    expect(assessSkyAccess(seed, json, json, planned.x, planned.z, 120).conflict).toBeNull();
    return { manifest, site: planned };
  };

  it('refuses a new mountain that would rise through a pinned sky village', () => {
    const { manifest: before, site } = oldWorld();
    const after = new Manifest(seed, before.toJSON());
    after.anchors.set('highland:edit:00000000-0000-4000-8000-000000000322',
      mountainAnchor({ x: site.x, z: site.z, reach: 80, lift: 100, roughness: 0, seed: 1 },
        'highland:edit:00000000-0000-4000-8000-000000000322'));
    const result = assessSkyAccess(seed, before.toJSON(), after.toJSON(), site.x, site.z, 80);
    expect(result.conflict).toBe(`The mountain would rise through the sky village at ${site.x}, ${site.z}.`);
  });

  it('refuses sea that would take the land from under a pinned sky village', () => {
    const { manifest: before, site } = oldWorld();
    const after = new Manifest(seed, before.toJSON());
    after.terrain.push({ x: site.x, z: site.z, reach: 120, seed: 1, kind: 'sea' });
    const result = assessSkyAccess(seed, before.toJSON(), after.toJSON(), site.x, site.z, 120);
    expect(result.conflict).toBe(`The sky village at ${site.x}, ${site.z} would lose the land below it.`);
  });

  it('returns a saved sky site upgrade without mutating the old snapshot', () => {
    const before = new Manifest(seed);
    const planned = plannedSkySites(seed, new Patchwork(seed).at(256, 256), before)[0];
    expect(planned).toBeDefined();
    const site = { id: planned.id, kind: 'skyisle' as const, x: planned.x, z: planned.z,
      seed: before.deriveSeed(planned.id, 'skyisle', planned.over), parent: planned.over, version: 1 };
    before.anchors.set(site.id, site);
    const original = JSON.stringify(before.toJSON());
    const after = new Manifest(seed, before.toJSON());
    const result = assessSkyAccess(seed, before.toJSON(), after.toJSON(), site.x, site.z, 80);
    expect(result.conflict).toBeNull();
    expect(result.sites).toContainEqual(expect.objectContaining({
      id: site.id, skySite: { radius: expect.any(Number), y: expect.any(Number) },
    }));
    expect(JSON.stringify(before.toJSON())).toBe(original);
  });

  it('blocks a returning saved sky village after its land is flooded', () => {
    const { manifest: before, site } = oldWorld();
    const after = new Manifest(seed, before.toJSON());
    after.terrain.push({ x: site.x, z: site.z, reach: 120, seed: 1, kind: 'sea' });
    const save = { seed, cam: { x: 0, z: 0, rot: 0, zoom: 1 }, sky: site.id,
      manifest: before.toJSON() } as import('../save/store').SessionSave;
    const original = JSON.stringify(save);
    expect(impactOnReturningSave(save, before.toJSON())).toBeNull();
    expect(impactOnReturningSave(save, after.toJSON()))
      .toBe(`The sky village at ${site.x}, ${site.z} would lose the land below it.`);
    expect(JSON.stringify(save)).toBe(original);
  });
});
