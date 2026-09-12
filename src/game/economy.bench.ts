import type { Post } from '../entities/entity';
import { tradesFor } from '../entities/trades';
import { Register } from '../world/register';
import { holdsFor } from '../world/roofs';
import { herdRoomFor } from '../world/stables';
import { Mines, mineIdOf, type Working } from './mines';
import { theBirths, theRoll, theStones, type RollRow, type StoneRow } from './records';

/**
 * The villages `chore test economy` lives forward, and the books it keeps of them.
 *
 * The other half of the bench. `economy.test.ts` is the audit — what the books have to add up to
 * — and this is the world those books are about: which villages are stood up, what is being done
 * to each of them, and a hundred days lived a day at a time with the ledgers read out every
 * evening. Split from the audit because they are two different jobs and neither is small: this
 * one has to be faithful to how the game runs a day, and that one must not know anything about it.
 *
 * Nothing here judges. It stands villages up, does things to them, and writes down what the
 * village wrote down.
 */

/** How long a village is lived for. A hundred days is longer than anybody in one of them lives. */
export const DAYS = 100;

/** The day every village is founded on, which is the register's own. */
export const FOUNDED = 1;

/**
 * The seeds asked about.
 *
 * Three rather than one because a village is founded from its seed and its name: how many farmers
 * it starts with, how old they are and when they die are all draws, and a bench that ran one draw
 * would be a bench about one village rather than about the arithmetic behind all of them.
 */
export const SEEDS = [1, 7, 1234];

// --- what a village is, for the purposes of a hundred days ---------------------------------

/**
 * A place, and what is being done to it.
 *
 * Every regime here is a thing the world actually does to villages: a band camps on the doorstep,
 * a mine gives out, a hamlet has four people in it, a place on a rock has no fields. None of them
 * is invented for the bench, and each one is a different shape of answer to "does the money work".
 */
interface Regime {
  village: string;
  houses: number;
  /** What the place can offer, drawn the way the register draws them: uniformly, one apiece. */
  posts: Post[];
  /** A cave on the doorstep, worked every day by whoever the village raised for it. */
  mine?: boolean;
  /** A band standing over it: which days, how hard, and how often it takes somebody. */
  band?: { from: number; until: number; pressure: number; takesEvery: number };
  /** Where the people come from, for a ruin somebody puts back on its feet. */
  settledFrom?: string;
  /**
   * A place too small to replace its own dead.
   *
   * Kept apart from the villages that are read as controls, because what happens to it is not an
   * economic failure: two people cannot have four children, so a single-household hamlet dies of
   * old age however rich it is. It is here to be watched rather than to be judged.
   */
  hamlet?: boolean;
}

/** The posts an ordinary inland village has, which is nearly all of them. */
const INLAND: Post[] = ['square', 'market', 'inn', 'shop', 'doctor', 'field', 'woods', 'gate', 'heights'];

/** And a place on a rock: boats, a market, a bed, and nothing growing anywhere near it. */
const COASTAL: Post[] = ['square', 'market', 'inn', 'shop', 'doctor', 'shore'];

export const VILLAGES: Regime[] = [
  { village: 'Ashford', houses: 6, posts: INLAND },
  { village: 'Oakcross', houses: 9, posts: INLAND },
  { village: 'Thornby', houses: 6, posts: INLAND, band: { from: 30, until: 40, pressure: 0.6, takesEvery: 3 } },
  {
    village: 'Blackmarsh', houses: 6, posts: INLAND, settledFrom: 'Oakcross',
    band: { from: 30, until: 70, pressure: 0.85, takesEvery: 2 },
  },
  { village: 'Fernreach', houses: 6, posts: INLAND, mine: true },
  { village: 'Saltcombe', houses: 5, posts: COASTAL },
  { village: 'Windle', houses: 1, posts: INLAND, hamlet: true },
];

/** The villages nothing is done to, which every other one is read against. */
export const LEFT_ALONE = VILLAGES
  .filter((v) => v.band === undefined && !v.mine && !v.hamlet)
  .map((v) => v.village);

/**
 * Which trades a place can support, asked of the same function the game asks.
 *
 * Written this way rather than with a hand-typed list because the point of several of the findings
 * below is *which trades exist at all*, and a bench that made its own up could not have found it.
 * The posts are stated and the trades follow, exactly as they do for a real village.
 */
function tradesAt(posts: Post[]): string[] {
  const here: [number, number] = [0, 0];
  const at = Object.fromEntries(posts.map((post) => [post, here])) as Partial<Record<Post, [number, number]>>;
  return tradesFor(at).map((trade) => trade.id);
}

// --- the books, as they stood at the end of each day ---------------------------------------

/**
 * One village's books on one evening.
 *
 * Rows only. The prose a clerk reads out is a rendering of these and is not audited: a sentence
 * cannot be added up, which is the reason `records.ts` puts the numbers first.
 */
export interface Books {
  day: number;
  roll: RollRow[];
  stones: StoneRow[];
  /** What the births book has, kept to cross the roll against a second record of the same people. */
  born: Array<{ name: string; born: number }>;
}

/**
 * Who somebody is, across a hundred days.
 *
 * The roll carries no id — it is a public record, and a public record names people — so identity
 * here is a name and the day they were born, which the register already guarantees is unique
 * within a village. The bench checks that guarantee rather than assuming it: two people the books
 * cannot tell apart would make every audit below quietly meaningless.
 */
export const who = (row: { name: string; born: number }): string => `${row.name} (born ${row.born})`;

/** The whole of one run: every village's books, every evening, and what its mine brought up. */
export interface Run {
  seed: number;
  books: Map<string, Books[]>;
  /** Gold the mine reported paying into a village, by the day it was paid. */
  minted: Map<string, Map<number, number>>;
  /**
   * The days a village started again, which is a day no ledger can be audited across.
   *
   * Somebody walks over from the next village along and the place is founded afresh: new people,
   * new purses, and — because names are grown from the seed — some of them with the same names as
   * the dead. A row-by-row comparison then pairs up two people who are not the same person, which
   * is worse than no comparison at all.
   */
  restarted: Map<string, Set<number>>;
  /**
   * What the hall took, per village per day.
   *
   * Read off the treasury either side of the day rather than worked out from the rate, for the same
   * reason `minted` is read off the mine: what a day did is a fact about that day, and a number
   * recomputed later from a purse that has moved on is a guess.
   */
  taxed: Map<string, Map<number, number>>;
  /** What each village was founded at, for judging whether it has held itself together. */
  founded: Map<string, number>;
  /**
   * What the *place* held each evening, as against what its people wrote down.
   *
   * The herd, the larder and the hall's purse are facts about a village rather than entries in
   * anybody's ledger, and there is no book in the game that reports them — a player sees the beasts
   * by looking at the paddock. The audit in `economy.test.ts` must not read this and does not: it
   * judges the books by the books, on purpose, so that it cannot be right by construction. It is
   * here for `sanity.test.ts`, which asks a different question — not "do the books add up" but "is
   * this still a place anybody could believe in" — and cannot ask it from a ledger of purses.
   */
  standing: Map<string, Standing[]>;
}

/** What a village held one evening, beyond what was in its people's pockets. */
export interface Standing {
  day: number;
  /** Cattle the farmers keep between them. */
  herd: number;
  /** Meals in the store. */
  food: number;
  /** What the hall holds, which is nobody's. */
  hall: number;
  /** Souls on the roll that evening, children counted. */
  souls: number;
  /**
   * How many the village had beds for that evening, which is what its roofs hold.
   *
   * It was the founding size for as long as a village could only shrink, and it is not any more:
   * a village that raises a house raises its own ceiling. Recorded beside the souls because the
   * question the sanity bench asks — is this village a believable size — became a question about
   * the two together the morning growth went in.
   */
  room: number;
  /** How many of them held a trade, which is how many of them the village lives off. */
  working: number;
  /**
   * Everything standing in the village that somebody built or was laid out with.
   *
   * Houses from the founding plus every entry in the works ledger — roofs raised since, the well,
   * the watchtower, the bath house. Recorded because "a village with more buildings than people"
   * is a question nothing could ask until buildings were counted per village, and it is the shape
   * a place takes on its way to being a ruin somebody still lives in.
   */
  buildings: number;
  /**
   * What the *land* could carry, as against what the farmers could keep.
   *
   * The herd's cap is farms times what a farm holds, and what a farm holds is its buildings —
   * `stables.ts`. The two are the same number today because nobody has built a stable yet, and
   * they will not be the moment anybody does. Asked of the land rather than of the men, because a
   * village that buries a farmer has not lost a paddock.
   */
  carries: number;
  /**
   * And the ceiling the village is actually using, against the one its roofs justify.
   *
   * Two readings of one fact, kept side by side on purpose: `room` is what the settlement believes
   * it has beds for and this is what its buildings say it has. A village whose population triples
   * without a roof going up is a village where those two have come apart, and no bound that reads
   * only one of them could ever see it.
   */
  roofed: number;
}

/**
 * Live every village forward, keeping the books each evening.
 *
 * How many days is asked for rather than fixed, because there are two questions to put to the same
 * world and they want different lengths of it. A hundred days is what an audit needs: long enough
 * that everybody who was alive at the start is dead by the end, short enough to run in a second.
 * Whether a village is still *believable* after four hundred is a different question, and
 * `sanity.test.ts` asks the same villages for four times as long.
 *
 * The order inside a day is `tidings.ts`'s order, because a bench that runs the day in a different
 * order from the game is a bench about a game nobody plays: the bands are read first and the
 * register is told what they are doing, then whoever they took is buried, then the day is lived,
 * then the mines are worked and whoever did not come up is buried too.
 *
 * The books are read *before* the day is lived rather than after. That is what makes them a
 * prediction: the wage in tonight's roll is what tomorrow will pay, and holding tomorrow's purse
 * to tonight's row is the whole of the audit.
 */
export function liveForward(seed: number, days = DAYS): Run {
  const register = new Register(seed);
  const mines = new Mines(seed, FOUNDED);
  const books = new Map<string, Books[]>();
  const minted = new Map<string, Map<number, number>>();
  const taxed = new Map<string, Map<number, number>>();
  const restarted = new Map<string, Set<number>>();
  const founded = new Map<string, number>();
  const standing = new Map<string, Standing[]>();

  register.minesAt(VILLAGES.filter((v) => v.mine).map((v) => v.village));
  const workings: Working[] = VILLAGES.filter((v) => v.mine).map((v) => ({
    village: v.village,
    mine: mineIdOf({ id: `${v.village}-cave` }),
    name: `the workings above ${v.village}`,
    x: 0, z: 0,
    heardIn: [v.village],
  }));

  for (const regime of VILLAGES) {
    if (regime.settledFrom) continue;                // a ruin is settled by its neighbour, later
    register.settle(regime.village, regime.houses, tradesAt(regime.posts));
    founded.set(regime.village, register.living(regime.village).length);
    books.set(regime.village, []);
    minted.set(regime.village, new Map());
    taxed.set(regime.village, new Map());
    restarted.set(regime.village, new Set());
    standing.set(regime.village, []);
  }
  // the one that has to exist from the start to be emptied and then put back on its feet
  for (const regime of VILLAGES.filter((r) => r.settledFrom)) {
    register.settle(regime.village, regime.houses, tradesAt(regime.posts));
    founded.set(regime.village, register.living(regime.village).length);
    books.set(regime.village, []);
    minted.set(regime.village, new Map());
    taxed.set(regime.village, new Map());
    restarted.set(regime.village, new Set());
    standing.set(regime.village, []);
  }

  for (let day = FOUNDED + 1; day <= FOUNDED + days; day++) {
    // what the bands are doing, said before the day is lived, exactly as the game says it
    for (const regime of VILLAGES) {
      const band = regime.band;
      if (band && day >= band.from && day < band.until) register.leanedOn(regime.village, band.pressure);
    }
    for (const regime of VILLAGES) {
      books.get(regime.village)!.push(shut(register, regime.village, day - 1));
      standing.get(regime.village)!.push(stood(register, regime.village, day - 1));
    }

    // and what they took, which is the register's business and happens before the day turns over
    for (const regime of VILLAGES) {
      const band = regime.band;
      if (!band || day < band.from || day >= band.until) continue;
      if ((day - band.from) % band.takesEvery !== 0) continue;
      const here = register.living(regime.village);
      if (here.length === 0) continue;
      register.bury(here[(day * 7) % here.length].id, day);
    }

    const walked = register.advance(day);

    for (const dug of mines.advance(day, workings, (village) => register.living(village))) {
      const bank = minted.get(dug.village)!;
      bank.set(dug.day, (bank.get(dug.day) ?? 0) + dug.gold);
      if (dug.lost) register.bury(dug.lost.id, dug.day);
    }

    // a ruin does not repopulate itself: somebody walks over from the next village along
    for (const regime of VILLAGES) {
      if (!regime.settledFrom) continue;
      const came = register.resettle(regime.village, regime.settledFrom, day);
      if (came.length > 0) restarted.get(regime.village)!.add(day);
    }
    /*
     * And the register does it on its own now, which the audit has to be told about.
     *
     * A day somebody walked from one village to another is a day when neither village's roll is the
     * set of people it was the evening before — so a row-by-row comparison is pairing up people who
     * are not the same people. **Both** places are marked, not only the one that gained: the village
     * that sent somebody is a village one purse lighter, and the row that left took its money with
     * it. The whole-run check in `nothing leaves the world in a pocket` is what covers the money
     * across a move, which is where a resettling belongs.
     */
    for (const change of walked) {
      if (change.kind !== 'resettled') continue;
      restarted.get(change.village)?.add(day);
      if (change.from) restarted.get(change.from)?.add(day);
    }
  }
  for (const regime of VILLAGES) {
    books.get(regime.village)!.push(shut(register, regime.village, FOUNDED + days));
    standing.get(regime.village)!.push(stood(register, regime.village, FOUNDED + days));
  }

  return { seed, books, minted, taxed, restarted, founded, standing };
}

/** The books of one village, shut for the night. */
function shut(register: Register, village: string, day: number): Books {
  return {
    day,
    roll: theRoll(register, village, day).rows,
    stones: theStones(register, village, day).rows,
    born: theBirths(register, village, day).rows.map((row) => ({ name: row.name, born: row.born })),
  };
}

/** What the place itself held that evening, read straight off the village rather than off a book. */
function stood(register: Register, village: string, day: number): Standing {
  const here = register.living(village);
  return {
    day,
    herd: register.herdOf(village),
    food: register.larderOf(village),
    hall: register.hallOf(village),
    souls: here.length,
    room: register.roomIn(village),
    working: here.filter((p) => p.trade !== '').length,
    buildings: register.livedIn(village) + register.worksOf(village).length,
    carries: herdRoomFor(
      register.worksOf(village),
      (register.madeOf(village).holdings ?? []).filter((h) => h.kind === 'farm').map((h) => h.id),
    ),
    roofed: holdsFor(register.livedIn(village), register.worksOf(village)),
  };
}

/** Every run, lived once and read by everything below. */
export const RUNS = SEEDS.map((seed) => liveForward(seed));

/** A village named the way a report has to name one, so a failure can be gone and looked at. */
export const at = (run: Run, village: string, day: number): string => `${village} (seed ${run.seed}) on day ${day}`;

/** What a village had between it that evening. */
export const worth = (books: Books): number => books.roll.reduce((sum, row) => sum + row.purse, 0);

/**
 * And what it had a head, children counted.
 *
 * The figure a second storey is measured against, because the houses of a village go up together
 * and a village is not tall because one innkeeper is rich. Children are in the divisor for the
 * same reason they are in the divisor when the village grows its dinner: a house holds a family.
 */
export const eachHead = (books: Books): number => worth(books) / Math.max(1, books.roll.length);

/**
 * What the middle working villager held that evening.
 *
 * The typical purse rather than the best one, and the number that gave A7 away: it stood at
 * exactly 6.5 for the last 87 days of a hundred, in every untroubled village on every seed.
 */
export const midPurse = (books: Books): number => {
  const working = books.roll.filter((row) => row.trade).map((row) => row.purse).sort((a, b) => a - b);
  return working.length > 0 ? working[Math.floor(working.length / 2)] : 0;
};

/** How much anything is out by, said the way money is said rather than the way a float is. */
export const coins = (n: number): string => (Math.round(n * 100) / 100).toString();
