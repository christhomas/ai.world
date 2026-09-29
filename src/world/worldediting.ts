import type { Anchor, Manifest } from './manifest';
import type { TerrainLayer } from './terrainlayers';

/** Values chosen by a map editor before a mountain becomes a permanent world fact. */
export interface MountainDraft {
  x: number;
  z: number;
  reach: number;
  lift: number;
  roughness: number;
  seed: number;
}

/** Keep all parameters bounded before a draft reaches a generator, save, or server. */
export function mountainDraft(value: unknown): MountainDraft | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<MountainDraft>;
  if (![v.x, v.z, v.reach, v.lift, v.seed].every(Number.isSafeInteger)
    || !Number.isFinite(v.roughness) || Math.abs(v.x!) > 1_000_000 || Math.abs(v.z!) > 1_000_000
    || v.reach! < 1 || v.reach! > 2048 || v.lift! < 1 || v.lift! > 100
    || v.roughness! < 0 || v.roughness! > 1 || v.seed! < 0 || v.seed! > 0xffffffff) return null;
  return v as MountainDraft;
}

/** Preview may be changed at will; commit appends one immutable versioned fact. */
export function mountainAnchor(draft: MountainDraft, id: string): Anchor {
  return { id, kind: 'highland', x: draft.x, z: draft.z, seed: draft.seed,
    parent: null, version: 2,
    layer: { reach: draft.reach, lift: draft.lift, roughness: draft.roughness } };
}

/** Verify an authored mountain exactly, without accepting an arbitrary anchor payload. */
export function authoredMountain(value: unknown): Anchor | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Partial<Anchor>;
  if (a.kind !== 'highland' || a.version !== 2 || a.parent !== null
    || typeof a.id !== 'string' || !/^highland:edit:[0-9a-f-]{36}$/.test(a.id)) return null;
  const draft = mountainDraft({ x: a.x, z: a.z, reach: a.layer?.reach,
    lift: a.layer?.lift, roughness: a.layer?.roughness, seed: a.seed });
  return draft ? mountainAnchor(draft, a.id) : null;
}

/** Refuse accidental replacement; editing a saved world appends a new layer. */
export function addMountain(manifest: Manifest, anchor: Anchor): boolean {
  if (!authoredMountain(anchor) || manifest.get(anchor.id) || manifest.layers().length >= 32) return false;
  manifest.anchors.set(anchor.id, anchor);
  return true;
}

/** Validate a land/sea brush before it is allowed into an existing world. */
export function authoredTerrain(value: unknown): TerrainLayer | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<TerrainLayer>;
  if (v.kind !== 'land' && v.kind !== 'sea') return null;
  if (![v.x, v.z, v.reach, v.seed].every(Number.isSafeInteger)
    || Math.abs(v.x!) > 1_000_000 || Math.abs(v.z!) > 1_000_000
    || v.reach! < 1 || v.reach! > 2048 || v.seed! < 0 || v.seed! > 0xffffffff) return null;
  return { x: v.x!, z: v.z!, reach: v.reach!, seed: v.seed!, kind: v.kind };
}

/** A deliberate skyward nest is tied to a pinned sky village, unlike a baited range crossing. */
export function skyEyrieAnchor(manifest: Manifest, siteId: string, x: number, z: number, id: string): Anchor | null {
  const site = manifest.get(siteId);
  if (!site || site.kind !== 'skyisle' || !Number.isSafeInteger(x) || !Number.isSafeInteger(z)
    || Math.abs(x) > 1_000_000 || Math.abs(z) > 1_000_000
    || Math.hypot(x - site.x, z - site.z) > 160
    || !/^eyrie:edit:[0-9a-f-]{36}$/.test(id)) return null;
  return { id, kind: 'eyrie', x, z, seed: manifest.deriveSeed(id, 'eyrie', siteId),
    parent: siteId, version: 2 };
}

export function authoredSkyEyrie(manifest: Manifest, value: unknown): Anchor | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Partial<Anchor>;
  if (typeof a.id !== 'string' || typeof a.parent !== 'string') return null;
  const expected = skyEyrieAnchor(manifest, a.parent, a.x!, a.z!, a.id);
  return expected && a.kind === expected.kind && a.version === expected.version && a.seed === expected.seed
    ? expected : null;
}
