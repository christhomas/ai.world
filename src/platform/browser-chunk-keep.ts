import type { Keep } from '../world/chunkstore';

/**
 * The store a browser actually has, when it has one.
 *
 * `idb-keyval` in a database of its own, so that a country full of chunks cannot crowd out the
 * saves — they are the thing a player would miss. Everything here is allowed to fail: a private
 * window, a full disk, a browser told to keep nothing. Failing means the world sends the ground
 * again, which is slower and nothing worse, so none of it is reported to anybody.
 */
export function browserKeep(): Keep {
  // imported here rather than at the top so that nothing that loads this file without opening a
  // game — a test, a tool — reaches for a database that is not there
  const opened = import('idb-keyval').then(({ createStore, get, set, del, keys }) => {
    const store = createStore('ai.world.country', 'chunks');
    return { get, set, del, keys, store };
  });
  return {
    async get(key) { const idb = await opened; return idb.get<ArrayBuffer>(key, idb.store); },
    async set(key, value) { const idb = await opened; await idb.set(key, value, idb.store); },
    async delete(key) { const idb = await opened; await idb.del(key, idb.store); },
    async keys() { const idb = await opened; return (await idb.keys(idb.store)) as string[]; },
  };
}
