import { describe, expect, it } from 'vitest';
import { ChunkManager } from './chunkManager';

/** The request ledger can be checked without creating a renderer and worker pool. */
function requests(queued: Array<[number, number]>, grown: Array<[number, number]>,
                  sent: Array<[number, number]> = [], pending: Array<[number, number]> = []) {
  const key = ([cx, cz]: [number, number]) => `${cx},${cz}`;
  const chunks = Object.assign(Object.create(ChunkManager.prototype), {
    queue: queued.map(([cx, cz]) => ({ cx, cz, since: 0 })),
    loaded: new Map(grown.map(([cx, cz]) => [key([cx, cz]), { cx, cz, grown: true }])),
    sent: new Map(sent.map((at) => [key(at), new ArrayBuffer(1)])),
    pending: new Map(pending.map((at) => [key(at), 1])),
  }) as ChunkManager;
  return chunks.wanted();
}

describe('ground the page grew before the world answered', () => {
  it('asks for locally grown chunks after their worker job leaves the queue', () => {
    expect(requests([], [[2, 3]])).toEqual([[2, 3]]);
  });

  it('does not ask twice for queued chunks or while the world answer is being drawn', () => {
    expect(requests([[2, 3]], [[2, 3]])).toEqual([[2, 3]]);
    expect(requests([], [[2, 3]], [[2, 3]])).toEqual([]);
    expect(requests([], [[2, 3]], [], [[2, 3]])).toEqual([]);
  });

  it('keeps an authoritative replacement queued when the player changes chunks', () => {
    const chunks = Object.assign(Object.create(ChunkManager.prototype), {
      focusCx: 2, focusCz: 3,
      offsets: [{ dx: 0, dz: 0 }],
      queue: [{ cx: 2, cz: 3, since: 0 }],
      loaded: new Map([['2,3', { cx: 2, cz: 3, grown: true }]]),
      sent: new Map([['2,3', new ArrayBuffer(1)]]),
      pending: new Map(),
    }) as ChunkManager;
    const state = chunks as unknown as {
      refreshDesired: () => void;
      queue: Array<{ cx: number; cz: number }>;
    };
    state.refreshDesired();
    expect(state.queue.map(({ cx, cz }) => [cx, cz])).toEqual([[2, 3]]);
  });
});
