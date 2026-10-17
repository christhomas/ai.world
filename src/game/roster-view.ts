import { ageOf, stageOf, type Person } from '../world/people';
import type { Register } from '../world/register';

/** What the roster can be sorted by. */
export type RosterOrder = 'village' | 'name' | 'age' | 'purse' | 'hunger';

/** The orders in the order they are offered. */
export const ROSTER_ORDERS: readonly RosterOrder[] = ['village', 'name', 'age', 'purse', 'hunger'];

const HUNGRY_ENOUGH_TO_SAY = 1;

/** The little of a crowd the roster needs: whoever is standing about, and what each of them is doing. */
export interface Watching {
  within(x: number, z: number, r: number): ReadonlyArray<{ person: string; doing: string }>;
}

/** How far the roster looks for somebody to say what they are doing. See `doingNear`. */
const REACH = 200;

/**
 * What anybody the world has a body for is presently up to, by their row on the register.
 *
 * `REACH` is generous: the roster is a book rather than a view, so looking further only turns blanks
 * into sentences, and it is bounded by what the world has actually sent rather than by the number.
 * Empty for most of a village: seven of thirty are out and the rest are a row in a book with nobody
 * standing anywhere.
 */
export function doingNear(crowd: Watching | undefined, here: { x: number; z: number } | undefined): Map<string, string> {
  const doing = new Map<string, string>();
  if (!crowd || !here) return doing;
  for (const e of crowd.within(here.x, here.z, REACH)) {
    if (e.person !== '' && e.doing !== '') doing.set(e.person, e.doing);
  }
  return doing;
}

/** Everybody on the register, as the roster reads them out. */
export interface RosterView {
  day: number;
  by: RosterOrder;
  alive: number;
  villages: number;
  purse: number;
  hungry: number;
  /** Villages nobody has been to yet, so nobody is on the register for them. */
  unvisited: number;
  people: Array<{
    id: string; name: string; village: string;
    /** The trade, or the stage of life for somebody with none, or `—` for an adult without one. */
    trade: string;
    age: number;
    /** An elder: the one stage a trade hides. Item #245. */
    old: boolean;
    purse: number;
    /** Days without food; nought is fed. */
    hungry: number;
    /** What somebody the world has a body for is up to; blank for everybody else. */
    doing: string;
    /** Their parents by first name, or `—`. */
    parents: string;
  }>;
}

/** A parent, as a name people would say rather than as a record. */
function firstOf(name: string): string {
  return name ? name.split(' ')[0] : '—';
}

/**
 * How the list is ordered, given what is being asked about.
 *
 * Descending for the two that are questions — who has the most, who has gone longest without —
 * and ascending for the three that are labels, because a list of names you are looking somebody up
 * in wants to be in the order you would look them up.
 */
export function orderBy(by: RosterOrder, day: number): (a: Person, b: Person) => number {
  switch (by) {
    case 'name': return (a, b) => a.name.localeCompare(b.name);
    case 'age': return (a, b) => ageOf(b, day) - ageOf(a, day);
    case 'purse': return (a, b) => b.purse - a.purse;
    case 'hunger': return (a, b) => b.hungry - a.hungry || b.purse - a.purse;
    case 'village': return (a, b) => a.village.localeCompare(b.village) || a.name.localeCompare(b.name);
  }
}

/**
 * The roster, read live off the register (#575): the page's roster draws these rows and an
 * installed app's roster page shows the same, so neither keeps a copy of anybody to fall out of
 * step. `known` is how many villages the world has; the ones nobody has visited have nobody on the
 * register yet, and the roster says so rather than founding them to fill the table.
 */
export function rosterView(register: Register, by: RosterOrder, known: number, doing: ReadonlyMap<string, string>): RosterView {
  const day = register.today;
  const folk = [...register.everybody()].sort(orderBy(by, day));
  const villages = new Set(folk.map((p) => p.village)).size;
  return {
    day, by, alive: folk.length, villages,
    purse: folk.reduce((sum, p) => sum + p.purse, 0),
    hungry: folk.filter((p) => p.hungry >= HUNGRY_ENOUGH_TO_SAY).length,
    unvisited: Math.max(0, known - villages),
    people: folk.map((p) => {
      const stage = stageOf(p, day);
      return {
        id: p.id, name: p.name, village: p.village,
        trade: p.trade || (stage === 'adult' ? '—' : stage),
        age: ageOf(p, day), old: stage === 'elder', purse: p.purse, hungry: p.hungry,
        doing: doing.get(p.id) ?? '',
        parents: p.mother || p.father ? `${firstOf(p.mother)} & ${firstOf(p.father)}` : '—',
      };
    }),
  };
}
