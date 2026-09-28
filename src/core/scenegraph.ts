import type { FrameDescription } from './scene';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Mutable, graphics API independent description of a place's fixed scenery. */
export interface SceneGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices?: Uint32Array;
  flow?: Float32Array;
}

export type SceneNode =
  | { kind: 'ambient'; colour: number; intensity: number }
  | { kind: 'hemisphere'; sky: number; ground: number; intensity: number }
  | { kind: 'point'; colour: number; intensity: number; distance: number; decay: number; position: [number, number, number] }
  | { kind: 'mesh'; geometry: SceneGeometry; material: 'lit-vertex-colours' | 'water';
      castShadow?: boolean; receiveShadow: boolean; renderOrder?: number };

/** The engine owns these values; a renderer decides how to display them. */
export class SceneGraph {
  readonly nodes: SceneNode[] = [];
  /** The camera chosen by the engine for the next submitted frame. */
  camera: FrameDescription['camera'] | null = null;

  constructor(public background: number) {}

  add(node: SceneNode): void { this.nodes.push(node); }

  /** Capture exactly what both the drawing and recording pipelines will receive. */
  frame(): FrameDescription {
    if (!this.camera) throw new Error('scene graph has no camera for this frame');
    return {
      camera: this.camera,
      background: this.background,
      fog: null,
      nodes: this.nodes.map((node) => {
        const base = { parent: -1, world: IDENTITY, visible: true, castShadow: false, receiveShadow: false };
        if (node.kind === 'ambient') return { ...base, kind: 'ambient' as const, colour: node.colour, intensity: node.intensity };
        if (node.kind === 'hemisphere') return {
          ...base, kind: 'hemisphere' as const, colour: node.sky, groundColour: node.ground, intensity: node.intensity,
        };
        if (node.kind === 'point') return {
          ...base, kind: 'point' as const, colour: node.colour, intensity: node.intensity,
          distance: node.distance, decay: node.decay,
          world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...node.position, 1],
        };
        return {
          ...base, kind: 'mesh' as const, castShadow: node.castShadow ?? false,
          receiveShadow: node.receiveShadow,
          material: {
            intent: node.material === 'water' ? 'water' as const : 'lit' as const,
            colour: 0xffffff, emissive: 0, vertexColours: true,
            transparent: node.material === 'water', opacity: 1, depthWrite: node.material !== 'water',
            side: 'front' as const, effects: [],
          },
          attributes: {
            position: { size: 3, values: Array.from(node.geometry.positions) },
            normal: { size: 3, values: Array.from(node.geometry.normals) },
            color: { size: 3, values: Array.from(node.geometry.colors) },
            ...(node.geometry.flow ? { flow: { size: 1, values: Array.from(node.geometry.flow) } } : {}),
          },
          indices: node.geometry.indices ? Array.from(node.geometry.indices) : undefined,
        };
      }),
    };
  }
}
