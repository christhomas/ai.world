import * as THREE from 'three';
import { nativeRig, type SceneRig } from './scene';

/**
 * Renderer diagnostics exposed only to development playtest hooks: three.js itself, and the live
 * WebGL scene, which `tools/shots.cjs` walks to freeze moving layers for a fixed shot.
 *
 * Published from here rather than handed to the game to publish. A rig method that returned the
 * scene was a door in the rig's public face, and anything holding a rig could have walked through
 * it.
 */
export function exposeRenderer(debug: object, rig: SceneRig): void {
  (debug as { __three?: unknown }).__three = THREE;
  // looked up when read, so only a capture that asks for the scene resolves it
  Object.defineProperty(debug, '__scene', { configurable: true, get: () => nativeRig(rig).scene });
}
