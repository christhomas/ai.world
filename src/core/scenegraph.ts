import type { FrameDescription, ScenePlacement, ScenePropPart } from './scene';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Mutable, graphics API independent description of a place's fixed scenery. */
export interface SceneGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors?: Float32Array;
  indices?: Uint32Array;
  flow?: Float32Array;
}

export type SceneNode =
  | { kind: 'ambient'; colour: number; intensity: number }
  | { kind: 'hemisphere'; sky: number; ground: number; intensity: number }
  | { kind: 'point'; colour: number; intensity: number; distance: number; decay: number; position: [number, number, number] }
  | { kind: 'directional'; colour: number; intensity: number; position: [number, number, number]; target: [number, number, number]; castShadow: boolean }
  | { kind: 'prop-batch'; parts: readonly ScenePropPart[]; glowParts?: readonly ScenePropPart[];
      placements: readonly ScenePlacement[]; castShadow: boolean; receiveShadow: boolean }
  | { kind: 'instances'; geometry: SceneGeometry; colour: number; count: number;
      matrices: Float32Array; colours?: Float32Array; castShadow: boolean; receiveShadow: boolean }
  | { kind: 'mesh'; geometry: SceneGeometry; material: 'lit-vertex-colours' | 'water';
      castShadow?: boolean; receiveShadow: boolean; renderOrder?: number };

/** The engine owns these values; a renderer decides how to display them. */
export class SceneGraph {
  readonly nodes: SceneNode[] = [];
  /** The camera chosen by the engine for the next submitted frame. */
  camera: FrameDescription['camera'] | null = null;
  fog: FrameDescription['fog'] = null;

  constructor(public background: number) {}

  add(node: SceneNode): SceneNode { this.nodes.push(node); return node; }

  remove(node: SceneNode): void {
    const at = this.nodes.indexOf(node);
    if (at >= 0) this.nodes.splice(at, 1);
  }

  /** Capture exactly what both the drawing and recording pipelines will receive. */
  frame(): FrameDescription {
    if (!this.camera) throw new Error('scene graph has no camera for this frame');
    return {
      camera: this.camera,
      background: this.background,
      fog: this.fog,
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
        if (node.kind === 'directional') return {
          ...base, kind: 'directional' as const, colour: node.colour, intensity: node.intensity,
          castShadow: node.castShadow, target: node.target,
          world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...node.position, 1],
        };
        if (node.kind === 'prop-batch') return {
          ...base, kind: 'prop-batch' as const, castShadow: node.castShadow,
          receiveShadow: node.receiveShadow, parts: node.parts,
          glowParts: node.glowParts, placements: node.placements,
        };
        if (node.kind === 'instances') return {
          ...base, kind: 'instances' as const, castShadow: node.castShadow,
          receiveShadow: node.receiveShadow,
          material: { intent: 'lit' as const, colour: node.colour, emissive: 0,
            vertexColours: false, transparent: false, opacity: 1, depthWrite: true,
            side: 'front' as const, effects: [] },
          attributes: {
            position: { size: 3, values: node.geometry.positions },
            normal: { size: 3, values: node.geometry.normals },
          },
          indices: node.geometry.indices,
          instanceMatrices: node.matrices.subarray(0, node.count * 16),
          instanceColours: node.colours?.subarray(0, node.count * 3),
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
            position: { size: 3, values: node.geometry.positions },
            normal: { size: 3, values: node.geometry.normals },
            ...(node.geometry.colors ? { color: { size: 3, values: node.geometry.colors } } : {}),
            ...(node.geometry.flow ? { flow: { size: 1, values: node.geometry.flow } } : {}),
          },
          indices: node.geometry.indices,
        };
      }),
    };
  }
}
