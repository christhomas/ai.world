import * as THREE from 'three';
import { EntityRenderer } from './entities';

/**
 * A creature renderer drawing into a scene nobody looks at.
 *
 * The rules that hold a slot for a creature, hide a rider or break up a body ask the renderer and
 * never the picture, so their tests want one of these and nothing else. It lives here so that
 * those tests, like the code they test, never have to name the graphics API to get one.
 */
export function offscreenEntityRenderer(): EntityRenderer {
  return new EntityRenderer(new THREE.Scene());
}
