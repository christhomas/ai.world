import { describe, expect, it } from 'vitest';
import {
  ROOFS, STANDARD, biggestRoofAmong, familiesUnder, familiesWantingRoom, holdsFor, isARoof,
  oneSizeUp, roofOfWork, roofsOf, whoCouldHaveAChild, workOf,
} from './roofs';
import { householdsOf } from './homes';
import { FOOD } from './food';
import { LIFE, type Person } from './people';

/**
 * Every house in the world held four people.
 *
 * Which made a village's ceiling a number wearing a house's name: `growth.ts` could say how many a
 * place held and could not say anything about the place. What is pinned here is the honest version
 * — a roof has a size, a family is limited by the one it lives under, and a couple has children
 * when there is food in the store and room over their heads and not otherwise.
 *
 * The two that matter most are at the bottom. A village has to be able to grow into what it builds,
 * which means a roof nobody has been given yet must reach the family that needs it; and a roof
 * raised before there were sizes has to keep holding the four it always held, or every village in
 * every save quietly loses people the first time it is lived forward again.
 */

const soul = (family: string, n: number, over: Partial<Person> = {}): Person => ({
  id: `${family}${n}`, name: `Given${n} ${family}`, trade: 'farmer', born: 0, hungry: 0, ...over,
} as Person);

/** Households of the stated sizes, named in the order they appear on the roll. */
const families = (...sizes: readonly number[]): Person[] =>
  sizes.flatMap((many, at) => Array.from({ length: many }, (_, n) => soul(`Family${at}`, n)));

/** Enough in the cellar that food is never the thing being tested. */
const STOCKED = 1e6;
const TODAY = LIFE.CHILD_UNTIL + 1;

describe('the sizes a roof comes in', () => {
  it('is a couple and so many children, counted out of the number households are founded with', () => {
    expect(ROOFS.map((roof) => roof.holds)).toEqual([
      2, 2 + LIFE.CHILDREN, 2 + LIFE.CHILDREN * 2, 2 + LIFE.CHILDREN * 3,
    ]);
    // and a cottage holds the couple and nobody else, which is the whole of why a family in one
    // that wants a child has to be given more room first
    expect(ROOFS[0].holds).toBe(2);
  });

  it('is the middle one a village is laid out with, because that is what a founding family fills', () => {
    expect(STANDARD.holds).toBe(2 + LIFE.CHILDREN);
    expect(holdsFor(6, [])).toBe(6 * STANDARD.holds);
  });

  it('climbs one rung at a time and stops at the top', () => {
    expect(oneSizeUp(ROOFS[0]).id).toBe(ROOFS[1].id);
    expect(oneSizeUp(ROOFS[ROOFS.length - 1]).id).toBe(ROOFS[ROOFS.length - 1].id);
  });
});

describe('what a village has written down about its roofs', () => {
  it('tells a roof from a well, and says what size it was', () => {
    expect(isARoof(workOf(ROOFS[2]))).toBe(true);
    expect(isARoof('well')).toBe(false);
    expect(isARoof('bathhouse')).toBe(false);
    expect(roofOfWork(workOf(ROOFS[2])).id).toBe('longhouse');
  });

  it('reads a roof raised before there were sizes as the house of four it always was', () => {
    // every entry `growth.ts` wrote before tonight is a bare `house`, and a village re-lived from
    // its founding has to come out holding the people it held rather than four fewer
    expect(isARoof('house')).toBe(true);
    expect(roofOfWork('house').id).toBe(STANDARD.id);
    expect(holdsFor(2, ['house'])).toBe(3 * STANDARD.holds);
  });

  it('lists the roofs it was laid out with first, and the ones it raised after them', () => {
    const roofs = roofsOf(2, ['well', workOf(ROOFS[3])]);
    expect(roofs.map((roof) => roof.id)).toEqual(['house', 'house', 'greathouse']);
    expect(holdsFor(2, ['well', workOf(ROOFS[3])])).toBe(STANDARD.holds * 2 + ROOFS[3].holds);
  });
});

describe('who lives under which roof', () => {
  it('gives the first family on the roll the first roof, the way `homes.ts` does', () => {
    // the two files must agree or a villager is told he lives in the Vos house by one of them and
    // has nowhere to put a child by the other
    const people = families(3, 2, 1);
    const under = familiesUnder(people, roofsOf(3, []));
    expect(under.map((one) => one.name)).toEqual(householdsOf(people));
    expect(under.every((one) => one.holds === STANDARD.holds)).toBe(true);
  });

  it('hands a free roof to the first family that has run out of room under its own', () => {
    // without this a village could never grow into what it built: the roof it raised this morning
    // would belong to nobody, no family would have room, and it would stand empty for ever
    const people = families(STANDARD.holds, 1);
    const under = familiesUnder(people, roofsOf(3, []));
    expect(under[0].holds).toBe(STANDARD.holds * 2);   // full, so the spare went to them
    expect(under[1].holds).toBe(STANDARD.holds);
  });

  it('leaves a roof nobody is short of standing empty, which is what an empty house is', () => {
    const people = families(1, 1);
    const under = familiesUnder(people, roofsOf(4, []));
    expect(under.reduce((sum, one) => sum + one.holds, 0)).toBe(STANDARD.holds * 2);
  });

  it('counts everybody, however the roofs are shared out', () => {
    const people = families(4, 4, 4);
    const under = familiesUnder(people, roofsOf(3, [workOf(ROOFS[0])]));
    expect(under.reduce((sum, one) => sum + one.people.length, 0)).toBe(people.length);
  });
});

describe('when a couple has a child', () => {
  it('has one when there is room under the roof and food in the store', () => {
    const people = families(2, 2);
    expect(whoCouldHaveAChild(people, 2, [], STOCKED, TODAY).length).toBe(people.length);
  });

  it('does not when the roof is full, whatever else is true', () => {
    const people = families(STANDARD.holds, STANDARD.holds);
    expect(whoCouldHaveAChild(people, 2, [], STOCKED, TODAY)).toEqual([]);
  });

  it('does not when somebody under that roof went without last night', () => {
    // hunger as a thing a family feels rather than a thing a village checks: the hungry household
    // is out and its neighbours, who ate, are not
    const people = families(2, 2);
    people[0].hungry = 1;
    const could = whoCouldHaveAChild(people, 2, [], STOCKED, TODAY);
    expect(could.map((person) => person.id)).toEqual(['Family10', 'Family11']);
  });

  it('does not when the store is too low to feed one more', () => {
    const people = families(2, 2);
    const thin = (people.length + 1) * FOOD.KEEPS_DAYS * 0.5 - 1;
    expect(whoCouldHaveAChild(people, 2, [], thin, TODAY)).toEqual([]);
    expect(whoCouldHaveAChild(people, 2, [], thin + 1, TODAY).length).toBe(people.length);
  });

  it('offers only the grown, because a village of children does not repopulate itself', () => {
    const people = [soul('Family0', 0), soul('Family0', 1, { born: TODAY })];
    const could = whoCouldHaveAChild(people, 1, [], STOCKED, TODAY);
    expect(could.map((person) => person.id)).toEqual(['Family00']);
  });
});

describe('which families want more room', () => {
  it('is the ones with none left, and it is the other half of the same question', () => {
    const people = families(STANDARD.holds, 1);
    const wanting = familiesWantingRoom(people, 2, [], STOCKED);
    expect(wanting.map((one) => one.name)).toEqual(['Family0']);
    // and nobody who wants room is offered a child, nor the other way about
    const could = new Set(whoCouldHaveAChild(people, 2, [], STOCKED, TODAY).map((p) => p.id));
    expect(wanting[0].people.some((person) => could.has(person.id))).toBe(false);
  });

  it('is nobody at all while the village is going hungry', () => {
    const people = families(STANDARD.holds, STANDARD.holds);
    for (const person of people) person.hungry = 1;
    expect(familiesWantingRoom(people, 2, [], STOCKED)).toEqual([]);
    // nor when the store is empty, which is the gate that used to sit in front of the building
    const fed = families(STANDARD.holds, STANDARD.holds);
    expect(familiesWantingRoom(fed, 2, [], 0)).toEqual([]);
    expect(familiesWantingRoom(fed, 2, [], STOCKED).length).toBe(2);
  });

  it('names the best roof over any of them, which is what the next one is measured against', () => {
    const people = families(STANDARD.holds, ROOFS[2].holds);
    const wanting = familiesWantingRoom(people, 1, [workOf(ROOFS[2])], STOCKED);
    expect(biggestRoofAmong(wanting)?.id).toBe('longhouse');
    expect(biggestRoofAmong([])).toBeNull();
  });
});
