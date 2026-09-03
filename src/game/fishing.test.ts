import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { FISHING, Fishing } from './fishing';

describe('fishing', () => {
  it('casts, bites after a wait, and only pays out when struck in the window', () => {
    const f = new Fishing();
    expect(f.active).toBe(false);
    expect(f.strike()).toBeNull();

    f.cast(10, 10, Biome.Plains, 1, 1);
    expect(f.phase).toBe('waiting');
    // striking early loses the cast
    expect(f.strike()).toBeNull();
    expect(f.active).toBe(false);

    f.cast(10, 10, Biome.Plains, 1, 1);
    let sawBite = false;
    for (let t = 0; t < FISHING.WAIT[1] + 0.2; t += 0.1) if (f.update(0.1) === 'bite') { sawBite = true; break; }
    expect(sawBite).toBe(true);
    const fish = f.strike();
    expect(fish).not.toBeNull();
    expect(fish!.price).toBeGreaterThan(0);
    expect(f.active).toBe(false);
  });

  it('misses when the window closes, and the catch is the same for the same spot and day', () => {
    const f = new Fishing();
    f.cast(3, 4, Biome.Swamp, 42, 2);
    let missed = false;
    for (let t = 0; t < FISHING.WAIT[1] + FISHING.STRIKE_WINDOW + 0.5; t += 0.1) if (f.update(0.1) === 'missed') { missed = true; break; }
    expect(missed).toBe(true);

    const catchAt = (seed: number, day: number, x: number, biome: Biome) => {
      const g = new Fishing();
      g.cast(x, 4, biome, seed, day);
      for (let t = 0; t < 10; t += 0.1) if (g.update(0.1) === 'bite') break;
      return g.strike()?.id;
    };
    expect(catchAt(42, 2, 3, Biome.Swamp)).toBe(catchAt(42, 2, 3, Biome.Swamp));
    // swamps hold eels, mountain pools do not
    const swampCatches = new Set([0, 1, 2, 3, 4, 5].map((i) => catchAt(42, 2, i, Biome.Swamp)));
    const mountainCatches = new Set([0, 1, 2, 3, 4, 5].map((i) => catchAt(42, 2, i, Biome.Mountain)));
    expect([...mountainCatches].every((id) => id !== 'eel')).toBe(true);
    expect(swampCatches.size).toBeGreaterThan(1);
  });
});
