import { Manifest, type ManifestJson } from '../world/manifest';
import { PatchCountry } from '../world/patchcountry';
import { RoadCountry, type Country, type WorldKind } from '../world/countries';
import { TerrainSampler } from '../world/terrain';
import { elevationFor, growWorld, islandsFor, stampFor, terrainFor } from '../world/growworld';
import { viewOf } from '../world/patchview';
import { aroundOf, aroundPatches } from '../world/around';
import type { GrownPatch } from '../world/endless';

/** The saved facts and starting position needed to stand a production country up. */
export interface CountryStart {
  seed: number;
  world: WorldKind;
  savedManifest?: ManifestJson;
  home?: GrownPatch;
  /** Installed hosts may start directly in the saved patch instead of growing the origin first. */
  start?: { x: number; z: number };
}

/** Production ground and discovery state, without a renderer, worker or browser storage. */
export function growCountryState({ seed, world, savedManifest, home, start }: CountryStart) {
  const manifest = new Manifest(seed, savedManifest);
  const layers = elevationFor(manifest), terrain = terrainFor(manifest);
  const endless = world === 'endless'
    ? new PatchCountry(seed, start?.x ?? 0, start?.z ?? 0, undefined, layers, home, terrain) : null;
  const country: Country = endless ?? new RoadCountry(seed, new TerrainSampler(growWorld(seed, islandsFor(manifest, seed))));
  const view = viewOf(country);
  const around = country.store ? aroundPatches(country.store) : aroundOf(country.sampler.structures);
  const stamp = stampFor(world, seed, view.graph, layers, terrain);
  return { manifest, country, endless, view, around, stamp,
    get sampler() { return view.sampler; },
    get graph() { return view.graph; },
    get structures() { return view.structures; },
    get highPlaces() { return view.highPlaces; },
  };
}
