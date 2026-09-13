import { describe, expect, it } from 'vitest';
import { GroundWorld } from '../src/world/groundworld';
import { TerrainSampler } from '../src/world/terrain';
import { generateWebGraph } from '../src/world/roadweb';
import { propFootprints } from '../src/entities/props';
import { Register } from '../src/world/register';
import { Wildlife } from './wildlife';
import type { Folk } from './wildlife';

/**
 * A villager who has been mauled and lived.
 *
 * `wounds.ts` gives a villager the middle state he never had — hurt for some days, not working,
 * costing the doctor's fee to mend — and `Register.hurt` is the door into it. The door had no
 * caller. Not a missing feature: a whole one, written, tested and documented, that nothing in the
 * game or the world ever opened, so `person.hurt` was undefined for every villager in every world
 * from the day it went in.
 *
 * Found by counting fallbacks rather than by reading: `person.hurt ?? 0` is evaluated 877,875 times
 * across three seeds and four hundred and fifty days, and takes the nought **every single time**.
 * A default that is the only value a thing ever has is a feature that never happens.
 */

/** A world with ground under it, and a register that knows who lives there. */
function worldAt(seed: number, x: number, z: number): { alive: Wildlife; book: Register } {
  const ground = new GroundWorld(new TerrainSampler(generateWebGraph(seed)), propFootprints());
  ground.reach(x, z, 2);
  const book = new Register(seed, 1);
  book.settle('Ashford', 5, ['farmer', 'seller', 'doctor', 'builder', 'hunter']);
  const folk: Folk = {
    villages: [], register: book, hasStable: () => false, priceOf: () => 2,
    highland: () => false, onFallen: () => {}, onArrest: () => {},
  };
  return { alive: new Wildlife(seed, ground, ground, folk), book };
}

describe('a villager who has been hurt', () => {
  it('is laid up afterwards, rather than walking it off', () => {
    const { alive, book } = worldAt(7, 0, 0);
    const who = book.living('Ashford')[0];
    expect(who, 'the village should have somebody in it').toBeDefined();
    expect(book.find(who.id)?.hurt ?? 0).toBe(0);

    // something with teeth gets to him, and he lives
    alive.hurtVillager(who.id, 0.5);

    expect(book.find(who.id)?.hurt ?? 0, 'a mauled villager should be laid up for some days')
      .toBeGreaterThan(0);
  });

  it('mends over the days rather than staying hurt for ever', () => {
    const { alive, book } = worldAt(7, 0, 0);
    const who = book.living('Ashford')[0];
    alive.hurtVillager(who.id, 0.5);
    const days = book.find(who.id)?.hurt ?? 0;

    for (let day = 2; day <= 2 + days; day++) book.advance(day);
    expect(book.find(who.id)?.hurt ?? 0, 'he should be back on his feet').toBe(0);
  });
});
