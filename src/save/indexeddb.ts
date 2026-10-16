import { get, set, del } from 'idb-keyval';
import type { SaveStore } from './store';

/** Browser persistence adapter. Portable hosts implement SaveStore without importing IndexedDB. */
export class IndexedDbStore implements SaveStore {
  async load<T>(key: string): Promise<T | undefined> {
    try { return await get<T>(key); } catch { return undefined; }
  }
  async save<T>(key: string, value: T): Promise<void> {
    try { await set(key, value); } catch { /* private mode / quota: ignore, world is seed-derived anyway */ }
  }
  async saveStrict<T>(key: string, value: T): Promise<void> { await set(key, value); }
  async remove(key: string): Promise<void> {
    try { await del(key); } catch { /* ignore */ }
  }
}
