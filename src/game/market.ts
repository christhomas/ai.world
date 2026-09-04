import { type Stall, type StallItem } from '../../server/protocol';
import { ITEMS } from './items';
import type { Village } from '../world/structures';

/** How close you must stand to a pitch to deal at it, in tiles. */
export const STALL_REACH = 2.2;
/** What a trader asks by default: the shop price with a little on top for the trouble. */
export const MARKUP = 1.5;

/** A market pitch in the world, whether or not anybody has rented it. */
export interface Pitch {
  /** `<village>#<pitch>`, the same on every client because the world is. */
  id: string;
  village: string;
  x: number;
  z: number;
  /** What the server says is on it, or null when the pitch stands empty. */
  stall: Stall | null;
}

/**
 * The player-run market. Villages lay out their pitches when the world is grown, so every client
 * knows where they are; the server only says who holds which and what is on it.
 *
 * A pitch belongs to a name rather than a connection, so goods stay out while the trader sleeps.
 */
export class Market {
  private readonly stalls = new Map<string, Stall>();
  /**
   * Wood a village's market has taken in, which is what its wright eventually builds a cart out
   * of. Kept here rather than in woodcraft because a market is the thing that counts what came
   * through it, and kept per village because a cart is built where the timber was landed.
   */
  private readonly woodIn = new Map<string, number>();

  /** Somebody has handed goods over a counter here. */
  took(village: string, id: string, count = 1): void {
    if (id !== 'wood') return;
    this.woodIn.set(village, (this.woodIn.get(village) ?? 0) + count);
  }

  /** How much wood this village's market has gathered so far. */
  woodAt(village: string): number {
    return this.woodIn.get(village) ?? 0;
  }

  /** Take the server's description of the market, replacing whatever we thought it was. */
  receive(stalls: Stall[]): void {
    this.stalls.clear();
    for (const stall of stalls) this.stalls.set(stall.id, stall);
  }

  get count(): number { return this.stalls.size; }

  /** Every pitch in a village, rented or not. */
  pitchesOf(village: Village): Pitch[] {
    return village.stalls.map(([x, z], i) => {
      const id = pitchId(village.name, i);
      return { id, village: village.name, x, z, stall: this.stalls.get(id) ?? null };
    });
  }

  /** The pitch you are standing at, if you are standing at one. */
  nearest(villages: Village[], x: number, z: number): Pitch | null {
    let best: Pitch | null = null;
    let bestDistance = STALL_REACH;
    for (const village of villages) {
      if (Math.hypot(village.x - x, village.z - z) > village.radius + STALL_REACH) continue;
      for (const pitch of this.pitchesOf(village)) {
        const d = Math.hypot(pitch.x - x, pitch.z - z);
        if (d < bestDistance) { bestDistance = d; best = pitch; }
      }
    }
    return best;
  }

  /** The pitches this trader holds, so they can be found again across a wide world. */
  mine(name: string): Stall[] {
    return [...this.stalls.values()].filter((stall) => stall.owner === name);
  }
}

export function pitchId(village: string, pitch: number): string {
  return `${village}#${pitch}`;
}

/** What to ask for something, rounded to a price a person would actually say. */
export function askingPrice(id: string): number {
  const base = ITEMS[id]?.price ?? 1;
  return Math.max(1, Math.round((base * MARKUP) / 5) * 5);
}

/** One line describing a lot, as it appears on the stall. */
export function lotLine(lot: StallItem): string {
  const item = ITEMS[lot.id];
  return `${item?.emoji ?? '📦'} ${item?.name ?? lot.id}${lot.count > 1 ? ` ×${lot.count}` : ''} — ${lot.price}g`;
}
