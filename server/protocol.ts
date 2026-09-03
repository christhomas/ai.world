/**
 * The wire between players. Deliberately small: the world itself is derived from the seed, so
 * nothing about terrain, villages or dungeons is ever sent. Only people, words and goods travel.
 */

export const PROTOCOL_VERSION = 1;

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

export type ClientMessage =
  | { type: 'join'; seed: number; name: string; version: number }
  | { type: 'move'; x: number; z: number; yaw: number; walk: number; place: string; riding: Presence['riding']; gear: string[] }
  | { type: 'say'; text: string }
  | { type: 'trade-offer'; to: string; gold: number; items: Array<[string, number]> }
  | { type: 'trade-accept'; from: string }
  | { type: 'trade-decline'; from: string };

export type ServerMessage =
  | { type: 'welcome'; id: string; seed: number; players: Presence[] }
  | { type: 'joined'; player: Presence }
  | { type: 'left'; id: string }
  | { type: 'presence'; players: Presence[] }
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
