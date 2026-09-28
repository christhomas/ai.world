import type { Manifest } from './manifest';
import type { Massif } from './mountains';
import type { Within } from './window';

/** A prayed-for layer is also high-country habitat, not merely a raised tile. */
export function anchoredHighlands(manifest: Manifest, within: Within | null = null): Massif[] {
  return manifest.layers().filter((a) => {
    const reach = a.layer!.reach;
    return !within || !(a.x + reach < within.x0 || a.x - reach > within.x1
      || a.z + reach < within.z0 || a.z - reach > within.z1);
  }).map((a) => ({ x: a.x, z: a.z, radius: a.layer!.reach,
    height: a.layer!.lift, hollow: 0 }));
}
