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

/**
 * One thing in the scene, as the engine describes it.
 *
 * A `readonly` field says what the node is and is read once, when the node is first framed; to
 * change one, remove the node and add another. Any other field may be set whenever the engine
 * likes, and the next frame shows it. Arrays may be written into in place, but a mesh's material
 * state is replaced rather than written into, because the frame copies its fields. A frame keeps
 * a node's entry for as long as none of this changes (#511).
 */
export type SceneNode =
  | { readonly kind: 'ambient'; colour: LightColour; intensity: number }
  | { readonly kind: 'hemisphere'; sky: LightColour; ground: LightColour; intensity: number }
  | { readonly kind: 'point'; colour: LightColour; intensity: number; distance: number; decay: number; position: [number, number, number] }
  | { readonly kind: 'directional'; colour: LightColour; intensity: number; position: [number, number, number]; target: [number, number, number]; castShadow: boolean }
  | { readonly kind: 'prop-batch'; readonly parts: readonly ScenePropPart[]; readonly glowParts?: readonly ScenePropPart[];
      glowColour?: number; placements: readonly ScenePlacement[]; readonly castShadow: boolean; readonly receiveShadow: boolean;
      /** The body's material effects; see `FrameDescription['nodes'][number]['effects']`. */
      readonly effects?: string[] }
  | { readonly kind: 'instances'; readonly geometry: SceneGeometry; readonly colour: number; count: number;
      matrices: Float32Array; colours?: Float32Array; readonly castShadow: boolean; readonly receiveShadow: boolean;
      readonly renderOrder?: number; readonly material?: {
        intent?: 'lit' | 'unlit'; colour?: number; emissive?: number; vertexColours?: boolean;
        transparent?: boolean; opacity?: number; depthWrite?: boolean; depthTest?: boolean;
        toneMapped?: boolean; side?: 'front' | 'back' | 'double'; effects?: string[];
      } }
  | { readonly kind: 'points'; positions: Float32Array; colour: number; size: number; opacity: number; visible: boolean }
  | { readonly kind: 'mesh'; readonly geometry: SceneGeometry; readonly material: 'lit-vertex-colours' | 'lit-solid' | 'water'; colour?: number;
      readonly castShadow?: boolean; readonly receiveShadow: boolean; readonly renderOrder?: number; world?: number[];
      readonly frustumCulled?: boolean; visible?: boolean; readonly effects?: string[];
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

/** The next id to hand out; shared by every graph, so an interior and the country never collide. */
let nextId = 0;

type FrameNode = FrameDescription['nodes'][number];

/** What a graph keeps for one node: its id, its last entry, and what that entry was made from. */
interface Slot { node: SceneNode; kind: SceneNode['kind']; id: number; entry: FrameNode | null; kept: unknown[] }

/** A light colour as it was, so one written into the array it already had is still seen to move. */
const keepColour = (colour: LightColour): LightColour =>
  typeof colour === 'number' ? colour : [colour[0], colour[1], colour[2]];

const sameColour = (a: LightColour, b: unknown): boolean => a === b || (typeof a !== 'number'
  && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);

const samePosition = (a: readonly number[], b: unknown): boolean =>
  Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * What a node's entry is made from and may change, in the order `unchanged` compares it.
 *
 * Only the fields `SceneNode` leaves writable: the rest are read once, when the node is first
 * framed, and a producer that needs a different one replaces the node. The graph reads every node
 * on every draw, and on the Pi each field read is paid a thousand times a frame.
 */
function keep(node: SceneNode): unknown[] {
  switch (node.kind) {
    case 'ambient': return [keepColour(node.colour), node.intensity];
    case 'hemisphere': return [keepColour(node.sky), keepColour(node.ground), node.intensity];
    case 'point': return [keepColour(node.colour), node.intensity, node.distance, node.decay, [...node.position]];
    case 'directional': return [keepColour(node.colour), node.intensity, [...node.position], node.target, node.castShadow];
    case 'prop-batch': return [node.placements, node.glowColour];
    case 'instances': return [node.count, node.matrices, node.colours];
    case 'points': return [node.visible, node.positions, node.colour, node.size, node.opacity];
    case 'mesh': return [node.world, node.visible, node.colour, node.materialState];
  }
}

type Of<K extends SceneNode['kind']> = Extract<SceneNode, { kind: K }>;

/**
 * Whether the node is still what its entry was made from.
 *
 * An entry holds a node's arrays and objects by reference, so values written into one reach the
 * next frame on their own; they are compared by identity. A light's position and colour are the
 * exception: the entry copies them, and the dungeon and the day cycle write them into the arrays
 * they had, so they are compared by value. A material state is spread into the entry, so it is
 * replaced to change it, never written into. `scenegraph.test.ts` changes every writable field of
 * every kind, so a field left out of here fails there.
 *
 * The kind is the slot's, not read off the node: nodes come in a dozen shapes, and on the Pi a
 * property read across that many costs more than the comparison it feeds.
 */
function unchanged(node: SceneNode, { kind, kept }: Slot): boolean {
  switch (kind) {
    case 'mesh': {
      const mesh = node as Of<'mesh'>;
      return mesh.world === kept[0] && mesh.visible === kept[1] && mesh.colour === kept[2]
        && mesh.materialState === kept[3];
    }
    case 'instances': {
      const pool = node as Of<'instances'>;
      return pool.count === kept[0] && pool.matrices === kept[1] && pool.colours === kept[2];
    }
    case 'prop-batch': {
      const batch = node as Of<'prop-batch'>;
      return batch.placements === kept[0] && batch.glowColour === kept[1];
    }
    case 'points': {
      const points = node as Of<'points'>;
      return points.visible === kept[0] && points.positions === kept[1] && points.colour === kept[2]
        && points.size === kept[3] && points.opacity === kept[4];
    }
    case 'ambient': {
      const light = node as Of<'ambient'>;
      return light.intensity === kept[1] && sameColour(light.colour, kept[0]);
    }
    case 'hemisphere': {
      const light = node as Of<'hemisphere'>;
      return light.intensity === kept[2] && sameColour(light.sky, kept[0]) && sameColour(light.ground, kept[1]);
    }
    case 'point': {
      const light = node as Of<'point'>;
      return light.intensity === kept[1] && light.distance === kept[2] && light.decay === kept[3]
        && sameColour(light.colour, kept[0]) && samePosition(light.position, kept[4]);
    }
    case 'directional': {
      const light = node as Of<'directional'>;
      return light.intensity === kept[1] && light.target === kept[3] && light.castShadow === kept[4]
        && sameColour(light.colour, kept[0]) && samePosition(light.position, kept[2]);
    }
  }
}

/** The engine owns these values; a renderer decides how to display them. */
export class SceneGraph {
  readonly nodes: SceneNode[] = [];
  /** Each node's id from the moment it is added, see `FrameDescription['nodes'][number]['id']`, and its last entry. */
  private readonly slots = new WeakMap<SceneNode, Slot>();
  /** The slots in the order of `nodes` when last framed, so a frame seldom has to look one up. */
  private readonly order: Slot[] = [];
  /** The camera chosen by the engine for the next submitted frame. */
  camera: FrameDescription['camera'] | null = null;
  fog: FrameDescription['fog'] = null;
  cutaway: FrameDescription['cutaway'] = null;
  /** The season's tint on whatever lists the `'season'` effect; see `FrameDescription.season`. */
  season: FrameDescription['season'] = null;
  coast: FrameDescription['coast'] = null;
  renderTimeMs: FrameDescription['renderTimeMs'] = null;

  constructor(public background: number) {}

  add(node: SceneNode): SceneNode {
    this.slots.set(node, { node, kind: node.kind, id: nextId++, entry: null, kept: [] });
    this.nodes.push(node);
    return node;
  }

  remove(node: SceneNode): void {
    const at = this.nodes.indexOf(node);
    if (at < 0) return;
    this.nodes.splice(at, 1);
    // and its slot with it, so a node added back is a new node with a new id rather than its old slot
    if (this.order[at]?.node === node) this.order.splice(at, 1);
  }

  /**
   * Capture exactly what both the drawing and recording pipelines will receive.
   *
   * The live mount asks for this every draw, so a node that has not changed since the last frame
   * hands back the entry it had, the same object (#511). Nothing may write into an entry.
   */
  frame(): FrameDescription {
    if (!this.camera) throw new Error('scene graph has no camera for this frame');
    const nodes: FrameNode[] = new Array(this.nodes.length);
    for (let at = 0; at < this.nodes.length; at++) {
      const node = this.nodes[at];
      let slot = this.order[at];
      if (slot?.node !== node) {
        const found = this.slots.get(node);
        if (!found) throw new Error('scene node was not added through SceneGraph.add, so it has no id');
        this.order[at] = slot = found;
      }
      if (!slot.entry || !unchanged(node, slot)) {
        slot.entry = describe(node, slot.id);
        slot.kept = keep(node);
      }
      nodes[at] = slot.entry;
    }
    this.order.length = this.nodes.length;
    return {
      renderTimeMs: this.renderTimeMs,
      camera: this.camera,
      background: this.background,
      fog: this.fog,
      cutaway: this.cutaway,
      season: this.season,
      coast: this.coast,
      nodes,
    };
  }
}

/** One node's entry in a frame, made afresh. */
function describe(node: SceneNode, id: number): FrameNode {
  const base = { id, parent: -1, world: IDENTITY, visible: true, castShadow: false, receiveShadow: false };
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
    effects: node.effects,
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
}
