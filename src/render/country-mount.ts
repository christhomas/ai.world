import { nativeRig, type SceneRig } from './scene';
import type { PropLibrary } from './props';
import type { DayCycle } from './daycycle';
import { ChunkManager } from './chunkManager';
import { Mountains, type MountainMaterial } from './mountains';
import { SkyIslands } from './skyisland';

/** The country passes neutral world data; WebGL scene and materials stay in the render layer. */
export function countryRenderers(rig: SceneRig, props: PropLibrary, daycycle: DayCycle) {
  const { scene, water } = nativeRig(rig);
  return {
    chunks: (
      sampler: ConstructorParameters<typeof ChunkManager>[2],
      patches?: ConstructorParameters<typeof ChunkManager>[6],
      wantPatch?: ConstructorParameters<typeof ChunkManager>[7],
    ) => new ChunkManager(
      scene, rig.graph, sampler, props, water.material, daycycle.glowMaterial, patches, wantPatch,
    ),
    mountains: (rock: MountainMaterial) => new Mountains(scene, rock.material, rig.graph),
    skyIslands: () => new SkyIslands(scene, props, water.material, daycycle.glowMaterial, rig.graph),
  };
}
