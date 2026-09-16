import { describe, expect, it } from 'vitest';
import { PatchCountry } from './patchcountry';
import { PATCH } from './patchwork';
import { viewOf } from './patchview';
import type { TerrainSampler } from './terrain';

/**
 * What the game reads about the country it is standing in, after it has walked into another one.
 *
 * `growCountry` used to hand out `sampler`, `graph`, `structures` and `highPlaces` as values read
 * once at boot, and `main.ts` closed over them — the biome probe, the field survey, every villages
 * lookup, the high-place check. `frame.ts` refreshed the mountains, the chunks, the skyline and the
 * high-country renderer on a crossing and could not refresh those, because they were copies.
 *
 * So a hero who walked into the next patch went on being told about the villages of the patch he
 * had left. A view is the answer rather than a refresh: nothing holds a copy, so nothing can hold
 * a stale one.
 */

/** A sampler that says only which patch it belongs to, which is all a crossing has to prove. */
const samplerFor = (mark: string): TerrainSampler => ({
  graph: { mark },
  structures: { mark, villages: [{ name: `village-of-${mark}` }] },
  ranges: null,
  massifs: [{ x: 0, z: 0, radius: 1, mark }],
  mesh: null,
} as unknown as TerrainSampler);

const country = (): PatchCountry =>
  new PatchCountry(1, 0, 0, (_seed, within) => samplerFor(`${within.x0},${within.z0}`));

describe('what the country reads after a crossing', () => {
  it('answers with the patch the hero is standing in, not the one he started in', () => {
    const endless = country();
    const view = viewOf(endless);
    const first = view.sampler;

    expect(endless.moveTo(PATCH * 3, 0)).not.toBeNull();
    expect(view.sampler).not.toBe(first);
  });

  it('moves the graph, the structures and the high places with it', () => {
    const endless = country();
    const view = viewOf(endless);
    const before = {
      graph: view.graph, structures: view.structures, highPlaces: view.highPlaces,
    };

    endless.moveTo(PATCH * 3, 0);

    expect(view.graph).not.toBe(before.graph);
    expect(view.structures).not.toBe(before.structures);
    expect(view.highPlaces).not.toBe(before.highPlaces);
  });

  it('names the villages of the patch it is in', () => {
    const endless = country();
    const view = viewOf(endless);
    const home = view.structures.villages[0].name;

    endless.moveTo(PATCH * 3, 0);

    expect(view.structures.villages[0].name).not.toBe(home);
  });

  it('works the high places out once per patch rather than once per question', () => {
    const endless = country();
    const view = viewOf(endless);
    expect(view.highPlaces).toBe(view.highPlaces);
  });

  it('stays put when the hero has not left the patch', () => {
    const endless = country();
    const view = viewOf(endless);
    const first = view.sampler;

    expect(endless.moveTo(1, 1)).toBeNull();
    expect(view.sampler).toBe(first);
  });
});
