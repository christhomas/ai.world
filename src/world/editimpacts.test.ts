import { describe, expect, it } from 'vitest';
import { Manifest } from './manifest';
import { Patchwork } from './patchwork';
import { assessPlacePins, changedNamedGround, impactOnReturningSave, newlyBuried, pinsInSave } from './editimpacts';
import type { SessionSave } from '../save/store';

describe('remembered places under a terrain edit', () => {
  it('finds a saved hero, field, house, horse, boat and pinned entrance', () => {
    const save = { seed: 7, cam: { x: 0, z: 0, rot: 0, zoom: 1 }, player: { x: 10, z: 11 },
      state: { plots: { '20,21': { crop: 'wheat', planted: 1 } },
        houses: { jobs: [{ id: 'house', x: 30, z: 31, village: 'Vale', paid: 1, price: 10 }] },
        horse: { name: 'Roan', x: 40, z: 41, palette: 0 }, boat: { x: 50, z: 51, yaw: 0 } },
      manifest: { rootSeed: 7, anchors: [{ id: 'cave:1', kind: 'cave', x: 60, z: 61,
        seed: 1, parent: null, version: 1 }] },
    } as SessionSave;
    expect(pinsInSave(save).map((p) => [p.x, p.z, p.footing])).toEqual([
      [10, 11, 'land'], [20, 21, 'land'], [30, 31, 'land'],
      [40, 41, 'land'], [50, 51, 'sea'], [60, 61, 'land'],
    ]);
  });

  it('refuses an authored sea layer that would drown a planted field', () => {
    const seed = 322;
    const base = new Patchwork(seed);
    const sampler = base.at(256, 256);
    let land: { x: number; z: number } | null = null;
    for (let x = 180; x < 330 && !land; x += 10) for (let z = 180; z < 330 && !land; z += 10)
      if (sampler.probe(x, z).land) land = { x, z };
    expect(land).not.toBeNull();
    const before = new Manifest(seed);
    const after = new Manifest(seed);
    after.terrain.push({ x: land!.x, z: land!.z, reach: 80, seed: 1, kind: 'sea' });
    const conflict = assessPlacePins(seed, before.toJSON(), after.toJSON(),
      [{ x: land!.x, z: land!.z, reach: 80 }], [{ ...land!, label: 'A planted field', footing: 'land' }]);
    expect(conflict).toContain('A planted field');

    const save = { seed, cam: { x: 0, z: 0, rot: 0, zoom: 1 },
      state: { plots: { [`${land!.x},${land!.z}`]: { crop: 'wheat', planted: 1 } } },
      manifest: before.toJSON() } as SessionSave;
    const original = JSON.stringify(save);
    expect(changedNamedGround(seed, save.manifest, after.toJSON())).toEqual([
      { x: land!.x, z: land!.z, reach: 89 },
    ]);
    expect(impactOnReturningSave(save, after.toJSON())).not.toBeNull();
    expect(JSON.stringify(save), 'a refused join must leave its IndexedDB value untouched').toBe(original);
    expect(impactOnReturningSave(save, before.toJSON())).toBeNull();
  });

  it('detects a rock face raised over an existing entrance', () => {
    expect(newlyBuried(null, 4, 7, 4)).toBe(true);
    expect(newlyBuried(5, 4, 7, 4)).toBe(true);
    expect(newlyBuried(7, 4, 8, 4)).toBe(false);
    expect(newlyBuried(null, 4, 5, 4)).toBe(false);
  });
});
