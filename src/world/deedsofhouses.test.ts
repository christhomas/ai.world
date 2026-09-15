import { describe, expect, it } from 'vitest';
import { deedsAfter, homesOf, householdsOf } from './homes';
import type { Person } from './people';
import type { Structure } from './structures';
import { Register } from './register';

/**
 * A family keeps its own house, which position alone cannot promise.
 *
 * Who lives where is arithmetic: houses in seed order, households in founding order, first to
 * first. That needs no storage and agrees across machines without a word crossing the wire, and it
 * is the right default — right up until the list changes underneath it. A household that dies out,
 * or people walking into an emptied village, reshuffles the pairing, and a family finds itself in a
 * different house than the one it lived in yesterday with nothing having happened to either.
 *
 * A deed is the fact position cannot carry. It is stored and replayed for the same reason a violent
 * death and a raising at a shrine are: *which house is mine* stops being derivable the moment the
 * world has a history.
 */
const house = (tx: number, tz: number): Structure => ({ tx, tz } as Structure);
const roofs = (many: number): Structure[] => Array.from({ length: many }, (_, at) => house(at, 0));
const person = (id: string, name: string): Person => ({ id, name } as Person);

describe('a deed on a house', () => {
  const houses = roofs(3);
  const vos = person('a', 'Greta Vos');
  const hoorn = person('b', 'Jan Hoorn');
  const aal = person('c', 'Mira Aal');

  it('is written for every household the first time anybody asks', () => {
    const deeds = deedsAfter(houses.length, [vos, hoorn], []);
    expect(deeds.map((one) => [one.house, one.family])).toEqual([[0, 'Vos'], [1, 'Hoorn']]);
  });

  it('leaves everybody where they were when a household in front of them dies out', () => {
    const first = deedsAfter(houses.length, [vos, hoorn, aal], []);
    // Vos is buried; without deeds Hoorn would move into house 0 and Aal into house 1
    const after = deedsAfter(houses.length, [hoorn, aal], first);
    const homes = homesOf(houses, [hoorn, aal], after);
    expect(homes[0].family, 'the house the buried family held stands empty').toBe('');
    expect(homes[1].family).toBe('Hoorn');
    expect(homes[2].family).toBe('Aal');
  });

  it('gives somebody walking in off the road a house nobody holds, not somebody else\'s', () => {
    const held = deedsAfter(houses.length, [vos, hoorn, aal], []);
    const buried = deedsAfter(houses.length, [hoorn, aal], held);
    const arrived = deedsAfter(houses.length, [hoorn, aal, person('d', 'Pell Rook')], buried);
    const homes = homesOf(houses, [hoorn, aal, person('d', 'Pell Rook')], arrived);
    expect(homes.map((one) => one.family)).toEqual(['Rook', 'Hoorn', 'Aal']);
  });

  it('houses nobody it has no roof for, rather than inventing one', () => {
    const crowd = [vos, hoorn, aal, person('d', 'Pell Rook')];
    const deeds = deedsAfter(houses.length, crowd, []);
    expect(deeds).toHaveLength(3);
    expect(householdsOf(crowd)).toHaveLength(4);
  });

  it('is the same answer asked twice, so a replay does not shuffle anybody', () => {
    const once = deedsAfter(houses.length, [vos, hoorn], []);
    expect(deedsAfter(houses.length, [vos, hoorn], once)).toEqual(once);
  });

  it('forgets a deed for a roof that is no longer standing', () => {
    const deeds = deedsAfter(houses.length, [vos, hoorn], []);
    // the village comes back with one roof: Vos keeps the one they hold and Hoorn's deed names
    // nothing, rather than both being re-paired against a shorter list
    const after = deedsAfter(1, [vos, hoorn], deeds);
    expect(after.map((one) => one.family)).toEqual(['Vos']);
    expect(after.every((one) => one.house === 0)).toBe(true);
  });
});

/**
 * And the thing the issue says it is done when: a village that buries a household and takes in a
 * family from three valleys away leaves everybody else in the house they were in last night.
 */
describe('through the register', () => {
  it('keeps every other family where it was across a burial and an arrival', () => {
    const book = new Register(7, 1);
    book.settle('Ashford', 8, ['farmer', 'seller', 'doctor']);
    for (let day = 2; day <= 40; day++) book.advance(day);
    const before = book.homesOf('Ashford', roofs(8)).map((home) => `${home.house.tx},${home.house.tz}:${home.family}`);
    const oldest = book.living('Ashford')[0];
    book.bury(oldest.id, 41);
    for (let day = 41; day <= 45; day++) book.advance(day);
    const after = new Map(book.homesOf('Ashford', roofs(8))
      .map((home) => [`${home.house.tx},${home.house.tz}`, home.family]));
    for (const line of before) {
      const [where, family] = [line.slice(0, line.lastIndexOf(':')), line.slice(line.lastIndexOf(':') + 1)];
      if (family === '') continue;
      const now = after.get(where);
      expect(now === family || now === '', `${family} was moved out of ${where} into somebody else's house`)
        .toBe(true);
    }
  });
});
