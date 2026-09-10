import { WORLD } from '../core/config';
import { DayCycle } from '../render/daycycle';
import { MountainMaterial, buildMountainMesh } from '../render/mountains';
import type { PropLibrary } from '../render/props';
import type { SceneRig } from '../render/scene';
import type { SeasonTintMaterials } from '../render/seasontint';
import { SkyIslands } from '../render/skyisland';
import { ChunkManager } from '../world/chunkManager';
import { generateRoadGraph, planIslands } from '../world/graph';
import { growWorld } from '../world/growworld';
import { Manifest } from '../world/manifest';
import { rangesAsMassifs } from '../world/ranges';
import { buildSkyIsland, planSkyIslands } from '../world/skyisland';
import { TerrainSampler, TileType } from '../world/terrain';
import type { WorldKind } from '../save/store';
import type { ManifestJson } from '../world/manifest';
import { planEyries } from './eyries';
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
  const islands = world === 'mesh' ? [] : islandsOf(manifest, seed);
  /*
   * And the country itself, through the one call there is. Not "the same call the world makes" —
   * literally the one call, which is the difference between two halves that agree and two halves
   * that cannot disagree. `src/world/growworld.ts` says why that distinction cost this project two
   * unplayable worlds.
   */
  const graph = growWorld(seed, world, islands);
  const sampler = new TerrainSampler(graph);
  /**
   * The world's mountains, whichever kind this world grew: the road-tree world's domes, or the
   * polygon world's ranges described in the same terms. Everything that stands something on a
   * mountain — the eagles, the villages in the clouds, the goats — reads this rather than either.
   */
  const highPlaces = sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs;
  const structures = sampler.structures;
  const daycycle = new DayCycle(rig);
  rig.sunDriven = true;
  const chunks = new ChunkManager(rig.scene, sampler, props, rig.water.material, daycycle.glowMaterial);
  chunks.useSeasonTint(seasonTintMaterials);

  // The mountains go into the scene once and stay there. They are one shape the size of a county,
  // not something streamed in squares as the hero walks, and they are visible from most of the
  // world — the whole of a world's mountain country is fewer triangles than a single chunk of
  // ground, so there is nothing to gain by taking them away again.
  const rock = new MountainMaterial();
  if (sampler.ranges) {
    const range = buildMountainMesh(sampler.ranges, rock.material);
    if (range) rig.scene.add(range);
  }
  // and the camera's own answer to them: it stands further back near a range, because a peak is
  // taller than the picture is and would otherwise be cut off by the top of its own frustum
  const skyline = new Skyline(sampler.ranges);

  // the crags with eagles on them: one pair per range big enough to be worth flying over, each
  // perch shuffled round the shoulder until it stands on ground somebody can actually reach
  const eyries = planEyries(seed, highPlaces, (x, z) => sampler.probe(x, z).land);

  // The villages in the clouds: additional geometry over the world's islands, not a replacement
  // for any of it. The chunks below are generated and drawn exactly as they were, and the sky
  // islands go into the same outdoor scene on top of them, so standing at a rim and looking down
  // shows the real country.
  const skyIsles = planSkyIslands(seed, graph.islands, highPlaces, (x, z) => sampler.probe(x, z).land).map((site) =>
    buildSkyIsland(
      site,
      manifest.ensure(site.id, 'skyisle', site.x, site.z, site.over).seed,
      (x, z) => sampler.probe(x, z).land,
    ));
  const skyRenderer = new SkyIslands(rig.scene, props, rig.water.material, daycycle.glowMaterial);
  skyRenderer.useSeasonTint(seasonTintMaterials);
  const groundSample = sampler.newSample();
  for (const isle of skyIsles) {
    skyRenderer.add(isle, (x, z) => {
      // where the fall lands. Taken from the sampler rather than from a loaded chunk because the
      // island is built before anything has streamed in, and a plume that stops at zero when the
      // ground under it is four terraces up hangs in the air with a gap under it.
      sampler.sampleTile(Math.floor(x), Math.floor(z), groundSample);
      return groundSample.type === TileType.Skip || groundSample.type === TileType.Seabed
        ? WORLD.WATER_Y : groundSample.height;
    });
  }

  return {
    graph, islands, manifest, sampler, structures, highPlaces, daycycle, chunks, rock, skyline,
    eyries, skyIsles, skyRenderer,
  };
}
