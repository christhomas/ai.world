import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, set, del } from 'idb-keyval';
import { IndexedDbStore } from './indexeddb';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('browser IndexedDB adapter preserves the existing save policy', () => {
  it('passes exact keys and save values without renaming fields or slots', async () => {
    const store = new IndexedDbStore();
    const saved = { seed: 9, world: 'road', sky: 'sky:9', cam: { x: 1, z: 2, rot: 0.3, zoom: 4 } };
    vi.mocked(get).mockResolvedValue(saved);
    expect(await store.load('ai.world/named/server/ashford')).toBe(saved);
    await store.save('slot', saved); await store.saveStrict('strict', saved); await store.remove('old');
    expect(get).toHaveBeenCalledWith('ai.world/named/server/ashford');
    expect(set).toHaveBeenNthCalledWith(1, 'slot', saved);
    expect(set).toHaveBeenNthCalledWith(2, 'strict', saved);
    expect(del).toHaveBeenCalledWith('old');
  });
  it('retains best-effort load/save/remove and propagates strict-save failures', async () => {
    const failure = new Error('quota/private mode');
    vi.mocked(get).mockRejectedValue(failure);
    vi.mocked(set).mockRejectedValue(failure);
    vi.mocked(del).mockRejectedValue(failure);
    const store = new IndexedDbStore();
    await expect(store.load('slot')).resolves.toBeUndefined();
    await expect(store.save('slot', { seed: 1 })).resolves.toBeUndefined();
    await expect(store.remove('slot')).resolves.toBeUndefined();
    await expect(store.saveStrict('slot', { seed: 1 })).rejects.toBe(failure);
    expect(set).toHaveBeenCalledTimes(2);
  });
});
