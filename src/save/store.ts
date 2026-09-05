import { get, set, del } from 'idb-keyval';

/**
 * Persistence boundary. Everything the game saves goes through this interface so the
 * backing store (IndexedDB now, SQLite-WASM or a server later) can change without touching game code.
 */
export interface SaveStore {
  load<T>(key: string): Promise<T | undefined>;
  save<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class IndexedDbStore implements SaveStore {
  async load<T>(key: string): Promise<T | undefined> {
    try { return await get<T>(key); } catch { return undefined; }
  }
  async save<T>(key: string, value: T): Promise<void> {
    try { await set(key, value); } catch { /* private mode / quota: ignore, world is seed-derived anyway */ }
  }
  async remove(key: string): Promise<void> {
    try { await del(key); } catch { /* ignore */ }
  }
}

import type { GameStateJson } from '../game/state';
import type { ManifestJson } from '../world/manifest';
import type { NemesisSave } from '../game/nemesis';
import type { RoamingJson } from '../game/roaming';

export interface SessionSave {
  seed: number;
  cam: { x: number; z: number; rot: number; zoom: number };
  player?: { x: number; z: number };
  state?: Partial<GameStateJson>;
  /** Seed tree: islands, dungeons and other expansions attached to this world. */
  manifest?: ManifestJson;
  /**
   * Where Old Nettle is up to. On the world rather than on the hero because he is a fact about
   * the place: he is in a cell, or he is abroad, whoever happens to be playing.
   */
  nemesis?: NemesisSave;
  /**
   * Which of the roaming bands have been fought, and how far each has been thinned. Only the
   * killing: where a band is on any day the seed already knows.
   */
  roaming?: RoamingJson;
  /**
   * The anchor id of the sky island the hero was standing on, if they were on one.
   *
   * On the save rather than derivable, and not optional in practice, because a hero saved in the
   * clouds and reopened on the ground would come back somewhere over the sea with nothing under
   * their feet. The one field that has to exist for the place to be safe to visit at all.
   */
  sky?: string | null;
  /** Legacy fields from saves before GameState existed. */
  discovered?: string[];
  inventory?: { gold: number; items: Record<string, number> };
}

