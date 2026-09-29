import { describe, expect, it } from 'vitest';
import { Manifest } from './manifest';
import { elevationFor, endlessStamp } from './growworld';
import { swellAt } from './highland';
import { terrainPreview } from '../ui/terrainpreview';
import { authoredMountain, authoredTerrain, authoredSkyEyrie, addMountain,
  mountainAnchor, mountainDraft, skyEyrieAnchor } from './worldediting';

describe('versioned world edits', () => {
  const draft = { x: 256, z: 256, reach: 80, lift: 12, roughness: 0.4, seed: 7 };
  const id = 'highland:edit:00000000-0000-4000-8000-000000000322';

  it('validates independently tuned mountain parameters and appends the exact versioned anchor', () => {
    expect(mountainDraft(draft)).toEqual(draft);
    expect(mountainDraft({ ...draft, roughness: 2 })).toBeNull();
    const anchor = mountainAnchor(draft, id);
    expect(authoredMountain(anchor)).toEqual(anchor);
    expect(authoredMountain({ ...anchor, version: 1 })).toBeNull();
    const world = new Manifest(322);
    expect(addMountain(world, anchor)).toBe(true);
    expect(addMountain(world, anchor)).toBe(false);
    expect(elevationFor(new Manifest(322, world.toJSON()))).toMatchObject([
      { x: 256, z: 256, reach: 80, lift: 12, roughness: 0.4, seed: 7 },
    ]);
  });

  it('changes the multiplayer ground stamp when the seed or roughness changes', () => {
    const world = new Manifest(322);
    const base = endlessStamp(322, elevationFor(world));
    addMountain(world, mountainAnchor(draft, id));
    const first = endlessStamp(322, elevationFor(world));
    expect(first).not.toBe(base);
    const anchor = world.get(id)!;
    anchor.seed++;
    expect(endlessStamp(322, elevationFor(world))).not.toBe(first);
    anchor.seed--;
    anchor.layer!.roughness = 0.8;
    expect(endlessStamp(322, elevationFor(world))).not.toBe(first);
  });

  it('previews the same deterministic mountain whose reach, lift, ridges and seed were tuned', () => {
    const world = new Manifest(322);
    addMountain(world, mountainAnchor(draft, id));
    const hill = elevationFor(world)[0];
    const at = { x: draft.x + 30, z: draft.z + 13 };
    const height = swellAt(hill, at.x, at.z);
    expect(swellAt({ ...hill }, at.x, at.z)).toBe(height);
    expect(swellAt({ ...hill, reach: 40 }, at.x, at.z)).not.toBe(height);
    expect(swellAt({ ...hill, lift: 24 }, at.x, at.z)).not.toBe(height);
    expect(swellAt({ ...hill, roughness: 0 }, at.x, at.z)).not.toBe(height);
    expect(swellAt({ ...hill, seed: 8 }, at.x, at.z)).not.toBe(height);
    const plain = terrainPreview(322, [], 256, 256, 16);
    const pictured = terrainPreview(322, [], 256, 256, 16, elevationFor(world));
    expect(pictured).not.toEqual(plain);
    expect(terrainPreview(322, [], 256, 256, 16, elevationFor(new Manifest(322, world.toJSON()))))
      .toEqual(pictured);
  });

  it('accepts bounded land and sea brushes and rejects malformed ones', () => {
    expect(authoredTerrain({ x: 0, z: 0, reach: 80, seed: 1, kind: 'sea' })).toEqual({
      x: 0, z: 0, reach: 80, seed: 1, kind: 'sea',
    });
    expect(authoredTerrain({ x: 0, z: 0, reach: 80, seed: 1, kind: 'river' })).toBeNull();
  });

  it('pins a placed skyward eyrie through save, play, and a second edit', () => {
    const first = new Manifest(322);
    const site = first.ensure('sky:256,256', 'skyisle', 256, 256, 'ground:256,256');
    site.skySite = { radius: 22, y: 26 };
    const eyrie = skyEyrieAnchor(first, site.id, 300, 256,
      'eyrie:edit:00000000-0000-4000-8000-000000000322')!;
    expect(authoredSkyEyrie(first, eyrie)).toEqual(eyrie);
    first.anchors.set(eyrie.id, eyrie);
    const played = new Manifest(322, JSON.parse(JSON.stringify(first.toJSON())));
    expect(played.get(eyrie.id)).toEqual(eyrie);
    addMountain(played, mountainAnchor(draft, id));
    const editedAgain = new Manifest(322, JSON.parse(JSON.stringify(played.toJSON())));
    expect(editedAgain.get(eyrie.id)).toEqual(eyrie);
    expect(editedAgain.layers()).toHaveLength(1);
  });
});
