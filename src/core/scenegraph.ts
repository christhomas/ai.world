import type { FrameDescription, ScenePlacement, ScenePropPart } from './scene';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Mutable, graphics API independent description of a place's fixed scenery. */
export interface SceneGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  flow?: Float32Array;
  sea?: Float32Array;
}

/**
 * A light's colour: an authored sRGB hex, as everywhere else, or linear RGB worked out at run time.
 *
 * The linear form is there because a computed light can be warmer than white. Autumn multiplies the
 * sun by a red of 1.04; a hex clamps that channel to one before the intensity is ever applied, and
 * the whole frame loses its warmth. So the renderer is handed the channels as they were computed.
 */
export type LightColour = number | readonly [number, number, number];

export type SceneNode =
  | { kind: 'ambient'; colour: LightColour; intensity: number }
  | { kind: 'hemisphere'; sky: LightColour; ground: LightColour; intensity: number }
  | { kind: 'point'; colour: LightColour; intensity: number; distance: number; decay: number; position: [number, number, number] }
  | { kind: 'directional'; colour: LightColour; intensity: number; position: [number, number, number]; target: [number, number, number]; castShadow: boolean }
  | { kind: 'prop-batch'; parts: readonly ScenePropPart[]; glowParts?: readonly ScenePropPart[];
      glowColour?: number; placements: readonly ScenePlacement[]; castShadow: boolean; receiveShadow: boolean }
  | { kind: 'instances'; geometry: SceneGeometry; colour: number; count: number;
      matrices: Float32Array; colours?: Float32Array; castShadow: boolean; receiveShadow: boolean;
      renderOrder?: number; material?: {
        intent?: 'lit' | 'unlit'; colour?: number; emissive?: number; vertexColours?: boolean;
        transparent?: boolean; opacity?: number; depthWrite?: boolean; depthTest?: boolean;
        toneMapped?: boolean; side?: 'front' | 'back' | 'double'; effects?: string[];
      } }
  | { kind: 'points'; positions: Float32Array; colour: number; size: number; opacity: number; visible: boolean }
  | { kind: 'mesh'; geometry: SceneGeometry; material: 'lit-vertex-colours' | 'lit-solid' | 'water'; colour?: number;
      castShadow?: boolean; receiveShadow: boolean; renderOrder?: number; world?: number[];
      frustumCulled?: boolean; visible?: boolean; effects?: string[];
      materialState?: Partial<NonNullable<FrameDescription['nodes'][number]['material']>> };

/** Linear to sRGB, as three.js converts it, so a linear light's hex is the one WebGL would report. */
function srgbChannel(linear: number): number {
  const c = linear < 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 0.41666) - 0.055;
  return Math.round(Math.min(255, Math.max(0, c * 255)));
}

/**
 * A light colour as a frame carries it: always the hex, which is all a renderer that reads only a
 * hex can use, and the unclamped linear channels as well whenever the engine computed them.
 */
function lightColour(colour: LightColour): { colour: number; linearColour?: [number, number, number] } {
  if (typeof colour === 'number') return { colour };
  const [r, g, b] = colour;
  return { colour: srgbChannel(r) * 65536 + srgbChannel(g) * 256 + srgbChannel(b), linearColour: [r, g, b] };
}

/** The engine owns these values; a renderer decides how to display them. */
export class SceneGraph {
  readonly nodes: SceneNode[] = [];
  /** The camera chosen by the engine for the next submitted frame. */
  camera: FrameDescription['camera'] | null = null;
  fog: FrameDescription['fog'] = null;
  cutaway: FrameDescription['cutaway'] = null;
  /** The season's tint on whatever lists the `'season'` effect; see `FrameDescription.season`. */
  season: FrameDescription['season'] = null;
  coast: FrameDescription['coast'] = null;

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
      cutaway: this.cutaway,
      season: this.season,
      coast: this.coast,
      nodes: this.nodes.map((node): FrameDescription['nodes'][number] => {
        const base = { parent: -1, world: IDENTITY, visible: true, castShadow: false, receiveShadow: false };
        if (node.kind === 'ambient') return {
          ...base, kind: 'ambient' as const, ...lightColour(node.colour), intensity: node.intensity,
        };
        if (node.kind === 'hemisphere') {
          const ground = lightColour(node.ground);
          return {
            ...base, kind: 'hemisphere' as const, ...lightColour(node.sky), groundColour: ground.colour,
            ...(ground.linearColour ? { linearGroundColour: ground.linearColour } : {}), intensity: node.intensity,
          };
        }
        if (node.kind === 'point') return {
          ...base, kind: 'point' as const, ...lightColour(node.colour), intensity: node.intensity,
          distance: node.distance, decay: node.decay,
          world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...node.position, 1],
        };
        if (node.kind === 'directional') return {
          ...base, kind: 'directional' as const, ...lightColour(node.colour),
          intensity: node.intensity,
          castShadow: node.castShadow, target: node.target,
          world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...node.position, 1],
        };
        if (node.kind === 'prop-batch') return {
          ...base, kind: 'prop-batch' as const, castShadow: node.castShadow,
          receiveShadow: node.receiveShadow, parts: node.parts,
          glowParts: node.glowParts, glowColour: node.glowColour, placements: node.placements,
        };
        if (node.kind === 'instances') return {
          ...base, kind: 'instances' as const, visible: node.count > 0, castShadow: node.castShadow,
          receiveShadow: node.receiveShadow, renderOrder: node.renderOrder,
          material: { intent: 'lit' as const, colour: node.colour, emissive: 0,
            vertexColours: false, transparent: false, opacity: 1, depthWrite: true,
            side: 'front' as const, effects: [], ...node.material },
          attributes: {
            position: { size: 3, values: node.geometry.positions },
            normal: { size: 3, values: node.geometry.normals },
          },
          indices: node.geometry.indices,
          instanceMatrices: node.matrices.subarray(0, node.count * 16),
          instanceColours: node.colours?.subarray(0, node.count * 3),
        };
        if (node.kind === 'points') return {
          ...base, kind: 'points' as const, visible: node.visible,
          material: { intent: 'points' as const, colour: node.colour, emissive: 0,
            vertexColours: false, transparent: true, opacity: node.opacity,
            depthWrite: true, side: 'front' as const, effects: [], size: node.size },
          attributes: { position: { size: 3, values: node.positions } },
        };
        return {
          ...base, kind: 'mesh' as const, visible: node.visible ?? true, castShadow: node.castShadow ?? false,
          receiveShadow: node.receiveShadow,
          world: node.world ?? IDENTITY,
          renderOrder: node.renderOrder,
          material: {
            intent: node.material === 'water' ? 'water' as const : 'lit' as const,
            colour: node.colour ?? 0xffffff, emissive: 0, vertexColours: node.material !== 'lit-solid',
            transparent: node.material === 'water', opacity: node.material === 'water' ? 0.82 : 1,
            depthWrite: node.material !== 'water',
            side: node.material === 'water' ? 'double' as const : 'front' as const,
            effects: node.effects ?? [], ...node.materialState,
          },
          attributes: {
            position: { size: 3, values: node.geometry.positions },
            normal: { size: 3, values: node.geometry.normals },
            ...(node.geometry.colors ? { color: { size: 3, values: node.geometry.colors } } : {}),
            ...(node.geometry.flow ? { flow: { size: 1, values: node.geometry.flow } } : {}),
            ...(node.geometry.sea ? { sea: { size: 1, values: node.geometry.sea } } : {}),
          },
          indices: node.geometry.indices,
        };
      }),
    };
  }
}
