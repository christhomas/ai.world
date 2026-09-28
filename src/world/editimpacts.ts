import type { SessionSave } from '../save/store';
import { elevationFor, terrainFor } from './growworld';
import { Manifest, type ManifestJson } from './manifest';
import { Patchwork, PATCH } from './patchwork';
import { TileType } from './terrain';
import { terrainEditFootprint } from './terrainlayers';
import { assessSkyAccess } from './skyaccess';
import { PROP_HEADROOM } from './ground';
import { mountainAt } from './ranges';
import type { EditReach } from './savededit';

export interface PlacePin { x: number; z: number; label: string; footing: 'land' | 'sea' }

/** A newly raised rock face must not cover a place saved before the edit. */
export function newlyBuried(oldRock: number | null, oldGround: number,
  newRock: number | null, newGround: number): boolean {
  return (oldRock === null || oldRock <= oldGround + PROP_HEADROOM)
    && newRock !== null && newRock > newGround + PROP_HEADROOM;
}

/** Coordinates a private save has committed to, before the editor regrows anything. */
export function pinsInSave(save: SessionSave): PlacePin[] {
  const pins: PlacePin[] = [];
  const put = (x: number, z: number, label: string, footing: PlacePin['footing']) => {
    if (Number.isFinite(x) && Number.isFinite(z)) pins.push({ x, z, label, footing });
  };
  if (save.player && !save.sky) put(save.player.x, save.player.z, 'Your saved position',
    save.state?.boat && Math.hypot(save.state.boat.x - save.player.x, save.state.boat.z - save.player.z) < 3 ? 'sea' : 'land');
  for (const key of Object.keys(save.state?.plots ?? {})) {
    const [x, z] = key.split(',').map(Number);
    put(x, z, 'A planted field', 'land');
  }
  for (const job of save.state?.houses?.jobs ?? []) put(job.x, job.z, `The ${job.what ?? 'house'} commission`, 'land');
  if (save.state?.horse) put(save.state.horse.x, save.state.horse.z, 'Your horse', 'land');
  if (save.state?.boat) put(save.state.boat.x, save.state.boat.z, 'Your boat', 'sea');
  for (const anchor of save.manifest?.anchors ?? []) {
    if (['dungeon', 'cave', 'thicket', 'eyrie'].includes(anchor.kind))
      put(anchor.x, anchor.z, `The ${anchor.kind} at ${anchor.x}, ${anchor.z}`, 'land');
    if (anchor.kind === 'wreck') put(anchor.x, anchor.z, `The wreck at ${anchor.x}, ${anchor.z}`, 'sea');
  }
  return pins;
}

export function villagesInSave(save: SessionSave): { names: string[]; all: boolean } {
  const state = save.state;
  const names = new Set<string>();
  for (const job of state?.houses?.jobs ?? []) names.add(job.village);
  for (const purchase of state?.houses?.stables ?? []) names.add(purchase.village);
  for (const name of Object.keys(state?.rescues ?? {})) names.add(name);
  for (const name of Object.keys(state?.grudges ?? {})) names.add(name);
  for (const name of Object.keys(state?.holdingReadAt ?? {})) names.add(name);
  // These books use person/holding ids rather than village keys; protect every old village when
  // an edited square might contain one of their homes.
  const all = [state?.gifts, state?.ore, state?.forge, state?.jail]
    .some((book) => book && Object.keys(book).length > 0);
  return { names: [...names], all };
}

/** Regions whose authoritative named-world layers differ from this browser's last visit. */
export function changedNamedGround(seed: number, beforeJson: ManifestJson | undefined,
  afterJson: ManifestJson): EditReach[] {
  const before = new Manifest(seed, beforeJson), after = new Manifest(seed, afterJson);
  const changed: EditReach[] = [];
  const oldMountains = new Map(before.layers().map((a) => [a.id, a]));
  const newMountains = new Map(after.layers().map((a) => [a.id, a]));
  for (const id of new Set([...oldMountains.keys(), ...newMountains.keys()])) {
    const old = oldMountains.get(id), next = newMountains.get(id);
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    if (old?.layer) changed.push({ x: old.x, z: old.z, reach: old.layer.reach });
    if (next?.layer) changed.push({ x: next.x, z: next.z, reach: next.layer.reach });
  }
  const length = Math.max(before.terrain.length, after.terrain.length);
  for (let i = 0; i < length; i++) {
    const old = before.terrain[i], next = after.terrain[i];
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    if (old) changed.push({ x: old.x, z: old.z, reach: terrainEditFootprint(old.reach) });
    if (next) changed.push({ x: next.x, z: next.z, reach: terrainEditFootprint(next.reach) });
  }
  return changed;
}

/** Refuse a returning player whose private saved places would be invalid under server edits. */
export function impactOnReturningSave(save: SessionSave, joined: ManifestJson): string | null {
  const before = new Manifest(save.seed, save.manifest).toJSON();
  const changed = changedNamedGround(save.seed, before, joined);
  if (save.sky && !new Manifest(save.seed, joined).get(save.sky))
    return 'Your saved sky village is no longer in this world.';
  if (!changed.length) return null;
  for (const one of changed) {
    const sky = assessSkyAccess(save.seed, before, joined, one.x, one.z, one.reach);
    if (sky.conflict) return sky.conflict;
  }
  const place = assessPlacePins(save.seed, before, joined, changed, pinsInSave(save));
  if (place) return place;
  const villages = villagesInSave(save);
  return assessVillageContinuity(save.seed, before, joined, changed, villages.names, villages.all);
}

/** Refuse an edit that would drown or fill a remembered place, naming it for the editor. */
export function assessPlacePins(seed: number, beforeJson: ManifestJson, afterJson: ManifestJson,
  changed: readonly EditReach[], pins: readonly PlacePin[]): string | null {
  const before = new Manifest(seed, beforeJson), after = new Manifest(seed, afterJson);
  const oldPatches = new Patchwork(seed, undefined, 1, elevationFor(before), terrainFor(before));
  const newPatches = new Patchwork(seed, undefined, 1, elevationFor(after), terrainFor(after));
  for (const pin of pins) {
    // A brush can reroute water or resite a structure elsewhere in every patch it touches.
    // Checking only its circular footprint misses saved places in the same regrown patch.
    if (!changed.some((one) => Math.floor(pin.x / PATCH) >= Math.floor((one.x - one.reach) / PATCH)
      && Math.floor(pin.x / PATCH) <= Math.floor((one.x + one.reach) / PATCH)
      && Math.floor(pin.z / PATCH) >= Math.floor((one.z - one.reach) / PATCH)
      && Math.floor(pin.z / PATCH) <= Math.floor((one.z + one.reach) / PATCH))) continue;
    const oldSampler = oldPatches.at(pin.x, pin.z), newSampler = newPatches.at(pin.x, pin.z);
    const oldLand = oldSampler.probe(pin.x, pin.z).land;
    const newLand = newSampler.probe(pin.x, pin.z).land;
    if (pin.footing === 'land' && oldLand && !newLand)
      return `${pin.label} at ${Math.round(pin.x)}, ${Math.round(pin.z)} would be under water. This edit was not saved.`;
    if (pin.footing === 'sea' && !oldLand && newLand)
      return `${pin.label} at ${Math.round(pin.x)}, ${Math.round(pin.z)} would be on land. This edit was not saved.`;
    if (pin.footing === 'land' && oldLand && newLand) {
      const oldTile = oldSampler.newSample(), newTile = newSampler.newSample();
      oldSampler.sampleTile(Math.floor(pin.x), Math.floor(pin.z), oldTile);
      newSampler.sampleTile(Math.floor(pin.x), Math.floor(pin.z), newTile);
      if (oldTile.type !== TileType.Water && newTile.type === TileType.Water)
        return `${pin.label} at ${Math.round(pin.x)}, ${Math.round(pin.z)} would be in a river. This edit was not saved.`;
      const oldRock = oldSampler.ranges ? mountainAt(oldSampler.ranges, pin.x, pin.z) : null;
      const newRock = newSampler.ranges ? mountainAt(newSampler.ranges, pin.x, pin.z) : null;
      if (newlyBuried(oldRock, oldTile.height, newRock, newTile.height))
        return `${pin.label} at ${Math.round(pin.x)}, ${Math.round(pin.z)} would be inside a mountain. This edit was not saved.`;
    }
  }
  return null;
}

/** Keep every village that has a book, a memory, or a named event at its saved site. */
export function assessVillageContinuity(seed: number, beforeJson: ManifestJson, afterJson: ManifestJson,
  changed: readonly EditReach[], names: readonly string[], all: boolean): string | null {
  if (!all && names.length === 0) return null;
  const before = new Manifest(seed, beforeJson), after = new Manifest(seed, afterJson);
  const oldPatches = new Patchwork(seed, undefined, 1, elevationFor(before), terrainFor(before));
  const newPatches = new Patchwork(seed, undefined, 1, elevationFor(after), terrainFor(after));
  const wanted = new Set(names);
  const visited = new Set<string>();
  for (const one of changed) {
    const px0 = Math.floor((one.x - one.reach) / 512), px1 = Math.floor((one.x + one.reach) / 512);
    const pz0 = Math.floor((one.z - one.reach) / 512), pz1 = Math.floor((one.z + one.reach) / 512);
    for (let px = px0; px <= px1; px++) for (let pz = pz0; pz <= pz1; pz++) {
      const key = `${px},${pz}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const cx = px * 512 + 256, cz = pz * 512 + 256;
      const oldVillages = oldPatches.at(cx, cz).structures.villages;
      const newVillages = newPatches.at(cx, cz).structures.villages;
      for (const old of oldVillages) {
        if (!all && !wanted.has(old.name)) continue;
        const same = newVillages.find((v) => v.name === old.name && v.x === old.x && v.z === old.z);
        if (!same) return `The remembered village ${old.name} would move or disappear. This edit was not saved.`;
        const oldHouses = old.houses.map((h) => `${h.tx},${h.tz}`).sort();
        const newHouses = same.houses.map((h) => `${h.tx},${h.tz}`).sort();
        if (JSON.stringify(oldHouses) !== JSON.stringify(newHouses))
          return `The remembered village ${old.name} would lose a building site. This edit was not saved.`;
      }
    }
  }
  return null;
}
