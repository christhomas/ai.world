import type { MeshData } from './mesher';
import type { RoadGraph } from './graph';
import type { Hydrology } from './rivers';
import type { Structures } from './structures';

/** Main thread → worker. Graph, rivers and structures are computed once on the main thread and shared. */
export type WorkerRequest =
  | { type: 'init'; seed: number; graph: RoadGraph; hydro: Hydrology; structures: Structures }
  | { type: 'gen'; id: number; cx: number; cz: number }
  /**
   * Mesh this chunk, which somebody else grew.
   *
   * The page stops growing its own country and starts drawing the one the world sent. The expensive
   * half of the work — turning tiles into geometry — stays here, because it is expensive and because
   * it is the half the two sides cannot disagree about. What it no longer does is decide what the
   * ground *is*.
   */
  | { type: 'mesh'; id: number; cx: number; cz: number; chunk: ArrayBuffer };

/** Worker → main thread. */
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'chunk'; id: number; cx: number; cz: number; empty: true; grown?: boolean }
  | {
      type: 'chunk'; id: number; cx: number; cz: number; empty: false;
      /**
       * Whether this chunk was grown here rather than sent by the world.
       *
       * The one route left by which the two halves can be in different countries. It is deliberate —
       * a page whose world has not answered should draw the ground rather than stand in the dark —
       * but it is exactly the fault that leaves no trace, so it is counted where anybody can see it
       * rather than happening quietly.
       */
      grown?: boolean;
      mesh: MeshData;
      water: MeshData | null;
      /** Flat array of [kind, x, y, z, rotY, scale] per prop instance. */
      props: Float32Array;
      /** Interior 16x16 heights (no apron) for gameplay queries. */
      heights: Float32Array;
      types: Uint8Array;
      waters: Float32Array;
      biomes: Uint8Array;
    };
