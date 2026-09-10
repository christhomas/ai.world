import type { Register } from '../world/register';
import { FEES, yearsOld, type Ledger } from './records';

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
  /**
   * Who this actually is: the name and the day they were born.
   *
   * A name on its own is not a person and the difference is not theoretical. The register avoids
   * reusing a surname among the living and avoids a given name a living neighbour has, and it says
   * nothing at all about the dead — so a grandson named for his grandfather is ordinary, and
   * ordinary is what broke the first version of this file. Keyed by name, the two of them were one
   * node, the grandfather became his own grandson's descendant, and the walk that works out how
   * deep each generation sits went round the loop pushing the number up every pass: a village of
   * twenty-eight people came out **a hundred and forty-three generations deep**.
   */
  id: string;
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
  /** Child to parent, by `Kin.id` — both parents where both are known. */
  ties: Array<{ child: string; parent: string }>;
  /** The families, largest first: a surname and how many of the village carry it. */
  houses: Array<{ name: string; souls: number }>;
  /** How many generations deep the deepest line runs. */
  generations: number;
}

/**
 * Build the descent of one village.
 *
 * Names are what a parent is recorded as, which is the whole reason this can reach past the
 * churchyard: a mother nobody has a record of any more is still a node with her children hanging
 * off her. Turning those names back into *people* is this file's job and is not a formality —
 * `whoWas` below explains what happens when it is skipped, and what happened was a village of
 * twenty-eight coming out a hundred and forty-three generations deep.
 */
export function lineageOf(register: Register, village: string, today: number): Lineage {
  const known = new Map<string, Kin>();
  const put = (kin: Kin): void => { if (!known.has(kin.id)) known.set(kin.id, kin); };

  for (const person of register.living(village)) {
    put({
      id: idOf(person.name, person.born), name: person.name, trade: person.trade,
      born: person.born, died: null,
      age: yearsOld(person.born, today), purse: person.purse, standing: 'living',
      mother: person.mother, father: person.father, depth: 0,
    });
  }
  for (const stone of register.churchyard(village)) {
    put({
      id: idOf(stone.name, stone.born), name: stone.name, trade: stone.trade,
      born: stone.born, died: stone.day,
      age: yearsOld(stone.born, stone.day), purse: null, standing: 'buried',
      // a stone records no parents. The dead keep their place in the tree through their children,
      // which is enough: a line of descent only needs one end of each tie
      mother: '', father: '', depth: 0,
    });
  }
  // and then everybody who is only a name on somebody else's record, which is most of the tree
  for (const kin of [...known.values()]) {
    for (const parent of [kin.mother, kin.father]) {
      if (!parent || whoWas(known, parent, kin.born)) continue;
      put({
        id: idOf(parent, null), name: parent, trade: '', born: null, died: null,
        age: null, purse: null, standing: 'remembered', mother: '', father: '', depth: 0,
      });
    }
  }

  const ties: Array<{ child: string; parent: string }> = [];
  for (const kin of known.values()) {
    for (const parent of [kin.mother, kin.father]) {
      const was = parent ? whoWas(known, parent, kin.born) : null;
      if (was && was.id !== kin.id) ties.push({ child: kin.id, parent: was.id });
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

/** A person's key: what they were called and the day they were born, because a name is not a person. */
function idOf(name: string, born: number | null): string {
  return born === null ? `${name}@?` : `${name}@${born}`;
}

/**
 * Which of the people called this was the one alive when a child was born.
 *
 * The whole of the fix for the hundred-and-forty-three-generation village. A parent is recorded as
 * a *name*, which is the register's own decision and a reasonable one — lineage is for talking
 * about, and the dead are not kept — so turning a name back into a person is this file's job. The
 * rule is the only one that can be right: of everybody who bore that name, the parent is the one
 * who was already born when the child was and had not yet died.
 *
 * Where the child's own birthday is unknown — an ancestor remembered as somebody's mother and
 * nothing else — the oldest bearer of the name is taken, because a name reaching that far back is
 * reaching for the earliest person who held it.
 */
function whoWas(known: Map<string, Kin>, name: string, bornOn: number | null): Kin | null {
  let best: Kin | null = null;
  for (const kin of known.values()) {
    if (kin.name !== name) continue;
    if (bornOn !== null && kin.born !== null) {
      if (kin.born >= bornOn) continue;                       // not yet born when the child was
      if (kin.died !== null && kin.died < bornOn) continue;    // already dead
    }
    if (!best || (kin.born ?? Infinity) < (best.born ?? Infinity)) best = kin;
  }
  return best;
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
      const parents = parentsOf.get(kin.id) ?? [];
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

/**
 * Where each person stands when the tree is drawn.
 *
 * Kept here rather than in the panel that draws it, for the reason every layout in this game is
 * kept out of its renderer: a tree that comes out unreadable is a bug in an arrangement, and an
 * arrangement you cannot test without a canvas is one nobody tests. What the panel does with these
 * is pan, zoom and draw lines between them.
 *
 * A row per generation, and within a row the children of one couple stand together — sorted by
 * their parents' place in the row above, so lines cross as little as they can. This is not a
 * proper tree layout and does not try to be: a village is thirty people over five generations, and
 * the arrangement that reads best at that size is a family standing side by side under whoever
 * they came from.
 */
export interface Placed {
  kin: Kin;
  /** Across the row, in tree units where one is the space one person takes. */
  x: number;
  /** Down the tree: the generation, so a row is a whole number. */
  y: number;
}

export function layOut(tree: Lineage): Placed[] {
  const parentsOf = new Map<string, string[]>();
  for (const tie of tree.ties) {
    const list = parentsOf.get(tie.child);
    if (list) list.push(tie.parent); else parentsOf.set(tie.child, [tie.parent]);
  }

  const placed: Placed[] = [];
  const at = new Map<string, number>();
  for (let depth = 0; depth < tree.generations; depth++) {
    const row = tree.people.filter((k) => k.depth === depth);
    /*
     * Sorted by where their parents ended up, so a family is a family on the screen.
     *
     * Somebody with no known parents sorts by when they were born, which puts the founding
     * generation in age order and gives every generation under it something stable to hang from.
     * Without this the rows are in map order — which is to say, in the order the register happens
     * to hold them — and the lines cross so often that the shape says nothing at all.
     */
    row.sort((a, b) => anchorOf(a, parentsOf, at) - anchorOf(b, parentsOf, at)
      || (a.born ?? 0) - (b.born ?? 0)
      || a.name.localeCompare(b.name));
    row.forEach((kin, n) => {
      at.set(kin.id, n);
      placed.push({ kin, x: n, y: depth });
    });
  }
  return centred(placed);
}

/** Where in the row above somebody's parents stand, averaged. Nought for the top of the tree. */
function anchorOf(kin: Kin, parentsOf: Map<string, string[]>, at: Map<string, number>): number {
  const parents = (parentsOf.get(kin.id) ?? []).map((id) => at.get(id)).filter((n): n is number => n !== undefined);
  if (parents.length === 0) return -1;
  return parents.reduce((sum, n) => sum + n, 0) / parents.length;
}

/**
 * Slide every row so the tree hangs about a middle line rather than down its left edge.
 *
 * A generation of three under a generation of twenty would otherwise sit hard against one side
 * with twenty tiles of nothing beside it, and the eye reads that as the tree being cut off.
 */
function centred(placed: readonly Placed[]): Placed[] {
  const widest = Math.max(1, ...placed.map((p) => p.x + 1));
  const rows = new Map<number, number>();
  for (const p of placed) rows.set(p.y, Math.max(rows.get(p.y) ?? 0, p.x + 1));
  return placed.map((p) => ({ ...p, x: p.x + (widest - (rows.get(p.y) ?? 1)) / 2 }));
}

/**
 * The descent as a book at a counter, so it can be offered beside the roll.
 *
 * The gist is what anybody may hear standing in a town hall, and it is deliberately the part a
 * villager would tell you for nothing: how many names the clerk has and which families they belong
 * to. What the fee buys is not more sentences — it is the drawing, which is why `detail` here is
 * one line rather than thirty. A family is a shape and a shape read aloud is not a shape.
 */
export function theLineage(register: Register, village: string, today: number): Ledger<Kin> {
  const tree = lineageOf(register, village, today);
  const houses = tree.houses.slice(0, 3).map((h) => `${h.name} (${h.souls})`).join(', ');
  const gist = tree.people.length === 0
    ? [`Nobody has kept a record at ${village}. The clerk has an empty book and is not proud of it.`]
    : [
      `The clerk keeps ${tree.people.length} names at ${village}, over ${tree.generations} generations.`,
      houses ? `Mostly ${houses}.` : '',
      'He can lay the whole descent out on the table, if you have the afternoon.',
    ].filter(Boolean);
  return {
    title: `The descent of ${village}`,
    gist,
    // one line, because the thing bought is a drawing rather than a reading. `enquiry.ts` needs a
    // non-empty detail to know there is anything worth charging for
    detail: tree.people.length === 0 ? [] : ['He unrolls it across the table.'],
    rows: tree.people,
    fee: tree.people.length === 0 ? 0 : FEES.LINEAGE,
  };
}
