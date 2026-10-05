import { createStore, entries, set } from 'idb-keyval';
import { WorldVault } from '../save/world-vault';

/**
 * Where a world is kept when the server is a thread in somebody's browser.
 *
 * IndexedDB is available inside the worker; localStorage is not. Load durable room files before
 * creating the simulation, then preserve its synchronous reads and writes through WorldVault.
 * Storage failures stay visible to flush callers instead of silently creating a forgetful world.
 */
export class BrowserVault {
  static async open(): Promise<WorldVault> {
    const store = createStore('ai-world-authority', 'files');
    return WorldVault.open({
      load: async () => {
        const kept = await entries<string, string>(store);
        if (kept.some(([name, text]) => typeof name !== 'string' || typeof text !== 'string')) {
          throw new Error('World storage contains invalid room records');
        }
        return kept;
      },
      write: (name, text) => set(name, text, store),
    });
  }
}
