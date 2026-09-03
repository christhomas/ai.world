import { mulberry32 } from '../core/rng';
import { Biome } from '../world/biomes';
import { ITEMS, type Item } from './shops';

/**
 * Fishing: stand beside water with a rod, cast, wait for the bite, and press again in time.
 * Which fish live where comes from the biome; whether one bites comes from the seed, the day
 * and the spot, so the same pool fishes the same way for everyone.
 */
export const FISHING = {
  /** Water must be within this many tiles of the hero to cast. */
  REACH: 2.2,
  /** Seconds before the bite, and how long the window to strike lasts. */
  WAIT: [1.6, 4.5],
  STRIKE_WINDOW: 1.1,
} as const;

const CATCH: Record<Biome, string[]> = {
  [Biome.Plains]: ['minnow', 'perch', 'perch', 'pike'],
  [Biome.Forest]: ['minnow', 'perch', 'pike'],
  [Biome.Desert]: ['minnow', 'minnow', 'eel'],
  [Biome.Swamp]: ['eel', 'eel', 'minnow', 'pike'],
  [Biome.Mountain]: ['minnow', 'perch', 'perch'],
  [Biome.Snow]: ['minnow', 'perch', 'pike'],
};

export type FishingPhase = 'idle' | 'waiting' | 'bite';

export class Fishing {
  phase: FishingPhase = 'idle';
  private timer = 0;
  private spot: [number, number] = [0, 0];
  private biome: Biome = Biome.Plains;
  private catchId = 'minnow';

  get active(): boolean { return this.phase !== 'idle'; }

  /** Begin a cast. `nibble` is the deterministic roll for this spot and day. */
  cast(x: number, z: number, biome: Biome, seed: number, day: number): void {
    this.spot = [x, z];
    this.biome = biome;
    const rng = mulberry32((seed ^ Math.floor(x) * 73856093 ^ Math.floor(z) * 19349663 ^ day * 83492791) >>> 0);
    const table = CATCH[biome];
    this.catchId = table[Math.floor(rng() * table.length)];
    this.timer = FISHING.WAIT[0] + rng() * (FISHING.WAIT[1] - FISHING.WAIT[0]);
    this.phase = 'waiting';
  }

  cancel(): void { this.phase = 'idle'; }

  /** @returns 'bite' the moment a fish takes, 'missed' when the window closes, else null */
  update(dt: number): 'bite' | 'missed' | null {
    if (this.phase === 'idle') return null;
    this.timer -= dt;
    if (this.timer > 0) return null;
    if (this.phase === 'waiting') {
      this.phase = 'bite';
      this.timer = FISHING.STRIKE_WINDOW;
      return 'bite';
    }
    this.phase = 'idle';
    return 'missed';
  }

  /** Strike now. Returns the catch if the timing was right, else null. */
  strike(): Item | null {
    if (this.phase !== 'bite') { this.phase = 'idle'; return null; }
    this.phase = 'idle';
    return ITEMS[this.catchId];
  }

  get bobber(): [number, number] { return this.spot; }
}
