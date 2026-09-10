import type { Register } from '../world/register';
import { yearsOld } from './records';

/**
 * Who a village is descended from.
 *
 * Every part of this has been written down for as long as there has been a register and nothing has
 * ever read it. A `Person` carries `mother` and `father` — by *name* rather than by id, and
 * deliberately: "lineage is for talking about, and the dead are not kept", so a parent who died
 * forty years ago is still a name on their child's record long after there is any person to point
 * at. The churchyard keeps sixty stones. Between the two, a village's descent is already there.
 *
 * What it is *for* is the interesting part. The roll tells you who is alive, the stones tell you
 * who is dead, and neither tells you that the miner at the face and the woman keeping the inn are
 * brother and sister — which is the thing that makes a village a place with people in it rather
 * than a list of trades. A player who has watched a village for a hundred days and can then see
 * why the Halloways all live on the same street has been given something no other book here gives.
 *
 * It is the dearest thing a clerk sells, and that is not arbitrary. Every other book is one pass
 * over one list; this is the whole register cross-referenced, which is a week of somebody's work
 * in a world that writes with a quill.
 */

/** One person in the descent: alive on the roll, under a stone, or only a name on somebody's record. */
export interface Kin {
  name: string;
  /** What they did, where anybody knows. A child has none and neither does a name with no record. */
  trade: string;
  /** The day they were born, or null for somebody remembered only as a parent. */
  born: number | null;
  /** The day they died, or null for the living. */
  died: number | null;
  /** Years, at death or today. Null where nothing is known. */
  age: number | null;
  /** What they are worth, for the living only — a stone does not say and a memory certainly does not. */
  purse: number | null;
  /**
   * Which of the three this is, because the drawing has to tell them apart and so does the reader.
   *
   * `living` is on the roll. `buried` has a stone in the yard. `remembered` is a name that appears
   * as somebody's mother or father and nowhere else — the village's own great-grandparents, who
   * are past the sixty stones the church keeps. They are the reason this is worth drawing at all:
   * without them the tree is two generations deep and stops, and with them it reaches back to the
   * founding.
   */
  standing: 'living' | 'buried' | 'remembered';
  mother: string;
  father: string;
  /** How far down from the oldest ancestor this one sits. Nought is the top of the tree. */
  depth: number;
}

/** A village's descent, and what it cost to have it looked up. */
export interface Lineage {
  village: string;
  /** Everybody the register can name, oldest generation first. */
  people: Kin[];
  /** Child to parent, by name — both parents where both are known. */
  ties: Array<{ child: string; parent: string }>;
  /** The families, largest first: a surname and how many of the village carry it. */
  houses: Array<{ name: string; souls: number }>;
  /** How many generations deep the deepest line runs. */
  generations: number;
}

/**
 * Build the descent of one village.
 *
 * Names are the join, which is the whole reason this can reach past the churchyard: a person's
 * parents are recorded as names, so a mother nobody has a record of any more is still a node with
 * her children hanging off her. It is also the one weakness, and it is worth stating rather than
 * hiding — two people who genuinely shared a name would be one node here. The roll test next door
 * proves no two people *alive at once* in a village ever do, and the register avoids reusing a
 * surname within a village, so it takes a century and a coincidence. A village that manages it
 * gets one blurred ancestor, not a wrong tree.
 */
export function lineageOf(register: Register, village: string, today: number): Lineage {
  const known = new Map<string, Kin>();

  const put = (kin: Kin): void => {
    const already = known.get(kin.name);
    // a stone beats a memory and the roll beats both: somebody alive is the best record there is
    if (!already || rank(kin.standing) > rank(already.standing)) known.set(kin.name, kin);
  };

  for (const person of register.living(village)) {
    put({
      name: person.name, trade: person.trade, born: person.born, died: null,
      age: yearsOld(person.born, today), purse: person.purse, standing: 'living',
      mother: person.mother, father: person.father, depth: 0,
    });
  }
  for (const stone of register.churchyard(village)) {
    put({
      name: stone.name, trade: stone.trade, born: stone.born, died: stone.day,
      age: yearsOld(stone.born, stone.day), purse: null, standing: 'buried',
      // a stone records no parents. The dead keep their place in the tree through their children,
      // which is enough: a line of descent only needs one end of each tie
      mother: '', father: '', depth: 0,
    });
  }
  // and then everybody who is only a name on somebody else's record, which is most of the tree
  for (const kin of [...known.values()]) {
    for (const parent of [kin.mother, kin.father]) {
      if (!parent || known.has(parent)) continue;
      put({
        name: parent, trade: '', born: null, died: null, age: null, purse: null,
        standing: 'remembered', mother: '', father: '', depth: 0,
      });
    }
  }

  const ties: Array<{ child: string; parent: string }> = [];
  for (const kin of known.values()) {
    for (const parent of [kin.mother, kin.father]) {
      if (parent && known.has(parent)) ties.push({ child: kin.name, parent });
    }
  }

  settleDepths(known, ties);
  const people = [...known.values()].sort((a, b) => a.depth - b.depth || (a.born ?? -1) - (b.born ?? -1));
  return {
    village,
    people,
    ties,
    houses: housesOf(people),
    generations: people.length === 0 ? 0 : Math.max(...people.map((k) => k.depth)) + 1,
  };
}

/** Which record wins when a name turns up twice: the roll, then a stone, then a memory. */
function rank(standing: Kin['standing']): number {
  return standing === 'living' ? 2 : standing === 'buried' ? 1 : 0;
}

/**
 * How far down the tree each person sits.
 *
 * Walked from the people who have no known parents rather than computed per person, because a
 * depth is a fact about a *line* and not about a date: two cousins born ten years apart are the
 * same generation, and a late child is not a generation younger than his own brother.
 *
 * Bounded rather than recursive, and that is not caution for its own sake. The register makes
 * mothers and fathers out of whoever is grown at the time, and there is nothing in it that forbids
 * somebody being made their own great-grandparent by an unlucky roll — a cycle. A walk that
 * followed one would never come back. So this takes as many passes as there are people, which is
 * enough to settle any acyclic tree and cannot run away on a cyclic one.
 */
function settleDepths(known: Map<string, Kin>, ties: Array<{ child: string; parent: string }>): void {
  const parentsOf = new Map<string, string[]>();
  for (const tie of ties) {
    const list = parentsOf.get(tie.child);
    if (list) list.push(tie.parent);
    else parentsOf.set(tie.child, [tie.parent]);
  }
  for (let pass = 0; pass < known.size; pass++) {
    let moved = false;
    for (const kin of known.values()) {
      const parents = parentsOf.get(kin.name) ?? [];
      let deepest = 0;
      for (const parent of parents) {
        const above = known.get(parent);
        if (above) deepest = Math.max(deepest, above.depth + 1);
      }
      if (deepest > kin.depth) { kin.depth = deepest; moved = true; }
    }
    if (!moved) return;
  }
}

/** The families of a village, largest first. A surname with nobody carrying it is not a house. */
function housesOf(people: readonly Kin[]): Array<{ name: string; souls: number }> {
  const count = new Map<string, number>();
  for (const kin of people) {
    const surname = kin.name.split(' ').slice(1).join(' ');
    if (!surname) continue;
    count.set(surname, (count.get(surname) ?? 0) + 1);
  }
  return [...count.entries()]
    .map(([name, souls]) => ({ name, souls }))
    .sort((a, b) => b.souls - a.souls || a.name.localeCompare(b.name));
}
