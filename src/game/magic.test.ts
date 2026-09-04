import { describe, expect, it } from 'vitest';
import { COMBAT } from './combat';
import { ITEMS } from './items';
import { GameState } from './state';
import { Magic, SPELL, SPELLS, turnedAside, type SpellId } from './magic';

/** A hero standing about with whatever they were given, for the spells that are drunk. */
const carrying = (things: Record<string, number> = {}): GameState => {
  const hero = new GameState();
  for (const [id, n] of Object.entries(things)) hero.give(id, n);
  return hero;
};

/** Let a stretch of game time pass, a frame at a time, the way the loop would. */
const seconds = (magic: Magic, howLong: number, step = 1 / 60): void => {
  for (let left = howLong; left > 0; left -= step) magic.tick(Math.min(step, left));
};

/** How long until this spell can be cast again, counted in frames rather than worked out on paper. */
const waitFor = (magic: Magic, id: SpellId, hero: GameState, giveUpAfter = 60): number => {
  for (let waited = 0; waited < giveUpAfter; waited += 0.1) {
    if (magic.reason(id, hero) === null) return waited;
    seconds(magic, 0.1);
  }
  return Infinity;
};

describe('what a spell costs', () => {
  it('spends breath the moment it is cast, and gives it back at a walking pace', () => {
    const magic = new Magic();
    const hero = carrying();

    expect(magic.breath).toBe(SPELL.BREATH);
    magic.cast('ward', hero);
    expect(magic.breath).toBe(SPELL.BREATH - SPELL.WARD_BREATH);

    // nothing comes back while you are still winded from the casting
    const spent = SPELL.BREATH - SPELL.WARD_BREATH;
    seconds(magic, SPELL.WINDED * 0.75);
    expect(magic.breath).toBeCloseTo(spent, 5);

    // and from the end of that moment it comes back at exactly the rate it says it does
    seconds(magic, SPELL.WINDED * 0.25 + 2);
    expect(magic.breath).toBeCloseTo(spent + 2 * SPELL.RECOVERS, 1);
  });

  it('never fills past a full chest, however long you stand about', () => {
    const magic = new Magic();
    magic.cast('blight', carrying());
    seconds(magic, 120);
    expect(magic.breath).toBe(SPELL.BREATH);
    expect(magic.wind).toBe(1);
  });

  it('refuses a hero with nothing left, and says so rather than doing nothing', () => {
    const magic = new Magic();
    const hero = carrying();
    magic.cast('ward', hero);            // seven of ten gone

    expect(magic.reason('ward', hero)).toMatch(/breath/i);
    const nothing = magic.cast('ward', hero);
    expect(nothing.spell).toBeNull();
    expect(nothing.blow).toBeNull();
    expect(nothing.words).toMatch(/breath/i);
    expect(magic.breath).toBe(SPELL.BREATH - SPELL.WARD_BREATH);   // and a refusal costs nothing
  });

  it('makes you wait longer for a second ward than the first one lasts, so running is a decision', () => {
    const magic = new Magic();
    const hero = carrying();
    magic.cast('ward', hero);

    const again = waitFor(magic, 'ward', hero);
    expect(again).toBeGreaterThan(SPELL.WARD_SECONDS);
    expect(magic.ward).toBe(0);          // by the time you can ward again, the first has lapsed
  });
});

describe('the ward, which is the way out of a fight', () => {
  it('turns half a blow aside while it holds, and none of it once it has lapsed', () => {
    const magic = new Magic();
    magic.cast('ward', carrying());

    expect(magic.ward).toBe(SPELL.WARD_SHARE);
    expect(turnedAside(4, magic.ward)).toBe(2);

    seconds(magic, SPELL.WARD_SECONDS - 0.5);
    expect(turnedAside(4, magic.ward)).toBe(2);   // still up, right to the end of it

    seconds(magic, 1);
    expect(magic.ward).toBe(0);
    expect(magic.warded).toBe(0);
    expect(turnedAside(4, magic.ward)).toBe(4);
  });

  it('turns nothing aside for anybody who never cast it', () => {
    expect(new Magic().ward).toBe(0);
    expect(turnedAside(3, 0)).toBe(3);
    // and a nonsense share is treated as the nearest sensible one, never as a refund
    expect(turnedAside(3, -1)).toBe(3);
    expect(turnedAside(3, 2)).toBe(0);
  });

  it('never turns a blow aside completely, so standing still is still fatal', () => {
    for (const id of ['ward', 'draught'] as const) {
      const effect = SPELLS[id].effect;
      expect(effect.kind).toBe('ward');
      if (effect.kind !== 'ward') continue;
      expect(effect.share).toBeGreaterThan(0);
      expect(effect.share).toBeLessThan(1);
      expect(turnedAside(6, effect.share)).toBeGreaterThan(0);
    }
  });

  it('lets a hero with no breath at all still drink the draught they carried', () => {
    const magic = new Magic();
    const hero = carrying({ ward: 1 });
    magic.breath = 0;

    const drunk = magic.cast('draught', hero);
    expect(drunk.spell?.id).toBe('draught');
    expect(magic.ward).toBe(SPELL.DRAUGHT_SHARE);
    expect(hero.count('ward')).toBe(0);          // the bottle is empty now
    expect(magic.cast('draught', hero).spell).toBeNull();
    expect(magic.cast('draught', hero).words).toMatch(/no warding draught/i);
  });

  it('holds a bottled ward longer and harder than a spoken one, having cost more to get', () => {
    expect(SPELL.DRAUGHT_SHARE).toBeGreaterThan(SPELL.WARD_SHARE);
    expect(SPELL.DRAUGHT_SECONDS).toBeGreaterThan(SPELL.WARD_SECONDS);
    expect(ITEMS[SPELLS.draught.drinks!]).toBeDefined();
    expect(SPELLS.draught.breath).toBe(0);
  });

  it('takes the better of a spoken ward and a bottled one rather than adding them up', () => {
    const magic = new Magic();
    const hero = carrying({ ward: 1 });
    magic.cast('draught', hero);
    magic.cast('ward', hero);

    expect(magic.ward).toBe(SPELL.DRAUGHT_SHARE);
    expect(magic.warded).toBeCloseTo(SPELL.DRAUGHT_SECONDS, 5);
  });

  it('puts everything out at once when the hero goes down', () => {
    const magic = new Magic();
    const hero = carrying({ ward: 1 });
    magic.cast('draught', hero);
    magic.cast('light', hero);
    expect(magic.ward).toBeGreaterThan(0);
    expect(magic.lit).toBe(true);

    magic.dispel();
    expect(magic.ward).toBe(0);
    expect(magic.lit).toBe(false);
  });
});

describe('the other two spells', () => {
  it('lights the dark for a good while, and then it goes out', () => {
    const magic = new Magic();
    const lit = magic.cast('light', carrying());

    expect(lit.spell?.id).toBe('light');
    expect(lit.blow).toBeNull();
    expect(magic.lit).toBe(true);
    seconds(magic, SPELL.LIGHT_SECONDS - 1);
    expect(magic.lit).toBe(true);
    seconds(magic, 2);
    expect(magic.lit).toBe(false);
  });

  it('reaches much further than a sword arm', () => {
    const struck = new Magic().cast('blight', carrying());

    expect(struck.blow).toEqual({ damage: SPELL.BLIGHT_DAMAGE, range: SPELL.BLIGHT_RANGE });
    expect(struck.blow!.range).toBeGreaterThan(COMBAT.RANGE * 2);
  });

  it('leaves the sword the way a fight is actually won', () => {
    const magic = new Magic();
    const hero = GameState.fresh();          // a stick and nothing better
    let cast = 0;
    for (let elapsed = 0; elapsed < 10; elapsed += 0.05) {
      if (magic.cast('blight', hero).spell) cast++;
      magic.tick(0.05);
    }
    const bySpell = cast * SPELL.BLIGHT_DAMAGE;
    const bySword = Math.floor(10 / COMBAT.COOLDOWN) * hero.attack;

    expect(cast).toBeGreaterThan(0);         // it is worth casting at all
    expect(bySpell * 4).toBeLessThan(bySword);
  });
});
