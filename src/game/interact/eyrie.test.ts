import { describe, expect, it } from 'vitest';
import type { WorldDelta } from '../../../server/protocol';
import { Manifest } from '../../world/manifest';
import type { SkyIslands } from '../../render/skyisland';
import type { DialogueNode } from '../../ui/dialogue';
import { HighCountry } from '../highcountry';
import { Skies } from '../skies';
import type { IslandInfo } from '../../world/graph';
import { buildSkyIsland, planSkyIslands } from '../../world/skyisland';
import { skyEyrieAnchor } from '../../world/worldediting';
import { travelInteractions } from './travel';

describe('the nest on the ledge', () => {
  it('lets the player remove a baited nest, report it, and save the local change', () => {
    const manifest = new Manifest(7);
    const nest = manifest.ensure('eyrie:12,34', 'eyrie', 12, 34);
    const high = new HighCountry(7, manifest, {} as SkyIslands);
    const reported: WorldDelta[] = [];
    let saved = manifest.toJSON();
    let dialogue: DialogueNode | null = null;
    const travel = travelInteractions({
      player: { x: nest.x, z: nest.z },
      eyries: [], high,
      state: { inventory: { gold: 0 }, version: 0 },
      online: { report: (delta: WorldDelta) => reported.push(delta) },
      dialogue: { start: (node: DialogueNode) => { dialogue = node; } },
      sound: { select: () => {} }, hud: { flash: () => {} },
      persist: () => { saved = manifest.toJSON(); },
    } as never);

    expect(travel.tryEagle(true)).toBe(true);
    expect(travel.eagleLabel()).toBe('Inspect the eagle nest');
    expect(travel.tryEagle()).toBe(true);
    const remove = (dialogue as DialogueNode | null)?.choices?.find((choice) => choice.label === 'Take down the baited nest');
    expect(remove).toBeDefined();
    remove?.next();
    expect(reported).toEqual([{ kind: 'eyrie', anchor: nest, present: false }]);
    expect(manifest.byKind('eyrie')).toEqual([]);
    expect(new Manifest(7, saved).byKind('eyrie')).toEqual([]);
    expect(travel.tryEagle(true)).toBe(false);

    // The server can refuse a stale removal and restore its authoritative nest.
    high.setBaited(nest.id, nest);
    expect(manifest.byKind('eyrie')).toEqual([nest]);
  });

  it('keeps flight available beside removal and never offers removal at a planned crag', () => {
    const manifest = new Manifest(7);
    const nest = manifest.ensure('eyrie:12,34', 'eyrie', 12, 34);
    const high = new HighCountry(7, manifest, {} as SkyIslands);
    let dialogue: DialogueNode | null = null;
    const eyries = [
      { id: nest.id, name: 'Baited crag', x: nest.x, z: nest.z, partner: 'planned', fare: 18 },
      { id: 'planned', name: 'Far crag', x: 100, z: 100, partner: nest.id, fare: 18 },
    ];
    const player = { x: nest.x, z: nest.z };
    const travel = travelInteractions({
      player, eyries, high, state: { inventory: { gold: 20 } },
      dialogue: { start: (node: DialogueNode) => { dialogue = node; } },
    } as never);
    expect(travel.tryEagle()).toBe(true);
    expect(travel.eagleLabel()).toBe('Fly over the mountains');
    expect((dialogue as DialogueNode | null)?.choices?.map((choice) => choice.label))
      .toEqual(['Fly (18g)', 'Take down the baited nest', 'Walk round']);

    player.x = 100;
    player.z = 100;
    expect(travel.tryEagle()).toBe(true);
    expect((dialogue as DialogueNode | null)?.choices?.map((choice) => choice.label))
      .toEqual(['Fly (18g)', 'Walk round']);
  });

  it('leaves an editor-placed sky eyrie to the flight up rather than offering to take it down', () => {
    const island: IslandInfo = { id: 'isle:0,0', seed: 1, x: 0, z: 0, radius: 90, biome: 0, hub: 0, firstNode: 0 };
    const [site] = planSkyIslands(1, [island], []);
    const manifest = new Manifest(1);
    manifest.anchors.set(site.id, { id: site.id, kind: 'skyisle', x: site.x, z: site.z,
      seed: 777, parent: site.over, version: 1, skySite: { radius: site.radius, y: site.y } });
    const placed = skyEyrieAnchor(manifest, site.id, site.x + 40, site.z,
      'eyrie:edit:00000000-0000-4000-8000-000000000322')!;
    manifest.anchors.set(placed.id, placed);
    const high = new HighCountry(1, manifest, {} as SkyIslands);
    const player = { x: placed.x, z: placed.z };
    const skies = new Skies({ player, persist: () => {} } as never, [buildSkyIsland(site, 777)], manifest);
    let dialogue: DialogueNode | null = null;
    const travel = travelInteractions({
      player, eyries: [], high, skies, state: { inventory: { gold: 100 } },
      dialogue: { start: (node: DialogueNode) => { dialogue = node; } },
    } as never);

    // the precondition: this is the editor's eyrie, standing where its island's birds answer
    expect(placed.version).toBe(2);
    expect(skies.calledFrom(player.x, player.z)).not.toBeNull();

    expect(high.baitedAt(player.x, player.z)).toBeNull();
    expect(high.removeBaitedAt(player.x, player.z)).toBeNull();
    expect(manifest.get(placed.id)).toEqual(placed);
    expect(travel.tryEagle(true)).toBe(false);
    expect(travel.trySkyward()).toBe(true);
    expect((dialogue as DialogueNode | null)?.choices?.[0]?.label).toMatch(/^Fly up \(\d+g\)$/);
  });
});
