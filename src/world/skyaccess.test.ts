import { describe, expect, it } from 'vitest';
import { Manifest } from './manifest';
import { Patchwork } from './patchwork';
import { assessSkyAccess, plannedSkySites } from './skyaccess';
import { impactOnReturningSave } from './editimpacts';
import { mountainAnchor } from './worldediting';

describe('saved sky villages under authored ground', () => {
  const seed = 322;
  const oldWorld = () => {
    const manifest = new Manifest(seed);
    const site = manifest.ensure('sky:256,256', 'skyisle', 256, 256, 'ground:256,256');
    site.skySite = { radius: 22, y: 26 };
    return manifest;
  };

  it('refuses a new mountain that would rise through a pinned sky village', () => {
    const before = oldWorld();
    const after = new Manifest(seed, before.toJSON());
    after.anchors.set('highland:edit:00000000-0000-4000-8000-000000000322',
      mountainAnchor({ x: 256, z: 256, reach: 80, lift: 100, roughness: 0, seed: 1 },
        'highland:edit:00000000-0000-4000-8000-000000000322'));
    const result = assessSkyAccess(seed, before.toJSON(), after.toJSON(), 256, 256, 80);
    expect(result.conflict).not.toBeNull();
  });

  it("refuses sea that would remove a pinned city's eagle landing", () => {
    const before = oldWorld();
    const after = new Manifest(seed, before.toJSON());
    after.terrain.push({ x: 256, z: 256, reach: 120, seed: 1, kind: 'sea' });
    const result = assessSkyAccess(seed, before.toJSON(), after.toJSON(), 256, 256, 120);
    expect(result.conflict).not.toBeNull();
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

  it('blocks a returning saved sky village after its landing is flooded', () => {
    const before = oldWorld();
    const after = new Manifest(seed, before.toJSON());
    after.terrain.push({ x: 256, z: 256, reach: 120, seed: 1, kind: 'sea' });
    const save = { seed, cam: { x: 0, z: 0, rot: 0, zoom: 1 }, sky: 'sky:256,256',
      manifest: before.toJSON() } as import('../save/store').SessionSave;
    const original = JSON.stringify(save);
    expect(impactOnReturningSave(save, after.toJSON())).toMatch(/sky village|eagle landing/i);
    expect(JSON.stringify(save)).toBe(original);
  });
});
