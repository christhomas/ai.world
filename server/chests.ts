import { whatAChestHolds } from '../src/world/chests';
import type { DungeonWorld } from '../src/dungeon/world';
import type { ClientMessage, ServerMessage, WorldDelta } from './protocol';

/**
 * The world's answer to somebody lifting a lid.
 *
 * This is the first thing a page *asks* rather than reports, and it is worth being clear about why
 * it could be asked at all. What is inside a chest was never decided by anybody: a vault is regrown
 * from its seed on every machine, so `whatAChestHolds` gives the same gold and the same prize
 * wherever it runs. The world already grows the floor — it has to, to know what is walking about on
 * it — so it can open the same chest and say what was in it.
 *
 * What it actually checks is the part that is about a person rather than about the world:
 *
 *  - you are standing on the floor you say you are,
 *  - the chest is within reach of where the world has been walking you,
 *  - and nobody has opened it already.
 *
 * All three are things a client could be wrong or lying about, and none of them are things the seed
 * can settle. The third one is the interesting one in a shared world: two people in the same vault
 * both see a full chest, both open it, and exactly one of them is right.
 */

/** How close you have to be. The page's own `REACH.CHEST`, which is arm's length. */
const REACH = 1.8;

/** A pack list arrives from a client, so it is fenced before anything is looked up in it. */
const MOST_ITEMS = 64;
const ITEM_ID = 32;

export interface Lid {
  /** The floor this client is standing on, as the world grew it, or nothing if it has not. */
  floor: { world: DungeonWorld; seed: number } | null;
  /**
   * Where this hero is, as the world holds him.
   *
   * Out of doors that is where the world has *walked* him, which is the one position a client does
   * not get to choose. On a floor it is still where he says he is, because the world does not walk
   * heroes underground yet — so this check is only as good as that, and it will get better without
   * this file changing on the day it does. It is not nothing even now: it is the same position
   * everybody else in the vault sees him standing at, so reaching a chest across the room means
   * being seen to stand at it.
   */
  hero: { x: number; z: number } | null;
  /** Which place the world believes this client is in. */
  standingIn: string;
  /** Write it into the log of what has changed. False when it was already there. */
  apply: (delta: WorldDelta) => boolean;
  /** Tell everybody else in the world about it. */
  broadcast: (delta: WorldDelta) => void;
  /** Answer the one who asked. */
  send: (message: ServerMessage) => void;
}

export function lidLifted(o: Lid, message: Extract<ClientMessage, { type: 'open' }>): void {
  const seq = Math.floor(Number(message.seq) || 0);
  const place = String(message.place);
  const index = Math.floor(Number(message.index));
  const no = (): void => o.send({
    type: 'opened', seq, place, index, ok: false, gold: 0, key: false, prize: null,
  });

  // a floor the world has not grown is a floor nobody can be standing in, whatever they say
  if (o.standingIn !== place || !o.floor) { no(); return; }
  const chest = o.floor.world.map.chests[index];
  if (!chest) { no(); return; }

  if (!o.hero) { no(); return; }
  const away = Math.hypot(chest.x + 0.5 - o.hero.x, chest.z + 0.5 - o.hero.z);
  if (away > REACH) { no(); return; }

  // `apply` is the whole of "has anybody opened it already": the log keeps one entry per chest and
  // says whether this one was new. Two people who lift the same lid in the same second both ask,
  // and the second one is told no by the log rather than by a check that could be raced
  const id = o.floor.world.chestId(index);
  if (!o.apply({ kind: 'chest', id })) { no(); return; }

  const owns = new Set((Array.isArray(message.owns) ? message.owns : [])
    .slice(0, MOST_ITEMS).map((item) => String(item).slice(0, ITEM_ID)));
  const hoard = whatAChestHolds(o.floor.seed, index, chest, (item) => owns.has(item));

  o.broadcast({ kind: 'chest', id });
  // the lock a treasure-room key opens is the floor itself, which is what the place is named after
  if (hoard.key && o.apply({ kind: 'key', id: place })) o.broadcast({ kind: 'key', id: place });
  o.send({ type: 'opened', seq, place, index, ok: true, gold: hoard.gold, key: hoard.key, prize: hoard.prize });
}
