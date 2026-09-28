/** A scene description independent of the graphics API that displays it. */
export interface FrameDescription {
  camera: { projection: number[]; world: number[]; orthographic: boolean };
  background: number | null;
  fog: { colour: number; near: number; far: number } | null;
  nodes: Array<{
    parent: number;
    kind: 'group' | 'mesh' | 'instances' | 'points' | 'directional' | 'hemisphere' | 'ambient' | 'point';
    world: number[];
    visible: boolean;
    colour?: number;
    intensity?: number;
    /** World-space point a directional light shines toward. */
    lightTarget?: [number, number, number];
    groundColour?: number;
    distance?: number;
    decay?: number;
    castShadow: boolean;
    receiveShadow: boolean;
    material?: {
      intent: 'lit' | 'unlit' | 'points' | 'water'; colour: number; emissive: number;
      vertexColours: boolean; transparent: boolean; opacity: number;
      depthWrite: boolean; side: 'front' | 'back' | 'double'; effects: string[];
    };
    materials?: NonNullable<FrameDescription['nodes'][number]['material']>[];
    groups?: Array<{ start: number; count: number; materialIndex: number }>;
    attributes?: Record<string, { size: number; values: number[] }>;
    indices?: number[];
    instanceMatrices?: number[];
    instanceColours?: number[];
  }>;
}
