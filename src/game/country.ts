import { DayCycle } from '../render/daycycle';
import { MountainMaterial } from '../render/mountains';
import { countryRenderers } from '../render/country-mount';
import type { PropLibrary } from '../render/props';
import type { SceneRig } from '../render/scene';
import type { SeasonTintMaterials } from '../render/seasontint';
import type { GrownPatch } from '../world/endless';
import type { WorldKind } from '../world/countries';
import { growerFor } from '../world/countryworker';
import type { ManifestJson } from '../world/manifest';
import { HighCountry } from './highcountry';
import { Skyline } from '../render/skyline';
import { growCountryState } from './country-state';

/**
 * The ground this game is played on, and everything standing on it that was settled before
 * anybody arrived.
 *
 * All of it comes out of the seed, so none of it is remembered — except the anchors, which are in
 * the manifest because a place has to keep the same name and the same shape between one visit and
 * the next. Grown in one go up front because everything else in the game asks the ground a
 * question before it can do anything at all.
 */
export interface Growing {
  seed: number;
  /**
   * Which world to grow. It comes from the save whenever there is one, because the same seed grows
   * two completely different countries and reopening a world as the other kind would put the ground
   * somewhere else under a house, a planted field and every anchor the manifest holds.
   */
  /**
   * Which generator grows it. It comes from the save whenever there is one, because the same seed
   * grows two completely different countries and reopening a world as the other kind would put the
   * ground somewhere else under a house, a planted field and every anchor the manifest holds.
   */
  world: WorldKind;
  savedManifest: ManifestJson | undefined;
  /**
   * The home patch, if somebody has already grown it.
   *
   * The title screen grows it to measure the seed it is about to open, and this world used to grow
   * the same square again the moment it opened — see #358. It travels as parts rather than as a
   * sampler because that is how it left the worker it was grown in, and it is `PatchCountry` that
   * puts it back together, because the store that would otherwise have grown it is the thing that
   * should own it. Missing for a continued world, a typed seed and a bounded one, none of which
   * measures anything.
   */
  home?: GrownPatch;
  rig: SceneRig;
  props: PropLibrary;
  seasonTintMaterials: SeasonTintMaterials;
}

/**
 * And the type of one, published here rather than imported from `world/endless` where it lives.
 *
 * `main.ts` is what hands one over and it is two lines under the seven hundred
 * `architecture.test.ts` allows — an import line of its own is one of those two. It calls
 * `growCountry`, so the type it must name comes through the same door as the function, which is
 * also the more honest reading of it: what `main.ts` knows is that this module takes one.
 */
export type { GrownPatch };

/**
 * A world's islands: the ones it was saved with, or the ones its seed says it should have.
 *
 * Written down the moment they are known, so a world saved today is saved with them and a world
 * saved yesterday keeps the ones it had.
 */
export function growCountry(ctx: Growing) {
  const { seed, world, savedManifest, home, rig, props, seasonTintMaterials } = ctx;

  // Shared production boot: the manifest, terrain and live patch view have no browser mounts.
  const state = growCountryState({ seed, world, savedManifest, home });
  const { manifest, country, endless, view, around } = state;
  const sampler = state.sampler;
  // The browser owns background growth; an installed host supplies its own scheduling separately.
  const grower = endless ? growerFor(seed, endless) : null;
  const daycycle = new DayCycle(rig);
  rig.sunDriven = true;
  const visuals = countryRenderers(rig, props, daycycle);
  // handed the patchwork as well, for a world whose chunks are painted patch by patch
  const chunks = visuals.chunks(
    sampler, country.store ?? undefined,
    grower ? (patch) => grower.want(patch) : undefined,
  );
  chunks.useSeasonTint(seasonTintMaterials);

  // The mountains go into the scene once and stay there. They are one shape the size of a county,
  // not something streamed in squares as the hero walks, and they are visible from most of the
  // world — the whole of a world's mountain country is fewer triangles than a single chunk of
  // ground, so there is nothing to gain by taking them away again.
  const rock = new MountainMaterial();
  /*
   * Held by something that can swap it, even though a bounded world never will.
   *
   * One code path rather than two: the rock of a country with no edge belongs to the patch the hero
   * is standing in and changes as he walks, and the difference between that and this is a call to
   * `show`. `Mountains` owns the three things that have to happen together on a swap — the old mesh
   * leaves the scene, its geometry is disposed, the new one is built — and handed the same ranges
   * twice it does nothing, so the endless world can call it on every crossing without asking first.
   */
  const mountains = visuals.mountains(rock);
  mountains.show(sampler.ranges);
  // and the camera's own answer to them: it stands further back near a range, because a peak is
  // taller than the picture is and would otherwise be cut off by the top of its own frustum
  const skyline = new Skyline(sampler.ranges);

  /*
   * The crags with eagles on them and the villages in the clouds, both of which belong to the rock
   * under them — so in a country with no edge both belong to the patch the hero is standing in.
   *
   * Held by something that can swap them, for the same reason the mountains are: one code path
   * rather than two, and a bounded world simply never crosses. `highcountry.ts` says what goes
   * wrong without it, which is the mountains' own failure one layer up — islands over country
   * behind you, and crags that are not there.
   */
  const skyRenderer = visuals.skyIslands();
  skyRenderer.useSeasonTint(seasonTintMaterials);
  const high = new HighCountry(seed, manifest, skyRenderer);
  high.standOn(sampler);
  const eyries = high.eyries;
  const skyIsles = high.isles;

  return {
    manifest, around, daycycle, chunks, rock, mountains, skyline,
    /**
     * This country's own fingerprint, for the one the world sends at a join to be held against.
     *
     * Taken here rather than at the join because this is where it is known what kind of country
     * this is, and the two kinds have different whole-country facts to hash — `stampFor` is where
     * that choice lives and says why. `main.ts` used to take this itself out of the graph and the
     * layers, which worked only for as long as the graph it was handed was a bounded world's;
     * handed a patch's graph it would compare the square the hero is standing in against the
     * square the server grew first and report a disagreement that is not one.
     */
    stamp: state.stamp,
    /*
     * Live, not read once. Anything that keeps one of these past the frame it asked in keeps it
     * across a patch crossing too, which is the fault `patchview.ts` exists to have ended.
     */
    get sampler() { return view.sampler; },
    get graph() { return view.graph; },
    get structures() { return view.structures; },
    get highPlaces() { return view.highPlaces; },
    eyries, skyIsles, skyRenderer, high,
    /**
     * The country itself, for a world that has no edge: what to tell when the hero has walked into
     * another patch, and what to ask for the sampler that answers where he is now.
     *
     * Null for a bounded world, which is the whole of how the rest of the game tells them apart.
     */
    endless,
    /** Who is growing the country elsewhere, for the frame to keep asking and for a readout. */
    grower,
  };
}
