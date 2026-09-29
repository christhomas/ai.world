import * as THREE from 'three';

/** Renderer diagnostics exposed only to development playtest hooks. */
export function exposeRenderer(debug: object): void {
  (debug as { __three?: unknown }).__three = THREE;
}
