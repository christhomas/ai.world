import { PROSPER } from './prosperity';
import {
  LIFE, familyName, firstNameOf, givenName, parentsFrom, remember, sexAtBirth, surnameOf,
  type Person,
} from './people';
import { whoCouldHaveAChild } from './roofs';
import type { Change, Settlement } from './settlement';

/**
 * Who is born in a village this morning, and who is not.
 *
 * Out of `register.ts` because it is the one part of a day that is about *families* rather than
 * about a village: which two people, under whose roof, with food in which store, and what the child
 * is called. The register keeps the book; this decides what goes in it.
 *
 * The size cap forced the cut and the cut is the right one anyway — this was the largest thing in
 * that file by some way, and every other morning's business (the dinner, the taxes, the building,
 * the funerals) is about the place while this is about two people in a house.
 */

/** At most this share of a village's room can be born in one day. */
export const BIRTH_RATE = 0.06;

/** What a birth needs from the register: its seed, its streams, and how a newborn is made. */
export interface Births {
  seed: number;
  /** A stream of a village's own for one day, so villages never share rolls. */
  streamFor: (village: string, day: number) => () => number;
  /** A newborn with nothing in their pockets and no trade, which is the register's own shape. */
  baby: (id: string, name: string, village: string, day: number, sex: ReturnType<typeof sexAtBirth>) => Person;
}

/** A village replaces what it has lost, at a pace: a hard winter means a run of births. */
export function fillTheGaps(o: Births, name: string, village: Settlement, day: number, pressure: number): Change[] {
  const missing = village.founded - village.people.length;
  if (missing <= 0) return [];
  /*
   * No births while it is being raided, and births again the moment it is not.
   *
   * This used to test how far the village had fallen: below a line, none ever again — so a place
   * stayed barren after the thing killing it was dealt with, and every troubled village drained
   * away. Seed 1's Crossroads Town: thirty people, seven by day sixty, none by day one hundred
   * and twenty. Pressure is the honest test, and it makes a rescue worth making up to the last
   * family.
   */
  if (pressure > PROSPER.UNTROUBLED) return [];
  // and a place with nobody left in it is a ruin rather than a village: somebody has to be there
  // for anybody to be born
  if (village.people.length === 0) return [];

  const rng = o.streamFor(name, day);
  const wanted = Math.min(missing, Math.max(1, Math.round(village.founded * BIRTH_RATE)));
  const changes: Change[] = [];

  for (let n = 0; n < wanted; n++) {
    // room under their own roof and food in the store, which is what limits a family now that a
    // roof has a size. Asked inside the loop, so each birth sees the bed the last one took
    const parents = whoCouldHaveAChild(village.people, village.houses, village.works, village.food, day);
    if (parents.length < 2) break;            // a village of children does not repopulate itself

    const [mother, father] = parentsFrom(parents, rng);
    const id = `${name.replace(/[^A-Za-z]/g, '')}-${day}-${n}`;
    const sex = sexAtBirth(o.seed, id);     // off their id, so a birth costs this stream nothing
    // a child takes their mother's family name, so a village keeps its families legible
    const surname = surnameOf(mother) || familyName(rng);
    const household = village.people.filter((p) => surnameOf(p) === surname).map(firstNameOf);
    const child = o.baby(id, `${givenName(rng, household, sex)} ${surname}`, name, day, sex);
    child.mother = mother.name;
    child.father = father !== mother ? father.name : '';
    child.lives = Math.round(LIFE.SHORTEST_LIFE + rng() * (LIFE.LONGEST_LIFE - LIFE.SHORTEST_LIFE));
    child.knows = [mother.id, father.id].filter((known, at, all) => all.indexOf(known) === at);
    village.people.push(child);

    for (const parent of [mother, father]) {
      remember(parent, { what: 'born', who: child.name, day: day });
    }
    changes.push({ kind: 'born', id: child.id, name: child.name, village: name, day: day });
  }
  return changes;
}
