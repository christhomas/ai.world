import type { WorldDelta } from './protocol';
import { ANCHOR_VERSION, Manifest, type Anchor } from '../src/world/manifest';
import type { TerrainSampler } from '../src/world/terrain';
import { layTheCarcass } from '../src/game/baiting';
import { tilesToVillage } from '../src/game/camp';
import { rangesAsMassifs } from '../src/world/ranges';
import { anchoredHighlands } from '../src/world/anchoredhighlands';

/** A nest report must refer to this world's seed tree and the reporting hero's ledge. */
export function mayChangeEyrie(
  manifest: Manifest, hero: { x: number; z: number } | null,
  delta: Extract<WorldDelta, { kind: 'eyrie' }>,
): boolean {
  const { anchor, present } = delta;
  if (!hero || Math.hypot(hero.x - anchor.x, hero.z - anchor.z) > 8
    || anchor.version !== ANCHOR_VERSION.eyrie
    || anchor.seed !== manifest.deriveSeed(anchor.id, 'eyrie', null)) return false;
  const current = manifest.get(anchor.id);
  return present ? !current || current.kind === 'eyrie' : current?.kind === 'eyrie';
}

/**
 * Whether a carcass laid at this nest's ledge today would have kept an eagle there (#525).
 *
 * The world asks the rule the page asked — `layTheCarcass`, against its own ground and its own
 * day — rather than taking the page's word that the bait took. The same range under the ledge, the
 * same footing, the same distance to the village of that square, the same roll keyed to seed, tile
 * and day; on a scratch copy of the manifest, since asking must not plant the nest. The page lays
 * it where its hero stands and the anchor is that point rounded, so this is asked at the rounded
 * point, which can differ from the page's answer only at the very edge of a range.
 *
 * Whether he had a carcass to lay stays on trust: packs live in the save, not the world
 * (`docs/server-authority.md`).
 *
 * @param country the square the ledge is in, which the caller has already grown
 */
export function baitWouldTake(
  manifest: Manifest, seed: number, day: number, country: TerrainSampler, anchor: Anchor,
): boolean {
  const high = [
    ...(country.ranges ? rangesAsMassifs(country.ranges, country.mesh) : country.massifs),
    ...anchoredHighlands(manifest, country.within),
  ];
  const land = (x: number, z: number): boolean => country.probe(x, z).land;
  const scratch = new Manifest(manifest.rootSeed, manifest.toJSON());
  const toVillage = tilesToVillage(country.structures.villages, anchor.x, anchor.z);
  const { nest } = layTheCarcass(scratch, seed, day, high, land, toVillage, anchor.x, anchor.z);
  return nest !== null && nest.id === anchor.id && nest.x === anchor.x && nest.z === anchor.z;
}
