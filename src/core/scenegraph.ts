/** Mutable, graphics API independent description of a place's fixed scenery. */
export interface SceneGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colours: Float32Array;
}

export type SceneNode =
  | { kind: 'ambient'; colour: number; intensity: number }
  | { kind: 'hemisphere'; sky: number; ground: number; intensity: number }
  | { kind: 'point'; colour: number; intensity: number; distance: number; decay: number; position: [number, number, number] }
  | { kind: 'mesh'; geometry: SceneGeometry; material: 'lit-vertex-colours'; receiveShadow: boolean };

/** The engine owns these values; a renderer decides how to display them. */
export class SceneGraph {
  readonly nodes: SceneNode[] = [];

  constructor(readonly background: number) {}

  add(node: SceneNode): void { this.nodes.push(node); }
}
