import { describe, expect, it } from 'vitest';
import type { WorldInvite } from '../../server/protocol';
import { Manifest } from '../world/manifest';
import { Patchwork } from '../world/patchwork';
import { joinNamed } from './named-world';
import type { SessionSave } from '../save/store';

/** A named world joined from an installed app, as the page joins one in `boot.ts` (#565). */
describe('a named world, joined', () => {
  it('is the seed, the country and the name its server said, grown as it was authored', () => {
    const invite: WorldInvite = { name: 'Ashford', seed: 41, kind: 'road',
      layers: [{ id: 'highland:a', kind: 'highland', x: 100, z: 120, seed: 3, parent: null, version: 1 }] };
    const joined = joinNamed(invite, undefined);
    expect(joined).toMatchObject({ seed: 41, world: 'road', worldName: 'Ashford', cam: { x: 0, z: 0, rot: 0, zoom: 1 } });
    expect(joined.manifest?.anchors.map((a) => a.id)).toContain('highland:a');
  });

  it('keeps what the hero had there, and forgets a save from another world under the same name', () => {
    const invite: WorldInvite = { name: 'Ashford', seed: 41 };
    const here = { seed: 41, cam: { x: 5, z: 6, rot: 1, zoom: 2 }, player: { x: 7, z: 8 } } as SessionSave;
    expect(joinNamed(invite, here)).toMatchObject({ cam: { x: 5, z: 6 }, player: { x: 7, z: 8 }, world: 'endless' });
    const elsewhere = { ...here, seed: 9 };
    expect(joinNamed(invite, elsewhere).cam).toEqual({ x: 0, z: 0, rot: 0, zoom: 1 });
  });

  it('refuses a returning hero whose field the world has since put under the sea, and keeps the save as it was', () => {
    const seed = 322;
    const sampler = new Patchwork(seed).at(256, 256);
    let land: { x: number; z: number } | null = null;
    for (let x = 180; x < 330 && !land; x += 10) for (let z = 180; z < 330 && !land; z += 10)
      if (sampler.probe(x, z).land) land = { x, z };
    expect(land).not.toBeNull();
    const save = { seed, cam: { x: 0, z: 0, rot: 0, zoom: 1 },
      state: { plots: { [`${land!.x},${land!.z}`]: { crop: 'wheat', planted: 1 } } },
      manifest: new Manifest(seed).toJSON() } as SessionSave;
    const kept = JSON.stringify(save);
    const invite: WorldInvite = { name: 'Drowned', seed, terrain: [{ x: land!.x, z: land!.z, reach: 80, seed: 1, kind: 'sea' }] };
    expect(() => joinNamed(invite, save)).toThrow(/Your saved progress is unchanged/);
    expect(JSON.stringify(save)).toBe(kept);
  });
});
