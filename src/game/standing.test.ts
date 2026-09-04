import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import { deedOf } from './combat';
import { LAW, Standing, wordsFor } from './standing';

/** Somebody standing about, of whatever kind, for the deeds that are done to them. */
function someone(kindId: string): Entity {
  const kind = KINDS[kindId];
  return new Entity(kind, 0, 0, new Herd(kind, 0, 0, 0, 0, 5), 'k', mulberry32(1));
}

describe('what the country makes of you', () => {
  it('thinks worse of you for killing a villager', () => {
    const you = new Standing();
    you.did('murder');
    expect(you.value).toBeLessThan(0);
    expect(you.words).not.toBe(wordsFor(0));
  });

  it('thinks better of you for pulling a wolf off one, and better still for carrying them in', () => {
    const rescuer = new Standing();
    rescuer.did('rescue');
    const carrier = new Standing();
    carrier.did('mercy');

    expect(rescuer.value).toBeGreaterThan(0);
    expect(carrier.value).toBeGreaterThan(rescuer.value);
  });

  it('counts cutting down a villager as murder, and the wolf that was on them as a rescue', () => {
    const farmer = someone('villager');
    const wolf = someone('wolf');

    expect(deedOf(farmer)).toBe('murder');
    expect(deedOf(wolf)).toBeNull();          // a wolf minding its own business is only hunting
    wolf.target = farmer;
    expect(deedOf(wolf)).toBe('rescue');
  });

  it('never buys a killing back with one good turn', () => {
    const you = new Standing();
    you.did('murder');
    you.did('rescue');
    expect(you.value).toBeLessThan(0);
  });

  it('says the same six things walking the whole scale down, and says them in order', () => {
    const said: string[] = [];
    for (let score = LAW.BEST; score >= LAW.WORST; score--) {
      const words = wordsFor(score);
      if (words !== said[said.length - 1]) said.push(words);
    }
    expect(said).toEqual([
      'well thought of',
      'a good neighbour',
      'nobody in particular',
      'given a wide berth',
      'not welcome here',
      'wanted for murder',
    ]);
  });

  it('changes its words exactly where the law changes its mind', () => {
    expect(wordsFor(LAW.WANTED_AT)).toBe('not welcome here');
    expect(new Standing(LAW.WANTED_AT).wanted).toBe(false);
    expect(wordsFor(LAW.WANTED_AT - 1)).toBe('wanted for murder');
    expect(new Standing(LAW.WANTED_AT - 1).wanted).toBe(true);
  });

  it('sends nobody after a hunter, and the constables after two killings', () => {
    const you = new Standing();
    expect(you.wanted).toBe(false);
    you.did('murder');
    expect(you.wanted).toBe(false);            // a scandal, not yet a manhunt
    you.did('murder');
    expect(you.wanted).toBe(true);
    expect(you.words).toBe('wanted for murder');
  });

  it('holds a worse criminal for longer, and holds nobody it does not want', () => {
    const bad = new Standing(LAW.WANTED_AT - 1);
    const worst = new Standing(LAW.WORST);

    expect(new Standing().sentence()).toBe(0);
    expect(bad.sentence()).toBeGreaterThanOrEqual(LAW.CELL_LEAST);
    expect(worst.sentence()).toBeGreaterThan(bad.sentence());
    expect(worst.sentence()).toBe(LAW.CELL_MOST);
    expect(worst.guilt).toBe(1);
  });

  it('cannot be talked past the best or the worst there is', () => {
    const saint = new Standing();
    const monster = new Standing();
    for (let deeds = 0; deeds < 50; deeds++) { saint.did('mercy'); monster.did('murder'); }

    expect(saint.value).toBe(LAW.BEST);
    expect(saint.words).toBe('well thought of');
    expect(monster.value).toBe(LAW.WORST);
    // and the bottom is a floor, not a hole: one good turn down there still counts for something
    monster.did('rescue');
    expect(monster.value).toBe(LAW.WORST + LAW.RESCUE);
  });

  it('lets you out at the line, so the next killing puts you straight back inside', () => {
    const you = new Standing(LAW.WORST);
    you.served();

    expect(you.wanted).toBe(false);
    expect(you.words).toBe('not welcome here');
    you.did('murder');
    expect(you.wanted).toBe(true);
  });

  it('only speaks up when the words change, not on every deed', () => {
    const you = new Standing();
    expect(you.did('rescue')).toBe(false);     // a good turn, and still nobody in particular
    expect(you.did('murder')).toBe(true);      // that, the village talks about
  });
});
