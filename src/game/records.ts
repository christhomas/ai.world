import type { Burial, Register } from '../world/register';
import { earnedInADay, spentOnLiving } from '../world/prosperity';

/**
 * What a village writes down about itself, and what it will show you.
 *
 * The world already knew all of this. The register has kept every villager's trade, parents, purse,
 * who they know and what they remember since the day it was written; the churchyard has kept the
 * dead; the gaol has kept whoever was taken in. None of it could be looked at. A world that
 * simulates a hundred lives and shows you none of them is a world that might as well have rolled
 * dice.
 *
 * So the records are readable, in the places where records are kept: the roll at the town hall, the
 * stones at the church, the charge sheet at the watch house, the births and the ailing at the
 * apothecary's. Each keeper will tell you the gist for nothing — that is what a public record is —
 * and wants paying for the detail, which is what makes looking somebody up a decision rather than a
 * menu.
 *
 * Everything here is derived. Nothing is stored, nothing is invented, and the numbers are the ones
 * the simulation has been running on all along, which is the point: this is a window rather than a
 * story about what might be behind one.
 */

/**
 * One record: the numbers, and the words a keeper says over them.
 *
 * The numbers come first and the prose is rendered from them, rather than the other way about. That
 * is not tidiness — it is what makes the record usable by something that is not a player. A village
 * is a simulated economy, and the only way to know whether it works is to read what it actually did:
 * what people earn, what they have put by, who is starving, who is being buried and of what. A
 * sentence cannot be asserted on; a row of numbers can.
 *
 * So `rows` is for whoever is checking that the world adds up, `gist` and `detail` are what is said
 * at the counter, and both are the same facts.
 */
export interface Ledger<Row = unknown> {
  /** What the keeper calls it. */
  title: string;
  /** What anybody may hear, standing at the counter. */
  gist: string[];
  /** What the fee buys: the thing itself, a line at a time. */
  detail: string[];
  /** The same, as numbers, for anybody who would rather count than read. */
  rows: Row[];
  /** What the keeper asks for it, in gold. Nought where there is nothing worth charging for. */
  fee: number;
}

/** A villager, as the roll has them: every number the register keeps about one person. */
export interface RollRow {
  name: string;
  trade: string;
  age: number;
  born: number;
  /** What they have put by, which is the whole of the economy visible in one number. */
  purse: number;
  /** What they take in a day at their trade, and what a day of living costs them. */
  earns: number;
  spends: number;
  mother: string;
  father: string;
  knows: number;
  remembers: number;
}

/**
 * What a look at the books costs.
 *
 * Priced against a day's wages rather than against a purse: it should be an easy decision for
 * somebody established and a real one for somebody who has just arrived, which is the only way a
 * fee means anything at all.
 */
export const FEES = {
  ROLL: 12,
  STONES: 6,
  CHARGES: 15,
  BIRTHS: 8,
} as const;

/** Years, from the day somebody was born to the day being asked about. */
const DAYS_IN_A_YEAR = 40;

export function yearsOld(born: number, today: number): number {
  return Math.max(0, Math.floor((today - born) / DAYS_IN_A_YEAR));
}

/** "three", "a dozen", "nobody" — a count as a keeper would say it rather than as a number. */
function many(n: number, one: string, some: string): string {
  if (n === 0) return `no ${some}`;
  if (n === 1) return `one ${one}`;
  return `${n} ${some}`;
}

/** The most common few of something, biggest first: what a village is made of. */
function commonest(of: string[], take: number): Array<[string, number]> {
  const tally = new Map<string, number>();
  for (const one of of) if (one) tally.set(one, (tally.get(one) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, take);
}

/**
 * The roll of everybody living here: the town hall's book.
 *
 * The gist is what a clerk would say without looking anything up — how many, and what they mostly
 * do. The detail is the roll itself, and it is deliberately the whole of what the register holds
 * about a person: their trade, their age, their parents, what they have put by and who they know.
 * That is the material for poking about in a village rather than being told a summary of it.
 */
export function theRoll(register: Register, village: string, today: number, pressure = 0): Ledger<RollRow> {
  const living = register.living(village);
  const grown = living.filter((p) => p.trade);
  const trades = commonest(grown.map((p) => p.trade), 3);
  const gist = [
    `${village} has ${many(living.length, 'soul', 'souls')} on the roll, of whom ${many(living.length - grown.length, 'is a child', 'are children')}.`,
    trades.length === 0
      ? 'Nobody here has taken a trade yet.'
      : `Mostly ${trades.map(([trade, n]) => `${trade} (${n})`).join(', ')}.`,
    `The village is doing ${register.fortune(village)}.`,
  ];
  const rows: RollRow[] = [...living]
    .sort((a, b) => a.born - b.born)
    .map((person) => ({
      name: person.name,
      trade: person.trade,
      age: yearsOld(person.born, today),
      born: person.born,
      purse: Math.round(person.purse),
      // what the day does to that purse, which is the economy stated rather than inferred
      earns: earnedInADay(person, pressure),
      spends: spentOnLiving(person),
      mother: person.mother,
      father: person.father,
      knows: person.knows.length,
      remembers: person.memories.length,
    }));
  return {
    title: `The roll of ${village}`,
    gist,
    detail: rows.map(lineFor),
    rows,
    fee: living.length === 0 ? 0 : FEES.ROLL,
  };
}

/**
 * One villager, as the clerk reads them out.
 *
 * The purse is said plainly rather than hinted at. A player wants to know who in this village is
 * worth robbing; whoever is checking the economy wants to know whether anybody is earning at all,
 * and a line that said "comfortable" would serve neither.
 */
function lineFor(row: RollRow): string {
  const trade = row.trade || 'not yet of an age to work';
  const kin = row.mother || row.father
    ? ` Child of ${[row.mother, row.father].filter(Boolean).join(' and ')}.`
    : '';
  const living = row.trade ? ` Takes ${row.earns} a day, spends ${row.spends}.` : '';
  const known = row.knows > 0 ? ` Knows ${row.knows}.` : ' Keeps to themselves.';
  return `${row.name}, ${row.age}, ${trade}. ${row.purse} gold put by.${living}${kin}${known}`;
}

/**
 * The stones: who this village has buried, and of what.
 *
 * The gist counts them and says whether the place has been losing people to something with teeth,
 * because that is the thing a traveller actually wants to know before staying the night.
 */
export function theStones(register: Register, village: string, today: number): Ledger<StoneRow> {
  const buried = register.churchyard(village);
  const violent = buried.filter((b) => b.cause === 'violence').length;
  const hunger = buried.filter((b) => b.cause === 'hunger').length;
  const gist = buried.length === 0
    ? [`${village} has buried nobody. The ground here is new, or it has been kind.`]
    : [
      `${many(buried.length, 'stone', 'stones')} in the yard at ${village}.`,
      violent > 0 ? `${many(violent, 'was killed', 'were killed')}.` : 'None of them died badly.',
      hunger > 0 ? `${many(hunger, 'went hungry', 'went hungry')}, which the priest would rather you did not repeat.` : '',
    ].filter(Boolean);
  const rows: StoneRow[] = [...buried].reverse().map((one) => ({
    name: one.name,
    trade: one.trade,
    age: yearsOld(one.born, one.day),
    day: one.day,
    daysAgo: Math.max(0, Math.floor(today - one.day)),
    cause: one.cause,
  }));
  return {
    title: `The stones of ${village}`,
    gist,
    detail: rows.map(stoneFor),
    rows,
    fee: buried.length === 0 ? 0 : FEES.STONES,
  };
}

/** One of the dead, as the stones have them. */
export interface StoneRow {
  name: string;
  trade: string;
  age: number;
  day: number;
  daysAgo: number;
  cause: Burial['cause'];
}

function stoneFor(row: StoneRow): string {
  const how = row.cause === 'violence' ? 'Killed' : row.cause === 'hunger' ? 'Starved' : 'Of age';
  const trade = row.trade ? `, ${row.trade}` : '';
  return `${row.name}${trade}, ${row.age}. ${how}, ${row.daysAgo === 0 ? 'today' : `${row.daysAgo} days ago`}.`;
}

/** Somebody the watch has taken in, as the sheet has it. */
export interface Charge {
  who: string;
  village: string;
  day: number;
  hours: number;
  fine: number;
}

/**
 * The charge sheet: who the watch has taken in, and what it cost them.
 *
 * The player is on it as often as anybody, which is the point of paying to read it — a village
 * remembers being robbed, and this is where you find out how well.
 */
export function theCharges(charges: readonly Charge[], village: string, today: number, wanted: boolean): Ledger<Charge & { daysAgo: number }> {
  const here = charges.filter((c) => c.village === village);
  const sheet = [...here]
    .sort((a, b) => b.day - a.day)
    .map((c) => ({ ...c, daysAgo: Math.max(0, Math.floor(today - c.day)) }));
  const gist = [
    here.length === 0
      ? `The watch at ${village} has taken nobody in. A quiet place, or a lazy one.`
      : `${many(here.length, 'name', 'names')} on the sheet at ${village}.`,
    wanted ? 'Yours is one of them, and the sergeant is looking at you while he says so.' : '',
  ].filter(Boolean);
  return {
    title: `The charge sheet of ${village}`,
    gist,
    detail: sheet.map((c) => `${c.who} — held ${Math.round(c.hours)} hours, fined ${c.fine} gold, ${c.daysAgo === 0 ? 'today' : `${c.daysAgo} days ago`}.`),
    rows: sheet,
    fee: here.length === 0 ? 0 : FEES.CHARGES,
  };
}

/**
 * The births and the ailing: what the apothecary keeps.
 *
 * The same register read the other way round. Who was born and when is the happier half of the
 * churchyard, and a village's young are the plainest sign of whether it is going to be there in a
 * year — which is why the fee buys the ages rather than a count.
 */
export function theBirths(register: Register, village: string, today: number): Ledger<BirthRow> {
  const living = register.living(village);
  const children = living.filter((p) => !p.trade);
  const recent = [...living].sort((a, b) => b.born - a.born).slice(0, 12);
  const oldest = [...living].sort((a, b) => a.born - b.born)[0];
  const rows: BirthRow[] = recent.map((p) => ({
    name: p.name,
    born: p.born,
    age: yearsOld(p.born, today),
    mother: p.mother,
    father: p.father,
    /** What they have left to live, which is the closest thing this world has to a medical record. */
    lives: p.lives,
  }));
  const gist = [
    living.length === 0
      ? `Nobody is left at ${village} to be born or to bury.`
      : `${many(children.length, 'child', 'children')} at ${village}, out of ${living.length}.`,
    oldest ? `The oldest here is ${oldest.name}, at ${yearsOld(oldest.born, today)}.` : '',
  ].filter(Boolean);
  return {
    title: `Births and ailments at ${village}`,
    gist,
    detail: rows.map((row) => {
      const kin = row.mother || row.father ? ` to ${[row.mother, row.father].filter(Boolean).join(' and ')}` : '';
      return `${row.name}, born day ${row.born}${kin}. ${row.age === 0 ? 'An infant.' : `${row.age} years old.`}`;
    }),
    rows,
    fee: living.length === 0 ? 0 : FEES.BIRTHS,
  };
}

/** One birth, as the apothecary's book has it. */
export interface BirthRow {
  name: string;
  born: number;
  age: number;
  mother: string;
  father: string;
  lives: number;
}
