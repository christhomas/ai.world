/** Plain prop catalogue and placement data; a renderer chooses its own mesh implementation. */
export interface ScenePropPart {
  shape: 'box' | 'cyl' | 'cone' | 'ico' | 'dodec' | 'prism';
  size: number[];
  offset: [number, number, number];
  color: number;
  scale?: [number, number, number];
  rot?: [number, number, number];
}

export interface ScenePlacement {
  x: number; y: number; z: number; rot: number;
  scale?: number; stretch?: number; lean?: number; tint?: number;
}

/** How a season colours the country: see `FrameDescription.season`. */
export interface SeasonLook {
  multiply: [number, number, number];
  frost: number;
  snow: number;
}

/** A scene description independent of the graphics API that displays it. */
export interface FrameDescription {
  camera: { projection: number[]; world: number[]; orthographic: boolean; layers?: number };
  background: number | null;
  fog: { colour: number; near: number; far: number } | null;
  cutaway?: { enabled: boolean; hero: [number, number, number] } | null;
  /**
   * The season's tint, for every material whose `effects` name `'season'`: its colour becomes
   * `mix(colour * multiply, snow, frost)` before it is lit. `multiply` is linear and may pass one,
   * `snow` is an sRGB hex like every other authored colour, and `frost` runs from nought to one.
   * Null where no season is drawn — a desert, a snowfield, or before the game has said.
   */
  season?: SeasonLook | null;
  /** World-space coast distance field sampled by open water. */
  coast?: { x0: number; z0: number; span: number; size: number; values: Uint8Array | number[] } | null;
  nodes: Array<{
    /**
     * The node's own name, kept for as long as it is in the graph and never given to another. A
     * renderer that keeps what it built from a node keys it by this, not by where the node falls in
     * `nodes`: a node leaving the middle would otherwise rename everything after it (#490).
     */
    id: number;
    /** Which piece of one expanded node this is, where a renderer splits one into several. */
    part?: number;
    parent: number;
    kind: 'group' | 'mesh' | 'instances' | 'prop-batch' | 'points' | 'directional' | 'hemisphere' | 'ambient' | 'point';
    world: number[];
    visible: boolean;
    layers?: number;
    colour?: number;
    intensity?: number;
    /** World-space point a directional light shines toward. */
    lightTarget?: [number, number, number];
    groundColour?: number;
    /**
     * A light's colour in linear RGB exactly as the engine computed it, channels free to pass one.
     * Present only for computed lights; it is what `colour` would be if a hex could hold it, and a
     * renderer that can take it should use it in preference.
     */
    linearColour?: [number, number, number];
    /** The same for a hemisphere light's ground colour. */
    linearGroundColour?: [number, number, number];
    distance?: number;
    decay?: number;
    target?: [number, number, number];
    castShadow: boolean;
    receiveShadow: boolean;
    renderOrder?: number;
    material?: {
      intent: 'lit' | 'unlit' | 'points' | 'water'; colour: number; emissive: number;
      vertexColours: boolean; transparent: boolean; opacity: number;
      depthWrite: boolean; side: 'front' | 'back' | 'double'; effects: string[];
      size?: number;
      /** Optional depth-buffer behavior for interface-like instances. */
      depthTest?: boolean;
      /** Whether display transforms should affect this material. */
      toneMapped?: boolean;
    };
    materials?: NonNullable<FrameDescription['nodes'][number]['material']>[];
    groups?: Array<{ start: number; count: number; materialIndex: number }>;
    attributes?: Record<string, { size: number; values: number[] | Float32Array }>;
    indices?: number[] | Uint16Array | Uint32Array;
    instanceMatrices?: number[] | Float32Array;
    instanceColours?: number[] | Float32Array;
    parts?: readonly ScenePropPart[];
    glowParts?: readonly ScenePropPart[];
    glowColour?: number;
    placements?: readonly ScenePlacement[];
  }>;
}
