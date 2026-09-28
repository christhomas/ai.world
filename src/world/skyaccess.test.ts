import { describe, expect, it } from 'vitest';
import { Manifest } from './manifest';
import { assessSkyAccess } from './skyaccess';
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
});
