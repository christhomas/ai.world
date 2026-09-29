import type { WorldDelta } from './protocol';
import type { Manifest } from '../src/world/manifest';
import { ANCHOR_VERSION } from '../src/world/manifest';

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
