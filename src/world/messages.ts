import type { MeshData } from './mesher';
import type { RoadGraph } from './graph';
import type { Hydrology } from './rivers';
import type { Structures } from './structures';
import type { Ranges } from './ranges';
import type { Within } from './window';

/**
 * How many patches of an endless country one worker keeps.
 *
 * Here rather than in the worker because both ends have to agree: the main thread only sends a
 * patch it believes a worker has not got, and a worker that quietly dropped one the main thread
 * still thinks it has is a chunk request that paints nothing at all. One number, imported twice.
 *
 * Four: the patch the hero is in and the ones he is most likely to be asked about next. A worker
 * paints ground, it does not answer questions about it, so it needs fewer than the main thread.
 */
export const PATCHES_PER_WORKER = 4;

/** Main thread → worker. Graph, rivers and structures are computed once on the main thread and shared. */
export type WorkerRequest =
  | { type: 'init'; seed: number; graph: RoadGraph; hydro: Hydrology; structures: Structures }
  /**
   * One patch of a country with no edge, which a worker keeps beside whatever else it has been told.
   *
   * The same three things `init` carries and one more: the name of the patch they belong to. A
   * bounded world is told about once and paints every chunk there will ever be from it; an endless
   * one has no such thing to be told, so a worker is handed a square of country the first time it is
   * asked to paint a chunk inside one, and keeps a bounded few of them for the same reason the main
   * thread does.
   *
   * Grown on the main thread rather than here, and that is worth saying because the other way looks
   * cheaper. Each worker would grow the same patch separately — three times the work — and, worse,
   * three separately-grown countries that have to agree. One patchwork, and the workers are told.
   */
  | {
    type: 'patch'; patch: string; seed: number;
    /** The square of country this is, which the sampler needs to know to paint its edges. */
    within: Within;
    graph: RoadGraph; hydro: Hydrology; structures: Structures;
    /** The rock already cut for this patch. Not recomputed on the far side: it is the expensive half. */
    ranges: Ranges | null;
  }
  | { type: 'gen'; id: number; cx: number; cz: number; patch?: string }
  /**
   * Mesh this chunk, which somebody else grew.
   *
   * The page stops growing its own country and starts drawing the one the world sent. The expensive
   * half of the work — turning tiles into geometry — stays here, because it is expensive and because
   * it is the half the two sides cannot disagree about. What it no longer does is decide what the
   * ground *is*.
   */
  | { type: 'mesh'; id: number; cx: number; cz: number; chunk: ArrayBuffer; patch?: string };

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
