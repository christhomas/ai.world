/**
 * Deterministic random utilities. World generation must only use these,
 * never Math.random(), so a seed always reproduces the same world.
 */

export type Rng = () => number; // uniform in [0, 1)

/** xmur3-style string hash to a 32-bit unsigned seed. */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: small, fast, good enough for procedural content. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable integer hash of (seed, x, y, salt). Use for per-tile decisions that must not depend on generation order. */
export function hash3(seed: number, x: number, y: number, salt = 0): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (salt | 0), 0x27d4eb2f); h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

/** Uniform [0,1) derived from hash3. */
export function rand2(seed: number, x: number, y: number, salt = 0): number {
  return hash3(seed, x, y, salt) / 4294967296;
}

/** The one place Math.random is allowed: choosing a brand-new world seed. */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
