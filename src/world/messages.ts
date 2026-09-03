import type { MeshData } from './mesher';

/** Main thread → worker. */
export type WorkerRequest =
  | { type: 'init'; seed: number }
  | { type: 'gen'; id: number; cx: number; cz: number };

/** Worker → main thread. */
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'chunk'; id: number; cx: number; cz: number; empty: true }
  | {
      type: 'chunk'; id: number; cx: number; cz: number; empty: false;
      mesh: MeshData;
      water: MeshData | null;
      /** Flat array of [kind, x, y, z, rotY, scale] per prop instance. */
      props: Float32Array;
      /** Interior 16x16 heights (no apron) for gameplay queries. */
      heights: Float32Array;
      types: Uint8Array;
      waters: Float32Array;
      blocked: Uint8Array;
      biomes: Uint8Array;
    };
