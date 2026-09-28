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

/** A scene description independent of the graphics API that displays it. */
export interface FrameDescription {
  camera: { projection: number[]; world: number[]; orthographic: boolean; layers?: number };
  background: number | null;
  fog: { colour: number; near: number; far: number } | null;
  nodes: Array<{
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
    };
    materials?: NonNullable<FrameDescription['nodes'][number]['material']>[];
    groups?: Array<{ start: number; count: number; materialIndex: number }>;
    attributes?: Record<string, { size: number; values: number[] | Float32Array }>;
    indices?: number[] | Uint16Array | Uint32Array;
    instanceMatrices?: number[] | Float32Array;
    instanceColours?: number[] | Float32Array;
    parts?: readonly ScenePropPart[];
    glowParts?: readonly ScenePropPart[];
    placements?: readonly ScenePlacement[];
  }>;
}
