import { Manifest, type Anchor, type ManifestJson } from './manifest';
import { assessSkyAccess, assessSkyEyrie } from './skyaccess';
import { assessPlacePins, assessVillageContinuity, type PlacePin } from './editimpacts';

export interface EditReach { x: number; z: number; reach: number }
export interface SavedEditAssessment { sites: Anchor[]; conflict: string | null }

/** Check every newly touched square against the old saved world before a private edit is committed. */
export function assessSavedEdit(seed: number, before: ManifestJson, after: ManifestJson,
  changed: readonly EditReach[], pins: readonly PlacePin[] = [],
  villages: readonly string[] = [], protectAllVillages = false): SavedEditAssessment {
  const final = new Manifest(seed, after);
  const sites = new Map<string, Anchor>();
  for (const one of changed) {
    const result = assessSkyAccess(seed, before, final.toJSON(), one.x, one.z, one.reach);
    if (result.conflict) return { sites: [], conflict: result.conflict };
    for (const site of result.sites) {
      sites.set(site.id, site);
      final.anchors.set(site.id, site);
    }
  }
  for (const anchor of final.byKind('eyrie').filter((a) => a.version === 2
    && !before.anchors.some((old) => old.id === a.id))) {
    const conflict = assessSkyEyrie(seed, final.toJSON(), anchor);
    if (conflict) return { sites: [], conflict };
  }
  const placeConflict = assessPlacePins(seed, before, final.toJSON(), changed, pins);
  if (placeConflict) return { sites: [], conflict: placeConflict };
  const villageConflict = assessVillageContinuity(seed, before, final.toJSON(),
    changed, villages, protectAllVillages);
  if (villageConflict) return { sites: [], conflict: villageConflict };
  return { sites: [...sites.values()], conflict: null };
}
