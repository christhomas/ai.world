import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import type { Person } from '../world/people';
import { GIFT, Gifts, natureOf, worthOf } from './gifts';
import { ITEMS } from './items';
import { LAW } from './standing';
import { GameState } from './state';

/**
 * The point of this module is that judgement beats money and that nothing here can be farmed, so
 * what is tested is the two orderings that make it true: a thing somebody needed against a dearer
 * thing they did not, and the same thing twice against the same thing once.
 */

/** Somebody who lives in Ashford, with a trade and an age and nothing else about them. */
const villager = (trade: string, born = -30): Person => ({
  id: `ashford-${trade}`, name: `Maren Vos`, village: 'Ashford', trade, born, lives: 70,
  mother: '', father: '', knows: [], memories: [], purse: 0,
});

/** A pack with these things in it. */
const packed = (...ids: string[]): GameState => {
  const state = new GameState();
  for (const id of ids) state.give(id, 1);
  return state;
};

/** Hand one thing over on a given day, having first made sure it is in the pack. */
const hand = (gifts: Gifts, person: Person, biome: Biome, id: string, day: number) => {
  const state = packed(id);
  return gifts.give(state, person, biome, id, day, 'Ella')!;
};

/**
 * Court somebody: one well judged thing a day out of `menu`, until they decide you are somebody.
 * Returns the day it happened, or nothing at all if a month of it was not enough.
 */
const befriend = (gifts: Gifts, person: Person, biome: Biome, menu: string[]): number => {
  for (let day = 1; day <= 30; day++) {
    // nobody owes you anything until the moment they do, and this checks it on every one of them
    expect(gifts.favourFrom(person) === null).toBe(!gifts.favoured(person.id));
    if (hand(gifts, person, biome, menu[(day - 1) % menu.length], day).turned) return day;
  }
  return -1;
};

/** Everything a doctor could want, and everything a hunter could. */
const PHYSICS = ['elixir', 'salve', 'potion', 'antidote', 'stew'];
const TOOLS = ['knife', 'rod', 'shovel', 'saw', 'pick'];

describe('what a gift is worth', () => {
  it('is worth more cheap and well judged than dear and thoughtless', () => {
    const innkeeper = villager('innkeeper');
    const apple = worthOf(ITEMS.apple, innkeeper, Biome.Plains, 1);
    const mail = worthOf(ITEMS.mail, innkeeper, Biome.Plains, 1);

    expect(apple).toBeGreaterThan(mail);
    // and even to somebody whose trade wants neither, thirty-six times the price buys nothing
    const farmer = villager('farmer');
    expect(worthOf(ITEMS.apple, farmer, Biome.Plains, 1)).toBeGreaterThan(worthOf(ITEMS.mail, farmer, Biome.Plains, 1));
  });

  it('knows what a trade is short of', () => {
    const soldier = villager('soldier');
    const farmer = villager('farmer');
    const doctor = villager('doctor');

    expect(worthOf(ITEMS.sword, soldier, Biome.Plains, 1)).toBeGreaterThan(worthOf(ITEMS.sword, farmer, Biome.Plains, 1));
    expect(worthOf(ITEMS.salve, doctor, Biome.Plains, 1)).toBeGreaterThan(worthOf(ITEMS.salve, farmer, Biome.Plains, 1));
    expect(worthOf(ITEMS.wheatseed, farmer, Biome.Plains, 1)).toBeGreaterThan(worthOf(ITEMS.wheatseed, soldier, Biome.Plains, 1));
  });

  it('knows what a country is short of, whoever is standing in it', () => {
    const farmer = villager('farmer');
    expect(worthOf(ITEMS.pelt, farmer, Biome.Snow, 1)).toBeGreaterThan(worthOf(ITEMS.pelt, farmer, Biome.Plains, 1));
    expect(worthOf(ITEMS.bread, farmer, Biome.Desert, 1)).toBeGreaterThan(worthOf(ITEMS.bread, farmer, Biome.Plains, 1));
    expect(worthOf(ITEMS.antidote, farmer, Biome.Swamp, 1)).toBeGreaterThan(worthOf(ITEMS.antidote, farmer, Biome.Plains, 1));
  });

  it('gives a child something to eat and never a sword', () => {
    const child = villager('', -10);
    const grown = villager('farmer');
    expect(worthOf(ITEMS.bread, child, Biome.Plains, 1)).toBeGreaterThan(worthOf(ITEMS.bread, grown, Biome.Plains, 1));
    expect(worthOf(ITEMS.bread, child, Biome.Plains, 1)).toBeGreaterThan(worthOf(ITEMS.sword, child, Biome.Plains, 1));
  });

  it('judges a thing by what it does, never by its name', () => {
    expect(natureOf(ITEMS.pelt)).toBe('warmth');
    expect(natureOf(ITEMS.wheatseed)).toBe('seed');
    expect(natureOf(ITEMS.elixir)).toBe('physic');
    expect(natureOf(ITEMS.roast)).toBe('food');       // gathered and cooked, so a meal and not a medicine
    expect(natureOf(ITEMS.bow)).toBe('steel');
    expect(natureOf(ITEMS.shield)).toBe('armour');
    expect(natureOf(ITEMS.lantern)).toBe('tool');
    expect(natureOf(ITEMS.gem)).toBe('treasure');
  });
});

describe('what giving comes to', () => {
  it('counts the same thing for less the second time, and less again the third', () => {
    const gifts = new Gifts();
    const farmer = villager('farmer');
    const first = hand(gifts, farmer, Biome.Plains, 'apple', 1);
    const second = hand(gifts, farmer, Biome.Plains, 'apple', 2);
    const third = hand(gifts, farmer, Biome.Plains, 'apple', 3);

    expect(second.warmth).toBeLessThan(first.warmth);
    expect(third.warmth).toBeLessThan(second.warmth);
    expect(third.warmth).toBeGreaterThan(0);          // it still counts for something: it was still given
  });

  it('counts for less again when it is the fourth present since breakfast', () => {
    const stuffed = new Gifts();
    const spread = new Gifts();
    const innkeeper = villager('innkeeper');

    for (const id of ['pumpkin', 'roast', 'stew']) hand(stuffed, innkeeper, Biome.Plains, id, 1);
    const sameDay = hand(stuffed, innkeeper, Biome.Plains, 'bread', 1);

    for (const [n, id] of ['pumpkin', 'roast', 'stew'].entries()) hand(spread, innkeeper, Biome.Plains, id, n + 1);
    const freshDay = hand(spread, innkeeper, Biome.Plains, 'bread', 4);

    expect(sameDay.warmth).toBeLessThan(freshDay.warmth);
  });

  it('will not hand over what you are not carrying', () => {
    const gifts = new Gifts();
    const farmer = villager('farmer');
    const empty = new GameState();

    expect(gifts.give(empty, farmer, Biome.Plains, 'sword', 1, 'Ella')).toBeNull();
    expect(gifts.warmthWith(farmer.id)).toBe(0);

    // nor the sword off your own hip, until you take it off
    const armed = packed('sword');
    armed.equip('sword');
    expect(gifts.give(armed, farmer, Biome.Plains, 'sword', 1, 'Ella')).toBeNull();
  });

  it('cannot be paid in gold, which is the whole idea', () => {
    const gifts = new Gifts();
    const state = packed('apple');
    state.inventory.gold = 500;
    expect(gifts.give(state, villager('farmer'), Biome.Plains, 'gold', 1, 'Ella')).toBeNull();
  });

  it('takes the thing out of the pack exactly once', () => {
    const gifts = new Gifts();
    const state = packed('apple');
    state.give('apple', 1);
    gifts.give(state, villager('farmer'), Biome.Plains, 'apple', 1, 'Ella');
    expect(state.count('apple')).toBe(1);
  });

  it('leaves the person remembering who it was', () => {
    const gifts = new Gifts();
    const farmer = villager('farmer');
    const given = hand(gifts, farmer, Biome.Plains, 'apple', 4);

    expect(farmer.memories[0].who).toBe('Ella');
    expect(farmer.memories[0].day).toBe(4);
    expect(given.memory).toEqual({ what: 'given', who: 'Ella', day: 4 });
  });
});

describe('what it does to your standing in the country', () => {
  it('moves the scale towards good, by far less than a killing moves it the other way', () => {
    const gifts = new Gifts();
    // the best single gift there is: a bear pelt, to a climber, in the snow
    const best = hand(gifts, villager('climber'), Biome.Snow, 'bearpelt', 1);

    expect(best.standing).toBeGreaterThan(0);
    expect(best.standing).toBeLessThanOrEqual(GIFT.KINDNESS);
    expect(best.standing).toBeLessThan(LAW.RESCUE);
    // twenty of the most generous things you could possibly do, to undo one killing
    expect(Math.abs(LAW.MURDER) / best.standing).toBeGreaterThan(20);
  });

  it('never lets one gift buy a pardon, whatever somebody prices an item at', () => {
    const gifts = new Gifts();
    const soldier = villager('soldier');
    for (const id of ['stick', 'sword', 'steelsword', 'axe', 'bow']) {
      const given = hand(gifts, soldier, Biome.Plains, id, 1);
      expect(given.standing).toBeLessThanOrEqual(GIFT.KINDNESS);
    }
  });
});

describe('what somebody gives back', () => {
  it('gives nothing back until enough has been given, and takes days about it', () => {
    const gifts = new Gifts();
    const doctor = villager('doctor');
    const turned = befriend(gifts, doctor, Biome.Plains, PHYSICS);

    expect(turned).toBeGreaterThan(4);                // no afternoon of shopping buys this
    expect(gifts.favourFrom(doctor)).toEqual({ kind: 'mend', words: expect.any(String) });
  });

  it('cannot be hurried by standing there handing over the same thing', () => {
    const gifts = new Gifts();
    const doctor = villager('doctor');
    for (let n = 0; n < 40; n++) hand(gifts, doctor, Biome.Plains, 'elixir', 1);
    expect(gifts.favoured(doctor.id)).toBe(false);
  });

  it('pays back in its own coin and not in gold', () => {
    const gifts = new Gifts();
    const hunter = villager('hunter');
    befriend(gifts, hunter, Biome.Plains, TOOLS);

    const owed = gifts.favourFrom(hunter);
    expect(owed).not.toBeNull();
    expect(owed!.kind).toBe('goods');
    if (owed!.kind === 'goods') expect(ITEMS[owed!.item]).toBeDefined();
  });

  it('puts one thing by a day, and not an orchard', () => {
    const gifts = new Gifts();
    const hunter = villager('hunter');
    const turned = befriend(gifts, hunter, Biome.Plains, TOOLS);

    expect(gifts.claim(hunter, turned + 1)).not.toBeNull();
    expect(gifts.claim(hunter, turned + 1)).toBeNull();
    expect(gifts.spareToday(hunter, turned + 1)).toBeNull();
    expect(gifts.claim(hunter, turned + 2)).not.toBeNull();
  });

  it('does not make a standing arrangement into something you collect', () => {
    const gifts = new Gifts();
    const doctor = villager('doctor');
    befriend(gifts, doctor, Biome.Plains, PHYSICS);

    expect(gifts.favourFrom(doctor)!.kind).toBe('mend');
    expect(gifts.spareToday(doctor, 9)).toBeNull();   // there is nothing to collect: it is simply how things are
    expect(gifts.claim(doctor, 9)).toBeNull();
  });

  it('says how you stand without ever saying a number', () => {
    const gifts = new Gifts();
    const farmer = villager('farmer');
    const stranger = gifts.wordsFor('nobody');
    hand(gifts, farmer, Biome.Plains, 'wheatseed', 1);

    expect(stranger).not.toBe(gifts.wordsFor(farmer.id));
    expect(gifts.wordsFor(farmer.id)).toMatch(/[a-z]/);
  });

  it('remembers who you were good to after the game has been closed', () => {
    const gifts = new Gifts();
    const farmer = villager('farmer');
    hand(gifts, farmer, Biome.Plains, 'turnipseed', 1);
    hand(gifts, farmer, Biome.Plains, 'pumpkinseed', 2);

    const reopened = new Gifts(JSON.parse(JSON.stringify(gifts.save())));
    expect(reopened.warmthWith(farmer.id)).toBeCloseTo(gifts.warmthWith(farmer.id));
    // and the fading survives with it, so a save is not a way of starting the apples again
    const again = hand(reopened, farmer, Biome.Plains, 'turnipseed', 3);
    const fresh = hand(new Gifts(), farmer, Biome.Plains, 'turnipseed', 3);
    expect(again.warmth).toBeLessThan(fresh.warmth);
  });
});
