import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';

/**
 * Who lives in a village, and what they are to one another.
 *
 * The founding families are grown from the seed, so two people in one world meet the same
 * villagers without a byte crossing between them — the same trick the terrain uses. What happens
 * afterwards is not derivable: somebody is born, somebody is taken by a wolf. Those go on the
 * world's log of changes, beside the opened chests and the sown fields.
 *
 * There is no register of the dead. When somebody dies they leave this list, and what remains of
 * them is a memory carried by the people who knew them — which is how you find out, by asking.
 * That is why a memory holds a *name* and not an id: a name still means something after the
 * person it belonged to is gone, and can never dangle.
 *
 * Relationships point one way for the same reason. A person knows five people by id; who knows
 * *them* is a question you ask the village, not a second list to keep in step.
 */

export const LIFE = {
  /** Days before a baby is a child, and a child an adult. */
  BABY_UNTIL: 8,
  CHILD_UNTIL: 16,
  /** A natural life, in days. Long enough to outlive somebody you knew, short enough to notice. */
  SHORTEST_LIFE: 60,
  LONGEST_LIFE: 90,
  /** Nobody keeps more than this many people in mind. */
  KNOWS: 5,
  /** Nor more than this many things that happened to them. */
  REMEMBERS: 2,
  /** Children per household at founding, at most. */
  CHILDREN: 2,
} as const;

export type Stage = 'baby' | 'child' | 'adult';

/** Something that happened, worth carrying about. Named, so it outlives whoever it is about. */
export interface Memory {
  what: 'died' | 'born' | 'saved' | 'robbed' | 'given';
  /** The name of the person it happened to. */
  who: string;
  day: number;
}

export interface Person {
  id: string;
  name: string;
  village: string;
  /** Empty until they are grown; a trade comes with adulthood. */
  trade: string;
  /** The world day they were born. Everything about their age follows from it. */
  born: number;
  /** How many days they have, barring wolves. */
  lives: number;
  /** Parents by name rather than id: lineage is for talking about, and the dead are not kept. */
  mother: string;
  father: string;
  /** Up to five living people they know, by id. Pruned when one of them dies. */
  knows: string[];
  /** The last couple of things that happened around them, newest first. */
  memories: Memory[];
  /**
   * What they have put by, from trading in the same economy the player uses.
   *
   * On the person rather than on the entity standing in the street, because the entity is gone
   * the moment you walk away and the village was never a penny richer for anything that happened
   * in it. What this buys is a storey on their house, and after that what a village builds when
   * it has more than it needs.
   */
  purse: number;
  /**
   * Days running without a meal. Nought for anybody who ate today.
   *
   * Somebody goes without either because the village has no food or because they could not pay
   * for what there was, which is what makes a purse the difference between eating and not.
   */
  hungry: number;
}

/** Which part of a life somebody is in, on a given day. */
export function stageOf(person: Person, day: number): Stage {
  const age = ageOf(person, day);
  if (age < LIFE.BABY_UNTIL) return 'baby';
  if (age < LIFE.CHILD_UNTIL) return 'child';
  return 'adult';
}

/** How old, in days. */
export function ageOf(person: Person, day: number): number {
  return Math.max(0, day - person.born);
}

/** Whether a natural life has run out. Wolves are not this function's business. */
export function outOfDays(person: Person, day: number): boolean {
  return ageOf(person, day) >= person.lives;
}

/** Add a memory, keeping only the last couple. The newest is first. */
export function remember(person: Person, memory: Memory): void {
  person.memories.unshift(memory);
  person.memories.length = Math.min(person.memories.length, LIFE.REMEMBERS);
}

/**
 * The families a village is founded with, grown from the world seed and the village's name.
 *
 * They are not all born on day one. Ages are spread across a life so a village starts with
 * children, parents and the old in it, rather than a cohort who all die in the same week.
 */
export function foundVillage(seed: number, village: string, houses: number, trades: string[]): Person[] {
  const rng = mulberry32(derive(seed, SALT.PEOPLE) ^ hashName(village));
  const people: Person[] = [];
  const lifeOf = (): number =>
    Math.round(LIFE.SHORTEST_LIFE + rng() * (LIFE.LONGEST_LIFE - LIFE.SHORTEST_LIFE));

  const families: string[] = [];
  for (let house = 0; house < Math.max(1, houses); house++) {
    const family = familyName(rng, families);
    families.push(family);
    const household: string[] = [];
    const under = (person: Person): Person => { household.push(firstNameOf(person)); return person; };

    // a couple, somewhere in the middle of their lives
    const mother = under(born(rng, people.length, village, trades, -Math.round(20 + rng() * 30), lifeOf(), family, household));
    const father = under(born(rng, people.length + 1, village, trades, -Math.round(20 + rng() * 30), lifeOf(), family, household));
    people.push(mother, father);

    for (let n = 0; n < Math.floor(rng() * (LIFE.CHILDREN + 1)); n++) {
      const child = under(born(rng, people.length, village, trades, -Math.round(rng() * LIFE.CHILD_UNTIL), lifeOf(), family, household));
      child.mother = mother.name;
      child.father = father.name;
      child.trade = '';                        // a trade comes with growing up
      people.push(child);
    }
  }

  // and everybody knows a handful of their neighbours
  for (const one of people) {
    const others = people.filter((p) => p !== one && p.name !== one.mother && p.name !== one.father);
    for (let n = 0; n < LIFE.KNOWS && others.length > 0; n++) {
      one.knows.push(others.splice(Math.floor(rng() * others.length), 1)[0].id);
    }
  }
  return people;
}

function born(
  rng: () => number, index: number, village: string, trades: string[], bornOn: number, lives: number,
  family: string, household: string[] = [],
): Person {
  return {
    id: `${village.replace(/[^A-Za-z]/g, '')}-${index}`,
    name: `${givenName(rng, household)} ${family}`,
    village,
    trade: trades.length > 0 ? trades[Math.floor(rng() * trades.length)] : '',
    born: bornOn,                              // negative: they were already here on day one
    lives,
    mother: '',
    father: '',
    knows: [],
    memories: [],
    purse: 0,
    hungry: 0,
  };
}

/**
 * Names are a given name and a family name, and a household shares the family name — which is
 * what makes "Greta Vos died" mean something to you when you have already met Piet Vos.
 *
 * The given names are the ones villagers have always had in this game; the family names exist so
 * that a world of hundreds does not run out and start repeating.
 */
const GIVEN = [
  'Ella', 'Tomas', 'Greta', 'Piet', 'Anouk', 'Rolf', 'Maren', 'Jory', 'Hild', 'Oskar',
  'Bram', 'Neel', 'Saskia', 'Joost', 'Lieve', 'Wim', 'Fenna', 'Dirk', 'Roos', 'Kees',
];
const FAMILY = [
  'Vos', 'Bakker', 'Mulder', 'Smit', 'Rietveld', 'Haan', 'Bos', 'Kroon',
  'Waal', 'Linden', 'Meer', 'Dijk', 'Veld', 'Stroom', 'Berg', 'Hout',
  'Kamp', 'Hoorn', 'Reijn', 'Doorn', 'Elzen', 'Grave', 'Nagel', 'Ruiter',
];

/**
 * A given name, avoiding any already in use under the same roof — otherwise a village turns up
 * couples called Jory Haan and Jory Haan, and a memory about one is a memory about both.
 */
export function givenName(rng: () => number, taken: readonly string[] = []): string {
  const free = GIVEN.filter((name) => !taken.includes(name));
  const pool = free.length > 0 ? free : GIVEN;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * A family name, avoiding the ones already in the village. Two households sharing a surname is
 * how you end up with two different people called Lieve Smit, and a village where being told
 * about one of them tells you nothing.
 */
export function familyName(rng: () => number, taken: readonly string[] = []): string {
  const free = FAMILY.filter((name) => !taken.includes(name));
  const pool = free.length > 0 ? free : FAMILY;
  return pool[Math.floor(rng() * pool.length)];
}

/** The given half of somebody's name. */
export function firstNameOf(person: Person): string {
  return person.name.split(' ')[0];
}

/** The family half, which is what a household shares. */
export function surnameOf(person: Person): string {
  return person.name.split(' ').slice(1).join(' ');
}

/** A stable number for a name, so a village founds the same families every time. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
