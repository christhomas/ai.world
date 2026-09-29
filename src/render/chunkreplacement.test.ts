import { describe, expect, it, vi } from 'vitest';
import type { SceneNode } from '../core/scenegraph';
import { ChunkManager } from './chunkManager';

describe('replacing locally grown ground with the world answer', () => {
  it('removes the old terrain instead of drawing two surfaces', () => {
    const old = { kind: 'mesh', geometry: {}, material: 'lit-vertex-colours' } as unknown as SceneNode;
    const terrainBridge = { add: vi.fn(), remove: vi.fn() };
    const chunks = Object.assign(Object.create(ChunkManager.prototype), {
      terrainBridge,
      loaded: new Map([['2,3', { cx: 2, cz: 3, terrain: [old], tiles: null, grown: true, props: [] }]]),
      sent: new Map(),
      pending: new Map([['2,3', 7]]),
      queue: [], idle: [],
      focusCx: 2, focusCz: 3, grown: 1,
      stats: { loaded: 1, drawn: 1, pending: 1 },
      propBatch: { remove: vi.fn() },
      solids: { drop: vi.fn() },
      pump: vi.fn(),
    }) as ChunkManager;
    const process = chunks as unknown as {
      onMessage: (worker: Worker, message: unknown) => void;
      loaded: Map<string, { terrain: SceneNode[]; grown: boolean }>;
    };

    process.onMessage({} as Worker, { type: 'mesh', id: 7, cx: 2, cz: 3, grown: false, empty: true });

    expect(terrainBridge.remove).toHaveBeenCalledExactlyOnceWith(old);
    expect(chunks.stats.drawn).toBe(0);
    expect(chunks.grown).toBe(0);
    expect(process.loaded.get('2,3')).toMatchObject({ terrain: [], grown: false });
  });
});
