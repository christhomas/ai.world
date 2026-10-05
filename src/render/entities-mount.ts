import type { SceneGraph } from '../core/scenegraph';
import { EntityRenderer } from './entities';
import { sceneForGraph } from './scenegraph';

/** Browser places mount the same production buffer producer into their retained scene. */
export function entityRendererFor(graph: SceneGraph): EntityRenderer {
  return new EntityRenderer(sceneForGraph(graph), graph);
}
