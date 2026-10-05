import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, entries, set } from 'idb-keyval';
import { BrowserVault } from './browservault';

vi.mock('idb-keyval', () => ({ createStore: vi.fn(), entries: vi.fn(), set: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('worker IndexedDB world storage adapter', () => {
  it('uses its own database and exact simulation file names, with no localStorage access', async () => {
    const store = vi.fn(); vi.mocked(createStore).mockReturnValue(store);
    vi.mocked(entries).mockResolvedValue([['worlds/3.json', 'saved room']]);
    vi.mocked(set).mockResolvedValue(undefined);
    const vault = await BrowserVault.open();
    expect(createStore).toHaveBeenCalledWith('ai-world-authority', 'files');
    expect(entries).toHaveBeenCalledWith(store); expect(vault.read('worlds/3.json')).toBe('saved room');
    vault.write('worlds/3.json', 'next room'); await vault.flush();
    expect(set).toHaveBeenCalledWith('worlds/3.json', 'next room', store);
  });

  it('propagates database load and quota failures instead of acknowledging a memory-only save', async () => {
    const error = new Error('quota'); vi.mocked(entries).mockRejectedValueOnce(error);
    await expect(BrowserVault.open()).rejects.toBe(error);
    vi.mocked(entries).mockResolvedValue([]); vi.mocked(set).mockRejectedValue(error);
    const vault = await BrowserVault.open(); vault.write('room', 'saved');
    await expect(vault.flush()).rejects.toMatchObject({ errors: [error] });
  });

  it('rejects invalid durable records before opening the simulation', async () => {
    vi.mocked(entries).mockResolvedValue([['room', { day: 3 }]]);
    await expect(BrowserVault.open()).rejects.toThrow('invalid room records');
  });
});
