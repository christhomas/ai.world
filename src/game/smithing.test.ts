import { describe, expect, it } from 'vitest';
import { FORGES, SMITHING, aSmithsDay, dearnessOfGear, whatToMake } from './smithing';
import { Forge } from './forge';
import { ITEMS } from './items';

/**
 * A smith's day, which is the first thing in this world made *out of* other things.
 *
 * The acceptance in #232, one test each: a village with a smithy, ore and timber makes gear and the
 * same village without ore makes none; the shelf runs out and moves in price with what is left;
 * and no village mints a sword out of nothing.
 */
const ASHFORD = 'Ashford';
const RICH = { ore: 40, timber: 40 };

describe('what a smith turns to', () => {
  it('fills out the range before it deepens it', () => {
    // a village makes one of each before a second of any, so a shop reads as a shop rather than as
    // a rack of the one thing its smith happens to like
    const shelf = new Map<string, number>([['sword', 2]]);
    const made = whatToMake(7, ASHFORD, 1, (id) => shelf.get(id) ?? 0);
    expect(made, 'there is work to do').not.toBeNull();
    expect(made!.id, 'not the one there are already two of').not.toBe('sword');
  });

  it('stops when the shelf is stocked, which is a smith with a full shop', () => {
    const full = (id: string) => (FORGES.some((one) => one.id === id) ? SMITHING.KEEPS : 0);
    expect(whatToMake(7, ASHFORD, 1, full)).toBeNull();
  });

  it('gives two villages different mornings', () => {
    // a tie is broken by the day and the place, so two empty shelves are not the same shelf twice
    const empty = () => 0;
    const here = whatToMake(7, ASHFORD, 1, empty);
    const elsewhere = whatToMake(7, 'Stonedale', 1, empty);
    const later = whatToMake(7, ASHFORD, 2, empty);
    expect([here?.id, elsewhere?.id, later?.id].filter(Boolean).length).toBe(3);
    expect(new Set([here!.id, elsewhere!.id, later!.id]).size, 'not all three the same').toBeGreaterThan(1);
  });
});

describe('a village with a smithy and the makings', () => {
  it('makes gear', () => {
    expect(aSmithsDay(7, ASHFORD, 1, 1, RICH, () => 0)).not.toBeNull();
  });

  it('makes none without a smith in it, however full the heap', () => {
    expect(aSmithsDay(7, ASHFORD, 1, 0, RICH, () => 0)).toBeNull();
  });

  it('makes none without the ore, and says so by making nothing', () => {
    const noOre = aSmithsDay(7, ASHFORD, 1, 1, { ore: 0, timber: 40 }, () => 0);
    expect(noOre, 'a forge with nothing to forge').toBeNull();
  });

  it('never mints: what it makes always cost it something', () => {
    /*
     * The rule the whole economy is audited against. Every recipe takes materials, and a recipe
     * that took none would be a village minting a sword out of nothing — which is exactly what
     * #232's acceptance forbids and what `economy.test.ts` would eventually catch the hard way.
     */
    for (const one of FORGES) {
      expect(one.ore + one.timber, `${one.id} is made out of nothing`).toBeGreaterThan(0);
      expect(ITEMS[one.id], `${one.id} is not a thing`).toBeDefined();
    }
  });
});

describe('a shelf that runs out', () => {
  it('spends the materials only on a morning that made something', () => {
    const forge = new Forge();
    let drawn = 0;
    const full = { ore: 40, timber: 40 };
    forge.workThrough(7, ASHFORD, 1, 1, full, (o, t) => { drawn += o + t; return true; });
    expect(drawn, 'the first morning made something').toBeGreaterThan(0);

    const bare = new Forge();
    let spent = 0;
    bare.workThrough(7, ASHFORD, 1, 1, { ore: 0, timber: 0 }, (o, t) => { spent += o + t; return true; });
    expect(spent, 'a forge short of everything spends nothing').toBe(0);
  });

  it('works a morning once, however many times it is lived', () => {
    // the same rule the yards keep, and for the same reason: a day skipped by a clock correction
    // or lived again by `relive` is still one day's work
    const forge = new Forge();
    const ok = () => true;
    forge.workThrough(7, ASHFORD, 5, 1, RICH, ok);
    const after = FORGES.reduce((sum, one) => sum + forge.at(ASHFORD, one.id), 0);
    forge.workThrough(7, ASHFORD, 5, 1, RICH, ok);
    expect(FORGES.reduce((sum, one) => sum + forge.at(ASHFORD, one.id), 0)).toBe(after);
  });

  it('hands over what is there and refuses what is not', () => {
    const forge = new Forge();
    expect(forge.take(ASHFORD, 'sword'), 'an empty shelf').toBe(false);
    forge.made(ASHFORD, 'sword');
    expect(forge.take(ASHFORD, 'sword')).toBe(true);
    expect(forge.take(ASHFORD, 'sword'), 'and it is gone').toBe(false);
  });

  it('asks more for the last one than for a full shelf', () => {
    expect(dearnessOfGear(SMITHING.KEEPS)).toBeCloseTo(1, 5);
    expect(dearnessOfGear(1)).toBeGreaterThan(1);
    expect(dearnessOfGear(0)).toBeCloseTo(SMITHING.DEAR, 5);
    // smooth, so no village crosses a cliff between two mornings
    expect(dearnessOfGear(2)).toBeLessThan(dearnessOfGear(1));
  });

  it('leaves what a village does not make at the catalogue price', () => {
    // a steel sword in a mountain town was carried there by somebody, and its shelf is as deep as
    // the catalogue exactly as it always was
    const forge = new Forge();
    expect(Forge.makes('steelsword')).toBe(false);
    expect(forge.dearness(ASHFORD, 'steelsword')).toBe(1);
  });

  it('round-trips through a save', () => {
    const forge = new Forge();
    forge.made(ASHFORD, 'helm');
    forge.made(ASHFORD, 'helm');
    const back = Forge.from(JSON.parse(JSON.stringify(forge.toJSON())));
    expect(back.at(ASHFORD, 'helm')).toBe(2);
  });
});
