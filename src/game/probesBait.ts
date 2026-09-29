import { canStand } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { rangesAsMassifs } from '../world/ranges';
import { Manifest } from '../world/manifest';
import { layTheCarcass } from './baiting';
import { tilesToVillage } from './camp';
import type { Probed } from './probes';

/** Cart and bait probes used by the complete browser hunt and haul playtest. */
export function installBaitProbes(ctx: Pick<Probed,
  'seed' | 'manifest' | 'state' | 'sampler' | 'structures' | 'chunks'>): void {
  const { seed, manifest, state, sampler, structures, chunks } = ctx;
  const debug = window as unknown as {
    __canStand?: (kind: string, x: number, z: number) => boolean;
    __baitChance?: (x: number, z: number) => number;
    __baitWouldNest?: (x: number, z: number) => boolean;
    __baitedEyries?: () => unknown;
  };
  debug.__canStand = (kind, x, z) => !!KINDS[kind] && canStand(chunks, KINDS[kind], x, z);
  const baitHigh = sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs;
  // The empty manifest previews the seeded roll without changing the saved world.
  const previewBait = (x: number, z: number) =>
    layTheCarcass(new Manifest(seed), seed, state.day, baitHigh,
      (tx, tz) => sampler.probe(tx, tz).land,
      tilesToVillage(structures.villages, x, z), x, z);
  debug.__baitChance = (x, z) => previewBait(x, z).chance;
  debug.__baitWouldNest = (x, z) => previewBait(x, z).nest !== null;
  debug.__baitedEyries = () => manifest.byKind('eyrie');
}
