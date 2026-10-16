import type { SaveStore } from './store';

/**
 * Saves kept for as long as the game is open: for a host that has not been given a durable store
 * yet, and for tests. Values are copied in and out, as a real store's would be, so a save cannot be
 * changed by whoever handed it over.
 */
export function savedInMemory(): SaveStore & { readonly keys: string[] } {
  const kept = new Map<string, string>();
  return {
    get keys() { return [...kept.keys()]; },
    load: async <T>(key: string) => {
      const text = kept.get(key);
      return text === undefined ? undefined : JSON.parse(text) as T;
    },
    save: async <T>(key: string, value: T) => { kept.set(key, JSON.stringify(value)); },
    saveStrict: async <T>(key: string, value: T) => { kept.set(key, JSON.stringify(value)); },
    remove: async (key: string) => { kept.delete(key); },
  };
}
