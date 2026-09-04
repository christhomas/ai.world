/**
 * The wire between players. The world itself is grown from the seed on every client, so terrain,
 * villages and dungeons are never sent. What does travel is people, words, goods, the time of day,
 * and the short list of things players have changed about the world.
 */

export const PROTOCOL_VERSION = 8;

/** Where somebody is and what they look like, sent several times a second. */
export interface Presence {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  /** Walk animation strength, so remote heroes move their legs. */
  walk: number;
  /** Item ids worn in hand, off hand, head and body, for drawing them. */
  gear: string[];
  /** Which world they are standing in: the surface, a dungeon floor, or a building. */
  place: string;
  /** Whether they are mounted or under sail, so they are drawn on the right thing. */
  riding: 'foot' | 'horse' | 'boat';
}

export interface TradeOffer {
  from: string;
  to: string;
  gold: number;
  /** Item ids and counts. */
  items: Array<[string, number]>;
}

/**
 * The time of day everyone in a world shares. `day` counts from one; `time` is the fraction of a
 * day, so 0.5 is noon. Seasons fall out of the day counter on each client.
 */
export interface Clock {
  day: number;
  time: number;
}

/**
 * Something a player changed about the world. The world is otherwise identical on every client,
 * so this short list is all that has to be kept and replayed.
 *
 * - `chest`   a dungeon or wreck chest that has been opened, keyed by its id
 * - `key`     a vault whose locked doors have been opened
 * - `sow`     a crop planted on a tile, carrying the crop and the day it went in
 * - `reap`    that tile lifted again
 * - `found`   a place somebody named, so everyone's map agrees
 */
export type WorldDelta =
  | { kind: 'chest'; id: string }
  | { kind: 'key'; id: string }
  | { kind: 'sow'; tile: string; crop: string; day: number }
  | { kind: 'reap'; tile: string }
  | { kind: 'found'; name: string };

/**
 * One monster as the floor's owner sees it. Everyone underground generates the same rooms from
 * the same seed, so only the creatures moving about in them have to be described.
 */
export interface MonsterSnap {
  /** Index into the floor's own monster list, which every client builds identically. */
  i: number;
  x: number;
  z: number;
  yaw: number;
  walk: number;
  hp: number;
}

/** One lot on a market stall: a stack of the same item at one asking price. */
export interface StallItem {
  id: string;
  /** Gold for one of them. */
  price: number;
  count: number;
}

/**
 * A market pitch in a village square. A pitch belongs to a name rather than a connection, so the
 * goods are still there when the trader has gone to bed, and takings wait to be collected.
 */
export interface Stall {
  /** `<village>#<pitch>`, which every client can work out from the world it grew. */
  id: string;
  village: string;
  owner: string;
  items: StallItem[];
  /** Gold from sales, waiting for the owner to come back for it. */
  takings: number;
  /** The world day the rent runs out, after which the pitch is cleared. */
  until: number;
}

/** Renting a pitch costs this, and holds it for this many days. */
export const STALL_RENT = 20;
export const STALL_DAYS = 3;
/** A trader may not stack more than this many lots on one pitch. */
export const STALL_LOTS = 6;

/**
 * A parcel left at an inn for somebody who is not here. Like a stall, it is addressed to a name
 * rather than a connection, so it waits however long it has to.
 */
export interface Letter {
  from: string;
  to: string;
  gold: number;
  items: Array<[string, number]>;
  /** The world day it was posted, so the inn can say how long it has sat there. */
  day: number;
}

/** No more parcels than this wait in one world, oldest thrown out first. */
export const MAIL_LIMIT = 500;

/** One traveller in a party, as everyone else in it sees them. */
export interface PartyMember {
  id: string;
  name: string;
}

/** A party is small on purpose: enough to travel together, not enough to fill a dungeon. */
export const PARTY_LIMIT = 6;

/**
 * The few gestures a traveller can make without words, so people who share no language can still
 * greet each other. Typed in chat as /wave and the like.
 */
export const EMOTES: Record<string, string> = {
  wave: '👋',
  bow: '🙇',
  cheer: '🎉',
  laugh: '😄',
  thanks: '🙏',
  help: '🆘',
};

/** How long a rally point stands on everyone's map, in seconds. */
export const PING_LIFE = 90;

/** A duel is a friendly bout: nobody loses gear, gold or a life over it. */
export const DUEL_RANGE = 2.4;

export type ClientMessage =
  | { type: 'join'; seed: number; name: string; version: number; day: number; time: number }
  | { type: 'move'; x: number; z: number; yaw: number; walk: number; place: string; riding: Presence['riding']; gear: string[] }
  | { type: 'say'; text: string }
  | { type: 'trade-offer'; to: string; gold: number; items: Array<[string, number]> }
  | { type: 'trade-accept'; from: string }
  | { type: 'trade-decline'; from: string }
  | { type: 'delta'; delta: WorldDelta }
  | { type: 'monsters'; place: string; snap: MonsterSnap[]; gone: number[] }
  | { type: 'hit'; place: string; index: number; damage: number }
  | { type: 'stall-rent'; stall: string; village: string }
  | { type: 'stall-stock'; stall: string; item: StallItem }
  | { type: 'stall-buy'; stall: string; index: number }
  | { type: 'stall-collect'; stall: string }
  | { type: 'stall-close'; stall: string }
  | { type: 'mail-send'; to: string; gold: number; items: Array<[string, number]> }
  | { type: 'mail-fetch' }
  | { type: 'party-invite'; to: string }
  | { type: 'party-answer'; from: string; yes: boolean }
  | { type: 'party-leave' }
  /** An errand one member finished, which counts for the whole party. */
  | { type: 'party-deed'; quest: string }
  | { type: 'emote'; kind: string }
  /** A rally point dropped where you stand: your party sees it, or the whole world if you have none. */
  | { type: 'ping'; x: number; z: number }
  | { type: 'duel-challenge'; to: string }
  | { type: 'duel-answer'; from: string; yes: boolean }
  /** A blow landed on the person you are dueling; they decide what it does to them. */
  | { type: 'duel-hit'; damage: number }
  /** Called off, or lost: either way the bout is over. */
  | { type: 'duel-yield' };

export type ServerMessage =
  | { type: 'welcome'; id: string; seed: number; players: Presence[]; clock: Clock; deltas: WorldDelta[] }
  | { type: 'joined'; player: Presence }
  | { type: 'left'; id: string }
  | { type: 'presence'; players: Presence[] }
  | { type: 'clock'; clock: Clock }
  | { type: 'delta'; delta: WorldDelta; from: string }
  | { type: 'said'; id: string; name: string; text: string }
  | { type: 'trade-offered'; offer: TradeOffer; fromName: string }
  | { type: 'trade-result'; with: string; accepted: boolean; offer: TradeOffer }
  | { type: 'monsters'; place: string; snap: MonsterSnap[]; gone: number[]; from: string }
  | { type: 'hit'; place: string; index: number; damage: number; from: string }
  | { type: 'stalls'; stalls: Stall[] }
  /** Your own purchase came through: take the goods and pay for them. */
  | { type: 'stall-bought'; stall: string; item: StallItem; cost: number }
  /** Takings handed back to the trader who earned them. */
  | { type: 'stall-takings'; stall: string; gold: number }
  /** Something you asked of a stall could not be done. */
  | { type: 'stall-refused'; stall: string; reason: string }
  /** Everyone this world has ever seen, so a parcel can be addressed to somebody who is away. */
  | { type: 'folk'; names: string[] }
  /** The parcels waiting for you, now yours: take what is in them. */
  | { type: 'mail'; letters: Letter[] }
  /** Somebody has left something for you at the inn. */
  | { type: 'mail-here'; from: string }
  /** Your parcel is on the shelf, waiting for whoever it is addressed to. */
  | { type: 'mail-sent'; to: string }
  | { type: 'mail-refused'; reason: string }
  /** Who is in your party now; empty when you are travelling alone again. */
  | { type: 'party'; members: PartyMember[] }
  | { type: 'party-invited'; from: string; fromName: string }
  /** Somebody would rather travel alone. */
  | { type: 'party-declined'; name: string }
  | { type: 'party-deed'; quest: string; from: string }
  | { type: 'duel-challenged'; from: string; fromName: string }
  | { type: 'duel-begun'; withId: string; withName: string }
  | { type: 'duel-struck'; damage: number; from: string }
  /** The bout is over: `winner` is the id of whoever was left standing, or empty if called off. */
  | { type: 'duel-over'; winner: string; name: string }
  | { type: 'emoted'; id: string; name: string; kind: string }
  | { type: 'pinged'; x: number; z: number; name: string }
  | { type: 'error'; reason: string };

/**
 * Who simulates the monsters on a shared floor: the lowest player id standing on it. Every client
 * works this out for itself from the presence it already has, so the server needs no say in it.
 */
export function ownerOfPlace(ids: string[]): string | null {
  const sorted = ids.filter(Boolean).sort();
  return sorted[0] ?? null;
}

/** Keep a number inside the range the game can deal with. */
export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Guard a lot off the wire: an item id, a sane price, and a stack somebody could actually carry. */
export function cleanStallItem(item: StallItem): StallItem | null {
  const id = String(item?.id ?? '').slice(0, LIMITS.ITEM_ID);
  const price = Math.floor(Number(item?.price));
  const count = Math.floor(Number(item?.count));
  if (!id || !Number.isFinite(price) || !Number.isFinite(count)) return null;
  return { id, price: clamp(price, 1, LIMITS.PRICE), count: clamp(count, 1, LIMITS.STACK) };
}

/** Guard a parcel off the wire: a real recipient, sane gold, and a handful of items at most. */
export function cleanLetter(letter: Letter): Letter | null {
  const to = cleanName(String(letter?.to ?? ''));
  const gold = Math.floor(Number(letter?.gold));
  if (!Number.isFinite(gold)) return null;
  const items = (Array.isArray(letter?.items) ? letter.items : [])
    .slice(0, LIMITS.PARCEL_ITEMS)
    .map(([id, n]) => [String(id).slice(0, LIMITS.ITEM_ID), clamp(Math.floor(Number(n)) || 1, 1, LIMITS.STACK)] as [string, number])
    .filter(([id]) => id);
  if (gold <= 0 && items.length === 0) return null;
  return { from: String(letter.from ?? '').slice(0, LIMITS.NAME), to, gold: Math.max(0, gold), items, day: Math.max(1, Math.floor(Number(letter.day)) || 1) };
}

/**
 * How much of anything the server will accept. Every one of these is a defence against a client
 * sending something enormous or strange, so they live together: a reader can see the whole shape
 * of what may cross the wire without hunting through the handlers.
 */
export const LIMITS = {
  /** A line of chat. */
  CHAT: 160,
  /** A player's name. */
  NAME: 18,
  /** An item id, which is a short word like `apple`. */
  ITEM_ID: 24,
  /** The name of a world you can be standing in, like `Shrine of Echoes:1`. */
  PLACE: 60,
  /** A stall's id, a delta's id, an errand's id: anything naming a thing in the world. */
  THING_ID: 80,
  /** A village name. */
  VILLAGE: 40,
  /** The name of a gesture, like `wave`. */
  EMOTE: 12,
  /** Pieces of gear drawn on a remote hero: hand, off hand, head, body. */
  GEAR: 4,
  /** Lots in one parcel, and items in one trade offer. */
  PARCEL_ITEMS: 8,
  TRADE_ITEMS: 12,
  /** Monsters described in one snapshot of a dungeon floor. */
  MONSTERS: 64,
  /** How many of one thing can sit in a stack, on a stall or in a parcel. */
  STACK: 99,
  /** The most anybody may ask for something, and the hardest blow anybody may claim to land. */
  PRICE: 9999,
  DAMAGE: 99,
} as const;

/** Chat is short and plain; anything longer or stranger is cut here rather than downstream. */

export function cleanChat(text: string): string {
  // strip control characters, collapse the rest, and keep it short
  return [...text].filter((ch) => ch >= ' ' && ch !== '').join('').trim().slice(0, LIMITS.CHAT);
}

/** Names are how people find each other, so they are short, plain and never empty. */
export function cleanName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, LIMITS.NAME);
  return cleaned.length > 0 ? cleaned : 'Traveller';
}

/** One line per delta, so a log can be read and a duplicate spotted. */
export function deltaKey(delta: WorldDelta): string {
  switch (delta.kind) {
    case 'chest': return `chest:${delta.id}`;
    case 'key': return `key:${delta.id}`;
    case 'sow': return `sow:${delta.tile}`;
    case 'reap': return `sow:${delta.tile}`;   // reaping clears the sowing it replaces
    case 'found': return `found:${delta.name}`;
  }
}

/** Guard against a client sending something misshapen. */
export function cleanDelta(delta: WorldDelta): WorldDelta | null {
  const id = (value: unknown) => String(value ?? '').slice(0, LIMITS.THING_ID);
  switch (delta?.kind) {
    case 'chest': return { kind: 'chest', id: id(delta.id) };
    case 'key': return { kind: 'key', id: id(delta.id) };
    case 'found': return { kind: 'found', name: id(delta.name) };
    case 'sow': {
      const day = Number(delta.day);
      if (!Number.isFinite(day)) return null;
      return { kind: 'sow', tile: id(delta.tile), crop: id(delta.crop), day: Math.max(1, Math.floor(day)) };
    }
    case 'reap': return { kind: 'reap', tile: id(delta.tile) };
    default: return null;
  }
}
