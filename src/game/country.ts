import { WORLD } from '../core/config';
import { DayCycle } from '../render/daycycle';
import { MountainMaterial, Mountains } from '../render/mountains';
import type { PropLibrary } from '../render/props';
import type { SceneRig } from '../render/scene';
import type { SeasonTintMaterials } from '../render/seasontint';
import { SkyIslands } from '../render/skyisland';
import { aroundOf, aroundPatches } from '../world/around';
import { ChunkManager } from '../world/chunkManager';
import { generateRoadGraph, planIslands } from '../world/graph';
import { growWorld } from '../world/growworld';
import { Manifest } from '../world/manifest';
import { rangesAsMassifs } from '../world/ranges';
import { buildSkyIsland, planSkyIslands } from '../world/skyisland';
import { PatchCountry } from '../world/patchcountry';
import { growerFor } from '../world/countryworker';
import { TerrainSampler, TileType } from '../world/terrain';
import type { WorldKind } from '../save/store';
import type { ManifestJson } from '../world/manifest';
import { HighCountry } from './highcountry';
import { Skyline } from './skyline';

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
  world: WorldKind;
  savedManifest: ManifestJson | undefined;
  rig: SceneRig;
  props: PropLibrary;
  seasonTintMaterials: SeasonTintMaterials;
}

/**
 * A world's islands: the ones it was saved with, or the ones its seed says it should have.
 *
 * Written down the moment they are known, so a world saved today is saved with them and a world
 * saved yesterday keeps the ones it had.
 */
function islandsOf(manifest: Manifest, seed: number) {
  const saved = manifest.byKind('island');
  if (saved.length > 0) return saved;
  for (const p of planIslands(generateRoadGraph(seed), seed)) manifest.ensure(p.id, 'island', p.x, p.z);
  return manifest.byKind('island');
}

export function growCountry(ctx: Growing) {
  const { seed, world, savedManifest, rig, props, seasonTintMaterials } = ctx;

  // chosen when the world was made and written into its save, so it never changes underneath one
  const manifest = new Manifest(seed, savedManifest);
  /*
   * The islands this world has, which is the one thing about a country the seed does not settle.
   *
   * The manifest has the last word, and that is the reason they are worked out here and handed in:
   * a world saved before the islands were planned from the seed may have them somewhere else, and
   * moving them would move the ground out from under a house that was built on one. They go up the
   * wire with the join for the same reason — see `growWorld`.
   */
  /*
   * A country with no edge, when that is the kind of world this is.
   *
   * It is grown round the origin because that is where a fresh hero stands; when a save says
   * otherwise the first `moveTo` of the frame puts it where he actually is, which costs one patch
   * grown and thrown away and is not worth a special case to avoid.
   */
  const endless = world === 'endless' ? new PatchCountry(seed, 0, 0) : null;
  /*
   * And somebody else to grow the rest of it.
   *
   * A patch is five seconds on this thread and a tenth of a second to put back together from its
   * parts, so the worker grows and the page rebuilds. It is an optimisation and never a guarantee:
   * the square the hero is standing in has to exist now, and if the worker has not got to it he
   * gets the five seconds rather than a hole in the world. Everything about the arrangement is
   * aimed at making that rare — ask for the neighbours while there is still ground underfoot.
   */
  const grower = endless ? growerFor(seed, endless) : null;
  const islands = endless ? [] : islandsOf(manifest, seed);
  /*
   * And the country itself, through the one call there is. Not "the same call the world makes" —
   * literally the one call, which is the difference between two halves that agree and two halves
   * that cannot disagree. `src/world/growworld.ts` says why that distinction cost this project two
   * unplayable worlds.
   */
  const sampler = endless ? endless.sampler : new TerrainSampler(growWorld(seed, world, islands));
  const graph = sampler.graph;
  /**
   * The world's mountains, whichever kind this world grew: the road-tree world's domes, or the
   * polygon world's ranges described in the same terms. Everything that stands something on a
   * mountain — the eagles, the villages in the clouds, the goats — reads this rather than either.
   */
  const highPlaces = sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs;
  const structures = sampler.structures;
  /*
   * What is near wherever anybody is standing, which is what the game has always meant by asking
   * for "the structures".
   *
   * This is the one place in the game the two kinds of country part company on that question, and
   * it is the right place: the fork between bounded and endless already lives on this page. A
   * bounded world holds every village it will ever have in one list, so the answer is a filter. An
   * endless one has villages in whichever squares somebody has walked into, so the answer is to ask
   * those squares — and never to grow one, because a question about your surroundings that cost a
   * second of country would stutter the frame it was asked in.
   *
   * Everything above this line goes on holding `structures` as well, and should: a signpost naming
   * the towns of the patch it stands in is a different question from what is near the hero, and so
   * is a console that lists every village in the world on purpose. `world/around.ts` is only for the
   * ones that meant "near me" all along.
   */
  const around = endless ? aroundPatches(endless.store) : aroundOf(structures);
  const daycycle = new DayCycle(rig);
  rig.sunDriven = true;
  // handed the patchwork as well, for a world whose chunks are painted patch by patch
  const chunks = new ChunkManager(
    rig.scene, sampler, props, rig.water.material, daycycle.glowMaterial, endless?.store,
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
  const mountains = new Mountains(rig.scene, rock.material);
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
  const skyRenderer = new SkyIslands(rig.scene, props, rig.water.material, daycycle.glowMaterial);
  skyRenderer.useSeasonTint(seasonTintMaterials);
  const high = new HighCountry(seed, manifest, skyRenderer);
  high.standOn(sampler);
  const eyries = high.eyries;
  const skyIsles = high.isles;

  return {
    graph, islands, manifest, sampler, structures, around, highPlaces, daycycle, chunks, rock, mountains, skyline,
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
