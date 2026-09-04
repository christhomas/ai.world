/**
 * The wire between players. The world itself is grown from the seed on every client, so terrain,
 * villages and dungeons are never sent. What does travel is people, words, goods, the time of day,
 * and the short list of things players have changed about the world.
 */

export const PROTOCOL_VERSION = 2;

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

export type ClientMessage =
  | { type: 'join'; seed: number; name: string; version: number; day: number; time: number }
  | { type: 'move'; x: number; z: number; yaw: number; walk: number; place: string; riding: Presence['riding']; gear: string[] }
  | { type: 'say'; text: string }
  | { type: 'trade-offer'; to: string; gold: number; items: Array<[string, number]> }
  | { type: 'trade-accept'; from: string }
  | { type: 'trade-decline'; from: string }
  | { type: 'delta'; delta: WorldDelta };

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
  | { type: 'error'; reason: string };

/** Chat is short and plain; anything longer or stranger is cut here rather than downstream. */
export const MAX_CHAT = 160;

export function cleanChat(text: string): string {
  // strip control characters, collapse the rest, and keep it short
  return [...text].filter((ch) => ch >= ' ' && ch !== '').join('').trim().slice(0, MAX_CHAT);
}

/** Names are how people find each other, so they are short, plain and never empty. */
export function cleanName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 18);
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
  const id = (value: unknown) => String(value ?? '').slice(0, 80);
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
