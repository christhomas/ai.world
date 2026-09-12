import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { familyAt, homesOf, householdsOf, nameOfHome } from './homes';
import { surnameOf } from './people';
import type { Structure } from './structures';

/**
 * Whose house is this.
 *
 * A house you walked into belonged to nobody: a room grown from a building's position with
 * somebody standing in it because the room needed one. Ownership is the piece every other part of
 * a village economy is waiting on — a holding that outlives its holder, a household that has
 * somewhere to live, a house that can be built *for* somebody.
 *
 * Nothing is written down. The houses come out of the seed in a fixed order, the households come
 * off the register in the order they were founded, and the first household lives in the first
 * house — so two people who have never spoken walk into the same cottage and are told the same
 * family lives there, because the arithmetic says so rather than because anybody agreed.
 */

const houseAt = (tx: number, tz: number): Structure => ({ tx, tz } as Structure);
const row = (many: number): Structure[] =>
  Array.from({ length: many }, (_, n) => houseAt(n * 4, 0));

/** A village of real people, so the households are the ones the game would actually raise. */
function village(seed = 4, houses = 9) {
  const register = new Register(seed, 30);
  register.settle('Testing', houses, ['farmer', 'hunter', 'seller']);
  return { register, people: register.living('Testing') };
}

describe('the households of a village', () => {
  it('are the family names, in the order they first appear on the roll', () => {
    const { people } = village();
    const families = householdsOf(people);
    expect(families.length, 'a village with no families in it').toBeGreaterThan(1);
    expect(new Set(families).size, 'the same family counted twice').toBe(families.length);
    expect(families[0]).toBe(surnameOf(people[0]));
  });

  it('skip anybody with no family name at all', () => {
    expect(householdsOf([{ name: 'Nobody' }, { name: 'Greta Vos' }] as never)).toEqual(['Vos']);
  });
});

describe('who lives where', () => {
  it('puts the first household in the first house', () => {
    const { people } = village();
    const families = householdsOf(people);
    const homes = homesOf(row(families.length), people);
    expect(homes.map((h) => h.family)).toEqual(families);
    expect(homes.every((h) => !h.free)).toBe(true);
  });

  it('leaves the houses nobody has taken standing empty', () => {
    /*
     * The ordinary case rather than an edge one: a village is laid out for the size it could be and
     * lived in by the size it is. What is left over is a free house — nobody's, standing, with a
     * roof — which is somewhere a traveller can sleep and somewhere a villager caught by the dark
     * can shelter.
     */
    const { people } = village();
    const families = householdsOf(people);
    const homes = homesOf(row(families.length + 3), people);
    expect(homes.filter((h) => h.free).length).toBe(3);
    for (const free of homes.filter((h) => h.free)) expect(free.family).toBe('');
  });

  it('does not invent a house for a household there is no room for', () => {
    // they are living somewhere this does not model — with family, over a shop, behind the forge —
    // which is a better answer than a house that is standing nowhere
    const { people } = village();
    const homes = homesOf(row(2), people);
    expect(homes.length).toBe(2);
    expect(homes.every((h) => !h.free)).toBe(true);
  });

  it('says the same thing twice running, which is the whole point of deriving it', () => {
    const first = homesOf(row(6), village(11).people).map((h) => h.family);
    const again = homesOf(row(6), village(11).people).map((h) => h.family);
    expect(again).toEqual(first);
  });

  it('answers by where the house is standing, which is how a door asks', () => {
    const { people } = village();
    const houses = row(4);
    const homes = homesOf(houses, people);
    expect(familyAt(homes, houses[1].tx, houses[1].tz)).toBe(homes[1].family);
    expect(familyAt(homes, 999, 999), 'a building that is not one of these houses').toBe('');
  });
});

describe('what to call it when you are standing in it', () => {
  it('names the family when there is one', () => {
    expect(nameOfHome('Vos')).toBe('The Vos house');
  });

  it('and says plainly when there is not', () => {
    expect(nameOfHome('')).toBe('An empty house');
  });
});
