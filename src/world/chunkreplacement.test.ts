import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ChunkManager } from './chunkManager';

describe('replacing locally grown ground with the world answer', () => {
  it('removes and disposes the old terrain instead of drawing two surfaces', () => {
    const scene = new THREE.Scene();
    const old = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const disposed = vi.spyOn(geometry, 'dispose');
    old.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
    scene.add(old);
    const chunks = Object.assign(Object.create(ChunkManager.prototype), {
      scene,
      loaded: new Map([['2,3', { cx: 2, cz: 3, group: old, grown: true, props: [] }]]),
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
      loaded: Map<string, { group: THREE.Group | null; grown: boolean }>;
    };

    process.onMessage({} as Worker, { type: 'mesh', id: 7, cx: 2, cz: 3, grown: false, empty: true });

    expect(scene.children).not.toContain(old);
    expect(disposed).toHaveBeenCalledOnce();
    expect(chunks.stats.drawn).toBe(0);
    expect(chunks.grown).toBe(0);
    expect(process.loaded.get('2,3')).toMatchObject({ group: null, grown: false });
  });
});
