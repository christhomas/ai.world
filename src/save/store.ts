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

/**
 * Which of the two worlds a save is set in.
 *
 * `mesh` grows the polygon world — regions glued out of hexes, with mountains, cliffs and the
 * eyries that hang off them. `road` is the older road tree, which is flatter: it cannot place a
 * massif at all, because a massif needs thirty tiles of room from the coast and the road world's
 * land is never wider than twenty-two.
 *
 * It belonged on the save because it used to decide the entire terrain: the same seed grew two
 * completely different countries, so a world reopened as the other kind put the ground somewhere
 * else underneath a house, a planted field, and every anchor the manifest was holding.
 *
 * There is one kind now. The polygon world — `?world=mesh`, "with mountains" on the title screen —
 * is gone: its country was a worse country, and keeping two generators meant every field, every
 * road and every mountain in this game had to be written twice and agree. What the road tree does
 * with elevation is better than what the polygon world did with geometry, so the polygon world was
 * the one to lose.
 *
 * The field stays, and so does the type, for two reasons. A save written by an older build names a
 * world it thinks it is in, and that has to be read and quietly answered with the one that exists
 * — `kindOf` is where that happens. And a world kind is exactly the shape of thing this game will
 * want again.
 */
export type WorldKind = 'road';

/**
 * The world a save is asking for, as this build can actually grow it.
 *
 * Anything that is not a kind we have is the kind we have. A player whose save says `mesh` opens a
 * road world of the same seed rather than a blank screen: the ground under their house is different
 * and there is nothing to be done about that, and a game that opens is better than one that will
 * not.
 */
export function kindOf(asked: string | undefined | null): WorldKind {
  return 'road';
}

export interface SessionSave {
  seed: number;
  /** Which world this is. Absent on saves made before the choice existed, which were all road. */
  world?: WorldKind;
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

