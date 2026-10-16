import type { SceneGraph } from '../core/scenegraph';
import type { PropLibrary } from './props';
import type { DayCycle } from './daycycle';
import { sceneForGraph } from './scenegraph';
import { EntityRenderer } from './entities';
import { entityRendererFor } from './entities-mount';
import { Weather } from './weather';
import { HeroGear } from './herogear';
import { Updraughts } from './updraughts';
import { Swallows } from './swallows';
import { Shafts } from './shafts';
import { Beam } from './beam';
import { putBoatIn } from './boat';
import { CropField } from './crops';
import { BuildingSite } from './site';
import { putFerriesOut } from './ferries';
import { DropField } from './drops';
import { WhaleSchool } from './whales';
import { CampField } from './wildcamps';

/** Mount surface renderers behind the neutral graph; game assembly never handles the WebGL scene. */
export function surfaceRenderers(graph: SceneGraph, props: PropLibrary, daycycle: DayCycle, seed: number) {
  const scene = sceneForGraph(graph);
  return {
    entities: () => entityRendererFor(graph),
    weather: () => new Weather(scene, seed, graph),
    gear: () => new HeroGear(scene, graph),
    updraughts: () => new Updraughts(scene, seed, graph),
    swallows: () => new Swallows(scene, seed, graph),
    shafts: () => new Shafts(scene, seed, graph),
    beam: (entities: EntityRenderer, gear: HeroGear) => new Beam(scene, entities, gear.group, graph),
    boat: () => putBoatIn(scene, graph),
    crops: () => new CropField(scene, props, daycycle.glowMaterial, graph),
    buildingSite: () => new BuildingSite(scene, props, daycycle.glowMaterial, graph),
    ferries: <Line>(lines: Line[]) => putFerriesOut(lines, scene, graph),
    drops: () => new DropField(scene, graph),
    whales: () => new WhaleSchool(scene, graph),
    camps: () => new CampField(scene, graph),
  };
}
