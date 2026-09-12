import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FOOD, cellarCap } from '../world/food';
import { GROWTH } from '../world/growth';
import { ROOFS, STANDARD } from '../world/roofs';
import { tradesFor } from '../entities/trades';
import { PROSPER } from '../world/prosperity';
import { LEFT_ALONE, SEEDS, VILLAGES, eachHead, liveForward, type Run, type Standing } from './economy.bench';
import type { Post } from '../entities/entity';

/**
 * Four hundred and fifty days, and whether the world is still one anybody would believe in.
 *
 * `chore economy` proves that every coin came from somewhere and went somewhere, and it would say
 * nothing at all about a valley full of cow sheds, because every shed was paid for honestly. It is
 * an audit: it holds the books to the purses and has no opinion about what the books *say*. A
 * village can lose every farmer it has, let its herd die, hold two trades between sixteen people
 * and bank sixty per cent of the world's money in a building nobody can spend from, and the audit
 * will pass it, to the coin, every evening.
 *
 * So this is the other kind of test. It runs the same villages four and a half times as long and
 * asks questions a person would ask on walking into the place: are there still people here, do
 * they still do more than two things between them, are there beasts in the field, is there food in
 * the store, and does one man own everything. Nothing here adds anything up. Every number it looks
 * at is a fact about the simulation rather than an entry in a ledger, which is exactly what the
 * audit is forbidden to read.
 *
 * ## Why four hundred and fifty
 *
 * A natural life is sixty to ninety days. A hundred days is one generation and a bit: long enough
 * for everybody who was there at the start to be dead, and short enough that whatever they started
 * with is still lying about. Four hundred and fifty is five or six generations — long enough for
 * drift to show, and drift is what kills a simulated economy. Nothing crashes; it just quietly
 * stops being a place. Half a village's trades vanish one funeral at a time, the herd dies with the
 * last farmer, and the money ends up somewhere it cannot leave.
 *
 * ## What it is a guard rail for
 *
 * Everything in the economy section of the work list that makes a village *grow*: houses that can
 * be built, households that have children, farms that can be improved, halls that can spend. Each
 * one is a new way for a number to run away with itself, and none of them can be judged by an
 * audit. The rule this bench exists to hold is the one thing the whole design rests on: **the world
 * starts established and the economy's job is to keep it that way.** A model that cannot hold what
 * it was handed has failed before any question about expansion is worth asking.
 */

/** Where the run leaves its account of itself. Printed by `chore sanity`. */
const REPORT = 'sanity-report.txt';

/** One line of the account: a verdict, how many cases earned it, and what they were. */
interface Line {
  verdict: 'PASS' | 'FAIL' | 'NOTE';
  count: number;
  what: string;
  detail?: string[];
}

const covered: Line[] = [];
/*
 * The same finding twice is one finding. A failing test is retried once, so a bench that reported
 * on the way past would print every failure twice and count it twice — which is the sort of thing
 * that makes a report nobody trusts.
 */
const report = (line: Line): void => {
  const already = covered.findIndex((seen) => seen.what === line.what);
  if (already >= 0) covered[already] = line; else covered.push(line);
};

/**
 * How long a world is run for.
 *
 * Five or six generations. Long enough that nobody alive at the end has met anybody who was alive
 * at the start, which is the point at which drift has had room to do whatever it is going to do.
 */
const DAYS = 450;



/**
 * How empty a village may stand before it is a finding, as a share of the beds it has built.
 *
 * One end of what used to be a pair. The other was a ceiling on growth, and it retired the morning
 * a village could raise its own roof: a place at twice its founding size has not drifted, it has
 * grown, and the ceiling that matters now is the honest one — a village never holds more people
 * than it has beds for, which the bench checks directly rather than as a multiple of anything.
 *
 * This end still matters, and for the reason it always did. A village at half the room it has built
 * is emptying out slowly, without a raid or a famine to explain it, which is precisely the failure
 * an audit of the books would never show.
 */
const THIN = 0.5;

/**
 * How many of the trades a place could support it must still hold.
 *
 * Half, which is a low bar deliberately: a village of a dozen people cannot hold nine trades at
 * once and is not expected to. What this catches is the collapse — sixteen people, eleven of them
 * working, and two trades between them. A village like that has no farmer, so nothing grows; no
 * seller, so nothing is bought; and the fact that every purse in it still balances to the coin is
 * exactly why the audit cannot be the only thing watching.
 */
const KEEPS_TRADES = 0.5;

/**
 * How much of a village one purse may hold before it is worth saying out loud.
 *
 * Not a fault on its own — somebody has to be the richest — but a village where one man holds
 * three fifths of everything is a village with no middle, and it is the shape an economy takes
 * just before it stops moving.
 */
const ONE_MAN = 0.5;

/**
 * And how much of the world's money may sit in the halls.
 *
 * The hall's purse is the one place a coin can go and not come back: a villager's purse is spent
 * on dinner and handed to their family when they die, and the treasury is spent on nothing at all
 * until somebody builds the thing that spends it. A third is generous for a tax nobody has voted
 * to use yet.
 */
const IN_THE_HALLS = 0.34;

/**
 * How long a store may sit above what its cellars hold.
 *
 * Two days. The store is trimmed at dinner, so a village that buries somebody after dinner is over
 * its new, smaller cellar until the next one — one evening, or two across a resettling. Longer than
 * that is food that never spoils.
 */
const SPOILS_BY = 2;

/**
 * And how long a herd may stay above what its farmers could keep.
 *
 * Five weeks. A herd over its cap comes down by a calving a day and calves nothing back, which
 * works off three farmers' worth of beasts in about four — so this is that number with a week in
 * hand. It was a hundred and ninety days when this bench was written, because an over-full paddock
 * used to calve while it was being sold down and the two all but cancelled.
 */
const WORKED_OFF_BY = 35;

/** The posts each village was stood up with, which is what says what it could ever support. */
const POSTS = new Map<string, Post[]>(VILLAGES.map((v) => [v.village, v.posts]));

/** What a place could support, asked of the same function the game asks. */
function couldSupport(village: string): string[] {
  const here: [number, number] = [0, 0];
  const posts = POSTS.get(village) ?? [];
  const at = Object.fromEntries(posts.map((post) => [post, here])) as Partial<Record<Post, [number, number]>>;
  return tradesFor(at).map((trade) => trade.id);
}

/** Every run, lived once and read by everything below. */
const RUNS: Run[] = SEEDS.map((seed) => liveForward(seed, DAYS));

/** A village named the way a report has to name one, so a finding can be gone and looked at. */
const at = (run: Run, village: string): string => `${village} (seed ${run.seed})`;

/** The last evening of a village's life as this run saw it. */
const lastStanding = (run: Run, village: string): Standing => {
  const nights = run.standing.get(village)!;
  return nights[nights.length - 1];
};

/** What everybody in a village held between them on its last evening. */
function worthOf(run: Run, village: string): number {
  const books = run.books.get(village)!;
  return books[books.length - 1].roll.reduce((sum, row) => sum + row.purse, 0);
}

/** The trades actually held in a village on its last evening. */
function heldIn(run: Run, village: string): string[] {
  const books = run.books.get(village)!;
  const rows = books[books.length - 1].roll;
  return [...new Set(rows.filter((row) => row.trade).map((row) => row.trade))];
}

/** How much anything is out by, said the way money is said rather than the way a float is. */
const coins = (n: number): string => (Math.round(n * 100) / 100).toString();

/** A share, said as a percentage, because that is how a person reads one. */
const share = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;

/**
 * The villages judged.
 *
 * The hamlet is left out of every judgement and watched instead: two people cannot have four
 * children, so a single-household hamlet dies of old age however well the economy works, and
 * failing it for that would be failing the arithmetic of families rather than the economy.
 * The raided and the mining villages are judged, because what is being asked here is whether a
 * village *recovers*, and four hundred days is long enough that a band which left on day seventy
 * is ancient history.
 */
const JUDGED = VILLAGES.filter((v) => !v.hamlet).map((v) => v.village);

// --- is it still there ----------------------------------------------------------------------

describe('a world left to itself for four hundred and fifty days', () => {
  it('still has all the villages it started with', () => {
    /*
     * The first question and the only one that is not a matter of degree. The world is *placed*
     * established — villages of the size they would have reached, with a store, a herd and a
     * spread of ages — and the economy is never asked to create one of those, only to keep it.
     */
    const gone: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        if (lastStanding(run, village).souls === 0) gone.push(at(run, village));
      }
    }
    report({
      verdict: gone.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * JUDGED.length,
      what: 'villages lived from founding to day 450, and whether anybody is still in them',
      detail: gone.length === 0
        ? ['every one of them still standing, and none of them emptied on the way']
        : gone.map((name) => `${name} is empty`),
    });
    expect(gone, 'a village emptied itself over four hundred days with nothing done to it').toEqual([]);
  });

  it('holds its population to the beds it has, and fills most of them', () => {
    /*
     * This asked whether a village had stayed near the size it was founded at, which was the right
     * question for as long as a village could only shrink. A village builds houses now, and a house
     * raises the ceiling — so a place that has doubled has not drifted, it has grown, and judging it
     * against its founding would be marking the feature down as a fault.
     *
     * What is still worth asking is the pair of questions underneath that one. A village must never
     * hold more people than it has beds for, which would be the growth loop failing to keep up with
     * its own births. And it must not be standing half empty, which is what a village looks like on
     * its way out — the same `THIN` as before, against the room rather than the founding.
     */
    const drifted: string[] = [];
    const detail: string[] = [];
    for (const run of RUNS) {
      for (const village of LEFT_ALONE) {
        const founded = run.founded.get(village)!;
        const { souls, room } = lastStanding(run, village);
        detail.push(`${at(run, village)}: founded ${founded}, ${souls} in ${room} beds at day ${DAYS}`);
        if (souls > room) drifted.push(`${at(run, village)}: ${souls} people in ${room} beds`);
        if (souls < room * THIN) drifted.push(`${at(run, village)}: ${souls} people rattling around ${room} beds`);
      }
    }
    report({
      verdict: drifted.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * LEFT_ALONE.length,
      what: `untroubled villages inside the beds they have built, and at least ${THIN}× full`,
      detail: drifted.length === 0 ? detail : drifted,
    });
    expect(drifted, 'a village is overflowing its houses or rattling around in them').toEqual([]);
  });

  it('has not grown further than its ground and its ladder could take it', () => {
    /*
     * The upper half of the band, and it is a different question from the one above it.
     *
     * "Inside the beds it has built" is the hard invariant and it cannot catch runaway growth at
     * all, because growth raises the beds in lockstep: a village that has built forty roofs and
     * filled them satisfies it perfectly while having quietly become a city. Something has to bound
     * the *room itself*, and until houses could lift the ceiling there was nothing for such a bound
     * to be about — which is exactly why the original note parked it.
     *
     * Two caps decide how far a village may honestly go, and this is their product. `GROWTH.ROOM`
     * says the ground will take twice the houses it was laid out with; the ladder in `roofs.ts` says
     * a roof may climb from the standard four to a great house of eight. Twice the houses at twice
     * the size is four times the room, and anything past it is one of those two caps having been
     * breached rather than a village having done well.
     *
     * Deliberately a bound on the structure rather than on the pace. A village that reaches its
     * ceiling on day sixty and one that takes four hundred days about it are both believable
     * places; a village that sails past the ceiling is a bug, and that is the thing a bench can say
     * without an opinion about how fast a good century ought to feel.
     */
    const AT_MOST = GROWTH.ROOM * (ROOFS[ROOFS.length - 1].holds / STANDARD.holds);
    const runaway: string[] = [];
    const detail: string[] = [];
    for (const run of RUNS) {
      for (const village of LEFT_ALONE) {
        const founded = run.founded.get(village)!;
        const { room } = lastStanding(run, village);
        const most = founded * AT_MOST;
        detail.push(`${at(run, village)}: ${room} beds against ${Math.round(most)} the ground allows`);
        if (room > most) runaway.push(`${at(run, village)}: ${room} beds where ${Math.round(most)} is the ceiling`);
      }
    }
    report({
      verdict: runaway.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * LEFT_ALONE.length,
      what: `untroubled villages inside the ${AT_MOST}× room their ground and their ladder allow`,
      detail: runaway.length === 0 ? detail : runaway,
    });
    expect(runaway, 'a village has grown past what its ground could take').toEqual([]);
  });

  it('gains a bed only when something is built to hold it', () => {
    /*
     * The bound that reads one fact twice, and the only one here that could have caught a village
     * tripling its population without a roof going up.
     *
     * Every other question this bench asks reads one number and judges it. That is enough for drift
     * — a number going somewhere it should not — and no use at all against two *representations* of
     * one fact coming apart, which is what this failure is. `Settlement.founded` is the ceiling a
     * village is actually held to, lifted a houseful at a time as roofs go up; `holdsFor` is what
     * its buildings say it should hold, counted out of the works ledger. Nothing anywhere asked
     * whether they moved together.
     *
     * What is checked is the **gap**, not the equality, and the first run explains why: every
     * village in the world is founded with a gap already in it. `settle` sets `founded` to the
     * number of people it generated — sixteen in Ashford — where the six houses it laid out hold
     * twenty-four between them. So a village begins with eight beds it is not allowed to fill, and
     * the field's own note ("how many people the village's roofs hold") describes the value it
     * takes after the first roof goes up rather than the one it starts with. That is reported below
     * rather than failed: which of the two is wrong is a question for whoever owns the founding, and
     * a bench that fails a world for a definition is a bench nobody runs.
     *
     * The gap *moving* is the fault, and it catches both directions of the thing that matters. A
     * ceiling that rises with no building behind it is a village that grows for free — it would pass
     * every other bound in this file on its way to holding two hundred people, and an audit of the
     * books would pass it too, because nobody was paid for houses that do not exist. A building that
     * goes up without the ceiling moving is the growth loop failing to notice its own work.
     */
    const drifted: string[] = [];
    const founding: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        const nights = run.standing.get(village)!;
        const gap = nights[0].roofed - nights[0].room;
        founding.push(`${at(run, village)}: founded holding ${nights[0].room} in ${nights[0].roofed} beds`);
        for (const night of nights) {
          if (night.roofed - night.room === gap) continue;
          drifted.push(
            `${at(run, village)} on day ${night.day}: held to ${night.room} beds, ${night.roofed} built,`
            + ` where it began ${gap} apart`,
          );
          break;                                  // one night of it says everything; the rest is noise
        }
      }
    }
    report({
      verdict: drifted.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * JUDGED.length,
      what: 'villages that gained a bed only when something was built to hold it',
      detail: drifted.length === 0
        ? ['no village\'s ceiling moved except with its buildings, on any night of the run']
        : drifted,
    });
    report({
      verdict: 'NOTE',
      count: RUNS.length * JUDGED.length,
      what: 'every village is founded holding fewer people than its own houses have beds for',
      detail: [
        '`settle` sets `founded` to the number of people it generated; the houses it laid out hold',
        'more. The field is documented as "how many people the village\'s roofs hold", which is what',
        'it becomes after the first roof goes up rather than what it starts as. A village therefore',
        'begins with beds it is not allowed to fill, and `THIN` judges it against the smaller number.',
        ...founding,
      ],
    });
    expect(drifted, 'a village gained beds nothing built').toEqual([]);
  });
});

// --- is there anybody doing anything ---------------------------------------------------------

describe('what a village still does for a living', () => {
  it('has not lost most of the trades its place could support', () => {
    /*
     * The finding this bench was written to catch, and it caught it on the morning it was written.
     * A trade is inherited now — a farmer's child takes the farm — and inheritance is drift: every
     * funeral is a chance to lose a trade and no funeral is ever a chance to gain one back. Rolled
     * for, a village of sixteen holds six to nine trades at day 450. Inherited, the same village
     * holds two.
     *
     * Which is not an argument against inheriting a trade. It is the argument for the mayor
     * enrolling the next adult into whatever the village is short of, which is the other half of
     * the same feature and is why the two are numbered together in the work list.
     */
    const thin: string[] = [];
    const detail: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        const could = couldSupport(village);
        const holds = heldIn(run, village);
        const enough = Math.ceil(could.length * KEEPS_TRADES);
        detail.push(`${at(run, village)}: ${holds.length} of ${could.length} — ${holds.sort().join(', ') || 'nothing at all'}`);
        if (holds.length < enough) thin.push(`${at(run, village)}: ${holds.length} of ${could.length}, wanted ${enough}`);
      }
    }
    report({
      verdict: thin.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * JUDGED.length,
      what: `villages still holding at least half the trades their place supports, at day ${DAYS}`,
      detail: thin.length === 0 ? detail : thin,
    });
    expect(thin, 'villages have drifted down to a handful of trades between them').toEqual([]);
  });

  it('still has somebody working the land it has', () => {
    // a place with a field and nobody in it is the plainest way a simulated village stops being one
    const idle: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        if (!couldSupport(village).includes('farmer')) continue;
        if (!heldIn(run, village).includes('farmer')) idle.push(at(run, village));
      }
    }
    report({
      verdict: idle.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * JUDGED.filter((v) => couldSupport(v).includes('farmer')).length,
      what: 'villages with fields that still have somebody farming them',
      detail: idle.length === 0 ? ['every field in the world has a farmer on it'] : idle.map((name) => `${name} has fields and no farmer`),
    });
    expect(idle, 'a village kept its fields and lost everybody who worked them').toEqual([]);
  });
});

// --- is there anything in the fields and the store ---------------------------------------------

describe('what the land is carrying', () => {
  it('keeps no more beasts than the land it has could carry', () => {
    /*
     * Asked of the *land* rather than of the men, which is the whole of what item 31a wanted here
     * and is also a correction: this bound read `farmers × HERD_PER_FARMER` and the simulation
     * stopped capping on farmers when farms became things. `aDayOfCattle` takes farms now, and a
     * village with four farmers on three farms was being judged against a ceiling a third higher
     * than the one it was actually held to — a bound that would have passed a world running beasts
     * it had no paddocks for, and failed one that was behaving perfectly.
     *
     * What the land carries is `stables.ts`: farms times what each farm's buildings hold. The two
     * are the same number today because nobody has built a stable yet, and the point of asking it
     * this way is that they will not be the morning somebody does.
     *
     * It is still a bound on *coming back under* rather than on never going over. A village that
     * buries a farmer is over its limit for a while, which is fair — the beasts do not evaporate
     * the morning a man dies.
     */
    const over: string[] = [];
    const detail: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        const nights = run.standing.get(village)!;
        let worst = 0;
        let running = 0;
        for (const night of nights) {
          running = night.herd > night.carries + 1 ? running + 1 : 0;
          worst = Math.max(worst, running);
        }
        detail.push(`${at(run, village)}: over what its land carries for ${worst} days at a stretch`);
        if (worst > WORKED_OFF_BY) over.push(`${at(run, village)}: ${worst} days running`);
      }
    }
    report({
      verdict: over.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * JUDGED.length,
      what: 'villages whose herd stayed inside what their land could carry',
      detail: over.length === 0 ? [`no village ran a herd its paddocks could not hold for more than ${WORKED_OFF_BY} days`] : over,
    });
    expect(over, 'a village is running cattle it has no paddocks for').toEqual([]);
  });

  it('does not stand more buildings than it has people to fill them', () => {
    /*
     * The bound that could not be asked until buildings were counted per village, and the thing it
     * watches for is a particular kind of ruin: not an empty village but a *full* one that has gone
     * on building. Eleven roofs, a well, a watchtower and a bath house, and nine people — every one
     * of them paid for honestly, every purse balancing to the coin, and the place reads from the
     * road as somewhere that used to be somewhere.
     *
     * One apiece is generous and is meant to be. A village genuinely holds more roofs than souls
     * for a week after a hard winter, and a hamlet of four in three cottages is a hamlet rather
     * than a fault — so this is a floor under the absurd rather than a statement about density.
     */
    const sprawling: string[] = [];
    const detail: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        const { souls, buildings } = lastStanding(run, village);
        detail.push(`${at(run, village)}: ${buildings} buildings, ${souls} people`);
        if (buildings > souls) sprawling.push(`${at(run, village)}: ${buildings} buildings for ${souls} people`);
      }
    }
    report({
      verdict: sprawling.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * JUDGED.length,
      what: 'villages with somebody for every building standing in them',
      detail: sprawling.length === 0 ? detail : sprawling,
    });
    expect(sprawling, 'a village has built more than it has anybody to live in').toEqual([]);
  });

  it('keeps no more food than its cellars hold', () => {
    /*
     * Counted as a run of days rather than as a single evening, because a single evening over the
     * cap is not a fault. The store is trimmed to the cellar when the village sits down to dinner,
     * and a village that buried three people after dinner is over its new, smaller cellar until the
     * next one. What would be a fault is a store that stays over — food that never spoils is a
     * village that cannot be starved, and hunger is the main thing a player can turn around.
     */
    const spilling: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        const nights = run.standing.get(village)!;
        const books = run.books.get(village)!;
        let worst = 0;
        let running = 0;
        for (let n = 0; n < nights.length; n++) {
          const cap = cellarCap(new Array(books[n].roll.length).fill({} as never));
          running = nights[n].food > cap + 1 ? running + 1 : 0;
          worst = Math.max(worst, running);
        }
        if (worst > SPOILS_BY) spilling.push(`${at(run, village)}: over its cellar for ${worst} days running`);
      }
    }
    report({
      verdict: spilling.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * JUDGED.length,
      what: `villages that never held more meals than ${FOOD.KEEPS_DAYS} days a head for longer than a funeral takes`,
      detail: spilling.length === 0 ? ['nothing anywhere banked a year of dinners'] : spilling,
    });
    expect(spilling, 'a village is holding food that should have spoiled').toEqual([]);
  });
});

// --- and where the money ended up ---------------------------------------------------------------

describe('where four hundred days of money went', () => {
  it('is not all in one purse', () => {
    const lopsided: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        const books = run.books.get(village)!;
        const rows = books[books.length - 1].roll;
        const all = rows.reduce((sum, row) => sum + row.purse, 0);
        if (all <= 0) continue;
        const best = Math.max(...rows.map((row) => row.purse));
        if (best > all * ONE_MAN) {
          lopsided.push(`${at(run, village)}: one purse holds ${share(best, all)} of ${coins(all)}`);
        }
      }
    }
    report({
      verdict: 'NOTE',
      count: lopsided.length,
      what: `villages where one purse holds more than ${Math.round(ONE_MAN * 100)}% of everything in the place`,
      detail: lopsided.length === 0
        ? ['nobody anywhere is that far ahead of their neighbours']
        : [
          ...lopsided,
          'Somebody has to be the richest, so this is not a fault on its own. It is the shape a village',
          'takes when the money has stopped moving: nothing a villager can buy costs what they have.',
        ],
    });
  });

  it('is not all in the halls', () => {
    /*
     * The tax went in before anything a village could vote to spend it on, so the treasuries only
     * ever fill. This is the number that says how badly, and it is the argument for building the
     * spending half sooner rather than later: money in a hall is money out of the economy.
     */
    const detail: string[] = [];
    let banked = 0;
    let held = 0;
    for (const run of RUNS) {
      let halls = 0;
      let purses = 0;
      for (const village of JUDGED) {
        halls += lastStanding(run, village).hall;
        purses += worthOf(run, village);
      }
      banked += halls;
      held += purses;
      detail.push(`seed ${run.seed}: ${coins(halls)} in the halls against ${coins(purses)} in the purses — ${share(halls, halls + purses)} of it banked`);
    }
    const all = banked + held;
    report({
      verdict: banked > all * IN_THE_HALLS ? 'NOTE' : 'PASS',
      count: Math.round(banked),
      what: `gold sitting in halls nobody can spend from — ${share(banked, all)} of every coin in the world`,
      detail: [
        ...detail,
        `A hall is the one place a coin goes and does not come back: a purse buys dinner and is inherited,`,
        `and a treasury is spent on nothing at all until somebody votes to build something. Anything over`,
        `${Math.round(IN_THE_HALLS * 100)}% says the spending half is overdue rather than that the tax is wrong.`,
      ],
    });
  });

  it('is enough, somewhere, to build the most expensive thing a village can buy', () => {
    /*
     * The growth question, asked where it belongs.
     *
     * `chore economy` audits one generation and cannot ask this: a hundred days is not long enough
     * for a village to save up for a bath house, and when it looked as though it were, what was
     * paying for it turned out to be a herd nobody was keeping. Four hundred and fifty days is five
     * or six generations, and a world where *no* village in that time can afford the thing it is
     * meant to aspire to is a world whose money does not accumulate at all.
     */
    const storeys: string[] = [];
    const baths: string[] = [];
    for (const run of RUNS) {
      for (const village of JUDGED) {
        const evenings = run.books.get(village)!;
        const storey = evenings.find((e) => e.roll.length > 0 && eachHead(e) >= PROSPER.STOREY);
        const bath = evenings.find((e) => e.roll.reduce((sum, row) => sum + row.purse, 0) >= PROSPER.LUXURY);
        if (storey) storeys.push(`${at(run, village)}: two storeys from day ${storey.day}`);
        if (bath) baths.push(`${at(run, village)}: a bath house from day ${bath.day}`);
      }
    }
    report({
      verdict: storeys.length > 0 && baths.length > 0 ? 'PASS' : 'FAIL',
      count: baths.length,
      what: `villages that held ${PROSPER.LUXURY} between them at some point, and ${storeys.length} that stood ${PROSPER.STOREY} a head`,
      detail: baths.length > 0 ? baths.slice(0, 8) : [
        'Not one village in four hundred and fifty days held enough between it for a bath house.',
        'Either the money does not accumulate or the price is quoted in a currency nobody can hold.',
      ],
    });
    expect(storeys.length, 'four hundred days and nobody put a storey on a house').toBeGreaterThan(0);
    expect(baths.length, 'the money does not accumulate into anything a village can buy').toBeGreaterThan(0);
  });

  it('writes down what it found', () => {
    /*
     * Written to a file rather than logged, because a passing test's output is swallowed and the
     * run that passed is the whole point of the exercise. `chore sanity` prints it.
     */
    const pad = (word: string): string => word.padEnd(8);
    const failed = covered.filter((line) => line.verdict === 'FAIL');
    const lines = [
      `SANITY BENCH — ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${new Date().toISOString()}`,
      '',
      `  ${JUDGED.length} villages on ${RUNS.length} seeds, ${DAYS} days each — five or six generations, which is`,
      '  long enough for drift to show. Nothing here is added up: the audit in economy-report.txt does that,',
      '  and passes a village that has lost every farmer it ever had. This asks the questions a person',
      '  would ask on walking in. PASS and FAIL are faults. NOTE is for somebody to decide about.',
      '',
    ];
    for (const line of covered) {
      lines.push(`  ${pad(line.verdict)} ${String(line.count).padStart(7)}  ${line.what}`);
      for (const detail of line.detail ?? []) lines.push(`  ${' '.repeat(8)}          ${detail}`);
    }
    lines.push(
      '',
      `  Written by src/game/sanity.test.ts to ${REPORT}. Run it again with: chore sanity`,
      '',
    );
    writeFileSync(REPORT, lines.join('\n'));

    expect(covered.length, 'the bench stopped reporting what it did').toBeGreaterThan(6);
  });
});
