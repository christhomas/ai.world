import { LIVELIHOOD, aDaysDinner, aDaysTrade, type Trading } from './livelihoods';
import { fillTheGaps as whoIsBorn } from './births';
import { taxedForTheHall } from './hall';
import { whatTheVillageSpends } from './growth';
import { mendThem } from './wounds';
import { raiseWhoIsDue } from './shrine';
import { payAndSweep } from './purses';
import { whatTheVillageHolds } from './holdings';
import { handOnWhatTheyHad } from './inheritance';
import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { STONES_KEPT, type Change, type Settlement } from './settlement';
import { LIFE, outOfDays, remember, stageOf, tradeTakenUp, type Person, type Sex } from './people';

/**
 * One day in one village, from the morning's work to the last funeral.
 *
 * Out of `register.ts` on the 13th, and the reason is worth writing down because the obvious cut
 * was the wrong one. The note that asked for this split proposed cutting **founding** away from
 * **living a day** — but `settle`, `foundOn` and `relive` are eighty lines between them and all
 * three of them *call* the day, because a village is always founded as it was on day one and then
 * lived forward to today. That seam runs straight through the thing it was meant to separate.
 *
 * What is genuinely separable is the other way round: the day does not need the register at all.
 * It needs a settlement to change, a handful of numbers, and somewhere to write down what the hall
 * took and what it paid. Everything else a register is — who is alive anywhere, what has been told
 * to it from other screens, which village a stranger belongs to — the day never asks about.
 *
 * So it takes `TheDay` and the register satisfies it. Six things, and the shape of them is the
 * argument: if a seventh ever has to be added, this file has started asking questions that belong
 * to the book of who is alive rather than to a Tuesday in one valley.
 */

/**
 * What a day needs from the world outside the village it is happening in.
 *
 * `today` is deliberately not the day being lived. A village re-lived from its founding lives
 * day two, then day three, while the register has already reached day four hundred — and what a
 * village may build is asked against *today* rather than against the morning being replayed.
 * That is how it has always worked, and it is written out here rather than left implicit, because
 * one `this.day` where a `day` was meant is exactly the sort of thing a move like this breaks.
 */
export interface TheDay {
seed: number;
/** The day the register has reached, which is not the day being lived. See above. */
today: number;
/** How hard something is leaning on this village this morning. */
pressureOn: (village: string, day: number) => number;
/** The day somebody was killed by something, if the world has told us about it. */
killedOn: (id: string) => number | undefined;
/** What the hall took from this person today, which the game shows on a ledger. */
taxed: (id: string, much: number) => void;
/** And what it paid them, for work the village bought. */
waged: (id: string, much: number) => void;
/** Somebody is off the register: every book that mentions them, in one place. */
takeOff: (person: Person, day: number, cause: 'age' | 'violence' | 'hunger') => Change | null;
}


/** A stream of its own for one village on one day, so villages never share rolls. */
export function streamFor(seed: number, village: string, day: number): () => number {
  let hash = 0x811c9dc5 ^ day;
  for (let i = 0; i < village.length; i++) {
    hash ^= village.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return mulberry32(derive(seed, SALT.PEOPLE) ^ (hash >>> 0));
}


export function baby(seed: number, id: string, name: string, village: string, day: number, sex: Sex): Person {
  const rng = streamFor(seed, village, day);
  return {
    id, name, village, sex,                    // told rather than rolled: this stream restarts each birth
    trade: '',                                 // a trade comes with growing up
    born: day,
    lives: Math.round(LIFE.SHORTEST_LIFE + rng() * (LIFE.LONGEST_LIFE - LIFE.SHORTEST_LIFE)),
    mother: '', father: '', knows: [], memories: [], opinions: [],
    purse: 0, hungry: 0,                                  // a baby has nothing; a trade is what starts it
  };
}


/**
 * Take somebody off the register and leave them in the memory of the people who knew them.
 * There is no book of the dead: asking a villager is how you find out somebody is gone.
 */
export function takeOffTheRegister(
  village: Settlement | undefined, person: Person, day: number, cause: 'age' | 'violence' | 'hunger',
): Change | null {
  if (!village) return null;
  const at = village.people.indexOf(person);
  if (at < 0) return null;

  village.people.splice(at, 1);
  const estate = handOnWhatTheyHad(person, village, day);
  // the parish register, written where every death already passes so it cannot disagree with
  // who is alive
  village.buried.push({
    name: person.name, trade: person.trade, born: person.born, day, cause,
    left: estate.left, to: estate.to,
  });
  if (village.buried.length > STONES_KEPT) village.buried.shift();
  for (const survivor of village.people) {
    const knew = survivor.knows.indexOf(person.id);
    if (knew < 0) continue;
    survivor.knows.splice(knew, 1);           // the id would dangle; the name in the memory will not
    remember(survivor, { what: 'died', who: person.name, day });
  }
  return { kind: 'died', id: person.id, name: person.name, village: person.village, day, cause };
}


/**
 * A day's work for everybody still working in a village, and what it did to the herd.
 *
 * Nobody earns while the place is being raided, which is the whole reason a village under
 * pressure stays poor and one left alone slowly does not: prosperity is a thing the player can
 * protect rather than a number that only goes up.
 *
 * What is settled here is everything that does not wait for dinner: what a trade brings in from
 * beyond the village, what the next valley paid for the meat, and everybody's keep going into
 * the purses of whoever sold it to them. What the village pays for its own dinner cannot be
 * settled until it has eaten, so `dinner` does that half.
 */
export function aDaysWork(o: TheDay, village: Settlement, pressure: number, day: number): Trading {
  // the village as well, because what a coast eats is a fact about the place rather than about
  // anybody in it: see `harvest.ts`, where the herd and the boats sit side by side
  const trading = aDaysTrade(village.people, village.herd, pressure, village);
  village.herd = trading.herd;
  payAndSweep(village, trading.paid);
  // and the hall's share of what is left, which is the same act as every other coin that moves
  // here: out of the purses it came from, into the one place that is not anybody's
  const tax = taxedForTheHall(village.people);
  payAndSweep(village, tax.owed);
  // the hall's share of the day, and what its own farms made: a village that owns a farm takes
  // what the farm takes, which is the whole of what owning one means. See `shareTheTake`
  village.purse = Math.round((village.purse + tax.raised + trading.toTheHall) * 100) / 100;
  for (const person of village.people) o.taxed(person.id, -(tax.owed.get(person.id) ?? 0));
  theVillageSpends(o, village, day);
  return trading;
}


/**
 * The village spends what it has raised: a roof, a wage, or something it merely wants.
 *
 * One thing a day at most and only what it can pay for outright, because a village does not
 * borrow. The money never leaves the world — it goes back to whoever holds a trade, the shape
 * every village-wide payment here takes — and that is what stops the treasury being a hole money
 * falls into, which `chore sanity` once measured at sixty-two per cent of all the coin there is.
 * The order and the reasoning are in `growth.ts` and `hall.ts`; this only applies the answer.
 */
export function theVillageSpends(o: TheDay, village: Settlement, day: number): void {
  // nought for everybody here first, and only for the people of *this* village: it cleared the
  // whole map to begin with, which quietly wiped what another village had paid out the same
  // morning. The audit caught it as twenty-six people getting nine hundred gold between them
  // with nothing in any book to explain it
  for (const person of village.people) o.waged(person.id, 0);
  // the house it needs, the wage on the tower and whatever it wants, in the order a village would
  // do them: see `whatTheVillageSpends`, where the argument about which comes first is written
  // down. A roof before a well, because a village houses its people before it pleases them
  const spending = whatTheVillageSpends(
    village.purse, village.works, village.houses, village.founded, village.people, village.food,
    village.holdings ?? [], village.herd, day);
  village.watch = spending.watch;
  // a villager founding a holding spends none of the hall's money, so what the hall spent is no
  // longer the whole test for "nothing happened here this morning"
  if (spending.spent === 0 && spending.founded.length === 0) return;
  village.purse = Math.round((village.purse - spending.spent) * 100) / 100;
  village.works.push(...spending.works);
  // a raised roof is a raised ceiling: what the village can hold is what its houses hold, and
  // this is the one line that lets a village become bigger than it was founded. See `growth.ts`
  village.founded += spending.holdsMore;
  payAndSweep(village, spending.wages);
  for (const [id, much] of spending.wages) o.waged(id, much);
  // and whatever was founded this morning, which is the one thing a village gains that it did not
  // already hold: a farm bought by a man who has earned one, or by the hall out of a good decade
  village.holdings = [...(village.holdings ?? []), ...spending.founded];
}


/**
 * What a village grew and what it ate.
 *
 * The drain the whole economy needed: gold matters because bread costs money, and prosperity
 * matters because a poor village buries people. Whoever cannot pay for what there is goes
 * without, and long enough without is what kills them.
 */
function dinner(o: TheDay, village: Settlement, day: number, work: Trading): Change[] {
  const meal = aDaysDinner(village.people, village.food, work);
  village.food = meal.food;
  // what dinner cost goes to whoever's dinner it was: the fields, the woods and the herd
  payAndSweep(village, meal.paid);
  return meal.starved
    .map((p) => o.takeOff(p, day, 'hunger'))
    .filter((c): c is Change => c !== null);
}


function buryTheOld(o: TheDay, village: Settlement, day: number): Change[] {
  const gone = village.people.filter((p) => outOfDays(p, day));
  return gone.map((p) => o.takeOff(p, day, 'age')).filter((c): c is Change => c !== null);
}


/** The ones something with teeth got to, on the day it got to them. */
function takeTheKilled(o: TheDay, village: Settlement, day: number): Change[] {
  const gone = village.people.filter((p) => o.killedOn(p.id) === day);
  return gone.map((p) => o.takeOff(p, day, 'violence')).filter((c): c is Change => c !== null);
}


/** A day of mending, and the doctor's fee for the morning he set a bone. See `wounds.ts`. */
function mendThePeople(village: Settlement): Change[] {
  payAndSweep(village, mendThem(village.people));
  return [];
}


  /** Who is born here this morning, which is a question about families. See `births.ts`. */
function fillTheGaps(o: TheDay, name: string, village: Settlement, day: number, pressure: number): Change[] {
  return whoIsBorn(
    { seed: o.seed, streamFor: (v, d) => streamFor(o.seed, v, d), baby: (...a) => baby(o.seed, ...a) },
    name, village, day, pressure);
}


/**
 * A day of growing up: children come of age and take a trade, and anybody short of company
 * meets a neighbour.
 *
 * The meeting matters more than it looks. Without it a village slowly forgets itself — somebody
 * born after their parents have died starts life knowing nobody, and never meets a soul, so
 * there is nobody to tell you about them and nobody for them to mourn.
 */
function growUp(o: TheDay, name: string, village: Settlement, day: number): Change[] {
  const rng = streamFor(o.seed, name, day);

  for (const person of village.people) {
    if (person.trade === '' && stageOf(person, day) === 'adult' && village.trades.length > 0) {
      person.trade = tradeTakenUp(person, village.trades, village, rng);
    }
    if (person.knows.length >= LIFE.KNOWS) continue;

    const strangers = village.people.filter((p) => p !== person && !person.knows.includes(p.id));
    if (strangers.length === 0) continue;
    person.knows.push(strangers[Math.floor(rng() * strangers.length)].id);
  }
  return [];                                   // growing up is nobody's news
}


/**
 * One day in one village: the old are buried, the gaps are filled, the young grow up, and
 * whatever had teeth is accounted for last.
 *
 * Killings come last because that is when they actually happen — somebody dies during a day
 * that has already been lived — and a village re-lived from its founding has to arrive at the
 * same place as the village that watched it happen. The gap is filled the following morning.
 */

export function liveADay(o: TheDay, name: string, village: Settlement, day: number): Change[] {
  // one pressing, read once, and handed to both the halves of the day it changes: what a village
  // earns and what it grows. Read twice out of a map, they could disagree with each other
  const pressure = o.pressureOn(name, day);
  const work = aDaysWork(o, village, pressure, day);
  const changes = [
    ...buryTheOld(o, village, day),
    ...dinner(o, village, day, work),
    ...fillTheGaps(o, name, village, day, pressure),
    ...growUp(o, name, village, day),
    ...takeTheKilled(o, village, day),
    ...mendThePeople(village),
    ...raiseWhoIsDue(name, village, day, streamFor(o.seed, `${name}:shrine`, day)),
  ];
  // and who holds what, re-hung after the funerals and the growing-up so that the day's dead and
  // the day's new adults are both settled before a farm changes hands. See `holdings.ts`
  village.holdings = whatTheVillageHolds(name, village, day);
  // A village losing its last soul is worth saying out loud, once. It is noticed here rather
  // than counted at the top of the day because the killing that emptied it may have happened
  // hours ago, out in the world, with nobody keeping score.
  if (village.people.length === 0 && village.emptied === undefined) {
    village.emptied = day;
    changes.push({ kind: 'lost', id: name, name, village: name, day });
  }
  return changes;
}
