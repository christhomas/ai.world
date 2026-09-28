import { WORLD } from '../core/config';
import { anchoredHighlands } from './anchoredhighlands';
import { elevationFor, terrainFor } from './growworld';
import { Manifest, type Anchor, type ManifestJson } from './manifest';
import { rangesAsMassifs } from './ranges';
import { Patchwork, PATCH } from './patchwork';
import { buildSkyIsland, planSkyIslands, SKY, type SkySite } from './skyisland';
import { skyGroundsIn } from './skygrounds';
import type { TerrainSampler } from './terrain';
import { skyEyrieAnchor } from './worldediting';

/** The same sites HighCountry would plan from one sampler, before any were pinned. */
export function plannedSkySites(seed: number, sampler: TerrainSampler, manifest: Manifest): SkySite[] {
  const land = (x: number, z: number): boolean => sampler.probe(x, z).land;
  const high = [
    ...(sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs),
    ...anchoredHighlands(manifest, sampler.within),
  ];
  const grounds = sampler.within ? skyGroundsIn(seed, sampler.within, land) : sampler.graph.islands;
  return planSkyIslands(seed, grounds, high, land);
}

export function siteOf(anchor: Anchor): SkySite {
  return { id: anchor.id, over: anchor.parent ?? anchor.id, x: anchor.x, z: anchor.z,
    radius: anchor.skySite?.radius ?? 22, y: anchor.skySite?.y ?? SKY.FLOAT };
}

export interface SkyAccessAssessment { sites: Anchor[]; conflict: string | null }

/** A hand-placed skyward eagle needs dry footing on a real mountain beside its target city. */
export function assessSkyEyrie(seed: number, json: ManifestJson, anchor: Anchor): string | null {
  const manifest = new Manifest(seed, json);
  if (!anchor.parent || !skyEyrieAnchor(manifest, anchor.parent, anchor.x, anchor.z, anchor.id))
    return 'Choose a pinned sky village and a nearby eyrie site.';
  const sampler = new Patchwork(seed, undefined, 1, elevationFor(manifest), terrainFor(manifest)).at(anchor.x, anchor.z);
  if (!sampler.probe(anchor.x, anchor.z).land) return 'An eagle needs dry ground to land on.';
  const high = [
    ...(sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs),
    ...anchoredHighlands(manifest, sampler.within),
  ];
  return high.some((m) => Math.hypot(m.x - anchor.x, m.z - anchor.z) < m.radius)
    ? null : 'Place the eyrie on a mountain near the sky village.';
}

/**
 * Pin old sky cities in every square an edit could change, and refuse an edit that removes their
 * dry ground or lets a new mountain come through the village floor. Runs in GroundWorker on server.
 */
export function assessSkyAccess(
  seed: number, beforeJson: ManifestJson, afterJson: ManifestJson,
  x: number, z: number, reach: number,
): SkyAccessAssessment {
  const before = new Manifest(seed, beforeJson);
  const after = new Manifest(seed, afterJson);
  const oldPatches = new Patchwork(seed, undefined, 1, elevationFor(before), terrainFor(before));
  const newPatches = new Patchwork(seed, undefined, 1, elevationFor(after), terrainFor(after));
  const sites: Anchor[] = [];
  const px0 = Math.floor((x - reach) / PATCH), px1 = Math.floor((x + reach) / PATCH);
  const pz0 = Math.floor((z - reach) / PATCH), pz1 = Math.floor((z + reach) / PATCH);
  for (let px = px0; px <= px1; px++) for (let pz = pz0; pz <= pz1; pz++) {
    const cx = px * PATCH + PATCH / 2, cz = pz * PATCH + PATCH / 2;
    const oldSampler = oldPatches.at(cx, cz);
    const planned = plannedSkySites(seed, oldSampler, before);
    let pinnedCount = before.byKind('skyisle').filter((a) => a.x >= px * PATCH && a.x < (px + 1) * PATCH
      && a.z >= pz * PATCH && a.z < (pz + 1) * PATCH).length;
    for (const site of planned) {
      const existed = before.get(site.id) !== undefined;
      if (!existed && pinnedCount >= SKY.MOST) continue;
      const anchor = before.get(site.id)
        ?? { id: site.id, kind: 'skyisle' as const, x: site.x, z: site.z,
          seed: before.deriveSeed(site.id, 'skyisle', site.over), parent: site.over,
          version: 1, skySite: { radius: site.radius, y: site.y } };
      if (!anchor.skySite) anchor.skySite = { radius: site.radius, y: site.y };
      if (!existed) pinnedCount++;
      const existing = after.get(anchor.id);
      if (!existing || !existing.skySite) {
        if (!existing) after.anchors.set(anchor.id, anchor);
        else existing.skySite = anchor.skySite;
        sites.push(anchor);
      }
    }
    const pinned = after.byKind('skyisle').filter((anchor) =>
      anchor.x >= px * PATCH && anchor.x < (px + 1) * PATCH
      && anchor.z >= pz * PATCH && anchor.z < (pz + 1) * PATCH);
    if (!pinned.length) continue;
    const newSampler = newPatches.at(cx, cz);
    const land = (wx: number, wz: number): boolean => newSampler.probe(wx, wz).land;
    const high = [
      ...(newSampler.ranges ? rangesAsMassifs(newSampler.ranges, newSampler.mesh) : newSampler.massifs),
      ...anchoredHighlands(after, newSampler.within),
    ];
    for (const anchor of pinned) {
      const site = siteOf(anchor);
      if (!land(site.x, site.z)) return { sites: [], conflict: `The sky village at ${site.x}, ${site.z} would lose the land below it.` };
      if (high.some((m) => Math.hypot(m.x - site.x, m.z - site.z) < m.radius + site.radius
        && m.height * WORLD.STEP > site.y - SKY.HEADROOM)) {
        return { sites: [], conflict: `The mountain would rise through the sky village at ${site.x}, ${site.z}.` };
      }
      const isle = buildSkyIsland(site, anchor.seed, land);
      if (!land(isle.crag.x, isle.crag.z)) {
        return { sites: [], conflict: `The sky village at ${site.x}, ${site.z} would lose its eagle landing.` };
      }
    }
  }
  return { sites, conflict: null };
}
