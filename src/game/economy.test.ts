import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROSPER } from '../world/prosperity';
import {
  DAYS, FOUNDED, LEFT_ALONE, RUNS, VILLAGES, at, coins, who, worth, type Books,
} from './economy.bench';

/**
 * A hundred days in half a dozen villages, and the books held to what the purses actually did.
 *
 * The economy has never been checked end to end. Every part of it has a test — what a day at the
 * face is worth, what a meal costs, when a village stops replacing its dead — and not one of them
 * asks the only question that matters, which is whether a village left to live a season comes out
 * of it solvent. A world that mints money nobody spends and spends money nobody minted looks
 * perfectly correct one function at a time.
 *
 * So `economy.bench.ts` stands villages up and lives them forward a hundred days a day at a time,
 * keeping their books every evening, and this audits those books the way a clerk would: opening
 * balance, what they say came in, what they say went out, closing balance, and a name for anything
 * left over. Two rules make it worth running.
 *
 * The first is that it judges by the *books* and never by the simulation. It reads `theRoll`,
 * `theStones` and `theBirths` — the same rows a player pays a clerk to see — and nothing else. It
 * does not import `prosperity.ts` or `food.ts` for the audit, does not know what a wage is, and
 * cannot be right by construction. If the roll says a woman takes one and a half a day and her
 * purse moves by something else, that is the news, and it does not matter which of the two is
 * wrong. (`PROSPER` is imported for the last section only, which is about what the money is *for*
 * and has to know the price of the things it buys. Nothing above it reads a constant.)
 *
 * The second is that it is mechanical. Running it burns processor time and nobody's attention: it
 * writes an account of what it found to a file, names the village, the day, the number and how far
 * out it is, and a person or an agent picks that up afterwards without having driven anything.
 *
 * It found four things on the morning it was written, two of which were plain bugs and are fixed
 * in `register.ts` and `records.ts`; the other two are in the account it prints and in the work
 * list, because they are decisions about the game rather than mistakes in it.
 */

/** Where the run leaves its account of itself. Printed by `chore test economy`. */
const REPORT = 'economy-report.txt';

/** One line of the account: a verdict, how many cases earned it, and what they were. */
interface Line {
  verdict: 'PASS' | 'FAIL' | 'NOTE';
  count: number;
  what: string;
  detail?: string[];
}

const covered: Line[] = [];
const report = (line: Line): void => { covered.push(line); };

/**
 * How much worse a raided village's ten days have to be than a quiet one's before the bench will
 * believe that a band costs a village anything.
 *
 * A share of what the place is worth rather than a number of coins, and a quarter of it because
 * that is well clear of the noise: an ordinary ten days in a quiet village runs a tenth either
 * way depending on who happened to die in it, and a band takes about two thirds.
 */
const COST_OF_A_BAND = 0.25;

// --- the audit -----------------------------------------------------------------------------

/**
 * Every coin in a village, accounted for by that village's own books.
 *
 * This is the whole bench in one test. For every pair of consecutive evenings it takes the people
 * on the roll both times — arrivals and departures are counted separately, below — and asks the
 * ledger what should have happened to them: each row says what it takes in a day, what its keep
 * costs and what its dinner costs, and the stones and the mine's own report cover the rest. The
 * closing purses must come to the opening purses plus the one and minus the other, to the coin.
 *
 * Whether a dinner was actually bought is read off the roll too, because the roll now says who
 * went without. That mattered more than it sounds: a village whose purses have run dry stops
 * eating rather than stops paying, and a bench that charged everybody for dinner every day would
 * have called a famine a bookkeeping error.
 *
 * Anything left over is coin that appeared or vanished with no entry anywhere, which is the fault
 * this test exists to find. It found one immediately: the meal, which every villager paid every
 * day and no book in the game mentioned, so the roll had every working villager down as putting
 * seven tenths of a coin by when they were in fact three tenths worse off every morning.
 */
describe('the coin in a village, against the books that village keeps', () => {
  it('balances every day, in every village, to the coin', () => {
    const off: string[] = [];
    let days = 0;
    let audited = 0;

    for (const run of RUNS) {
      for (const [village, evenings] of run.books) {
        for (let n = 1; n < evenings.length; n++) {
          const before = evenings[n - 1], after = evenings[n];
          const closing = new Map(after.roll.map((row) => [who(row), row]));
          let expected = 0, observed = 0, people = 0;

          for (const row of before.roll) {
            const now = closing.get(who(row));
            if (!now) continue;                      // gone: a departure, counted in its own test
            people++;
            // the day the books predicted: the wage, less the keep, less the dinner if there was
            // one. `hungry` is nought for anybody who ate, which is how the roll says so
            const ate = now.hungry === 0 ? row.food : 0;
            expected += row.earns - row.spends - ate;
            observed += now.purse - row.purse;
          }
          expected += run.minted.get(village)!.get(after.day) ?? 0;
          days++;
          audited += people;

          // a thousandth of a coin: purses are added up in tenths and eighths, so the last few
          // digits of a float are the only slack this is allowed to have
          if (Math.abs(observed - expected) > 1e-3) {
            off.push(`${at(run, village, after.day)}: the books say ${coins(expected)} and the purses moved ${coins(observed)} — out by ${coins(observed - expected)} across ${people} people`);
          }
        }
      }
    }

    report({
      verdict: off.length === 0 ? 'PASS' : 'FAIL',
      count: days,
      what: `village-days audited to the coin, ${audited.toLocaleString()} people-days in them`,
      detail: off.slice(0, 8),
    });
    expect(off, 'coin appeared or vanished with nothing in any book to explain it').toEqual([]);
  });
});

/**
 * Nobody ages backwards, and no two people on a roll are the same person.
 *
 * The second half of that is not padding. Everything else here follows people from one evening to
 * the next by what they are called, and two villagers the books cannot tell apart would make every
 * audit above pass by cancelling one against the other.
 */
describe('the people on the roll, over a hundred days', () => {
  it('never age backwards, and are never two people with one name', () => {
    const wrong: string[] = [];
    let watched = 0;

    for (const run of RUNS) {
      for (const [village, evenings] of run.books) {
        const oldest = new Map<string, number>();
        for (const evening of evenings) {
          const seen = new Set<string>();
          for (const row of evening.roll) {
            const key = who(row);
            if (seen.has(key)) wrong.push(`${at(run, village, evening.day)}: two people on the roll are both ${key}`);
            seen.add(key);
            if (row.age < 0) wrong.push(`${at(run, village, evening.day)}: ${key} is ${row.age} years old`);
            const was = oldest.get(key);
            if (was !== undefined && row.age < was) {
              wrong.push(`${at(run, village, evening.day)}: ${key} was ${was} and is now ${row.age}`);
            }
            oldest.set(key, Math.max(was ?? 0, row.age));
            watched++;
          }
          // and the other book about the same people agrees about when they were born
          for (const birth of evening.born) {
            const onRoll = evening.roll.find((row) => row.name === birth.name);
            if (onRoll && onRoll.born !== birth.born) {
              wrong.push(`${at(run, village, evening.day)}: the roll has ${birth.name} born on day ${onRoll.born} and the births book on day ${birth.born}`);
            }
          }
        }
      }
    }

    report({
      verdict: wrong.length === 0 ? 'PASS' : 'FAIL',
      count: watched,
      what: 'people-days on the roll: none aged backwards, none shared a name with anybody',
      detail: wrong.slice(0, 8),
    });
    expect(wrong, 'the roll disagrees with itself about who somebody is').toEqual([]);
  });
});

/**
 * Every death is written down.
 *
 * Somebody who was on the roll last night and is not on it tonight went somewhere, and there are
 * exactly two somewheres: the churchyard, with a stone dated today, or another village's roll,
 * because a neighbour walked them over to put a ruin back on its feet. Anything else is a person
 * the world lost track of, which is the one thing a register is for.
 */
describe('the roll against the stones', () => {
  it('writes down every death, on the day it happened', () => {
    const missing: string[] = [];
    let buried = 0, moved = 0;

    for (const run of RUNS) {
      for (const [village, evenings] of run.books) {
        for (let n = 1; n < evenings.length; n++) {
          const before = evenings[n - 1], after = evenings[n];
          const stillHere = new Set(after.roll.map(who));
          const newStones = new Set(
            after.stones.filter((stone) => stone.day === after.day).map((stone) => stone.name),
          );
          // and everywhere else in the world, for whoever was walked over to a ruin
          const elsewhere = new Set<string>();
          for (const [other, theirs] of run.books) {
            if (other === village) continue;
            for (const row of theirs[n].roll) elsewhere.add(who(row));
          }

          for (const row of before.roll) {
            if (stillHere.has(who(row))) continue;
            if (newStones.has(row.name)) { buried++; continue; }
            if (elsewhere.has(who(row))) { moved++; continue; }
            missing.push(`${at(run, village, after.day)}: ${who(row)} left the roll with no stone and turned up nowhere else`);
          }
        }
      }
    }

    report({
      verdict: missing.length === 0 ? 'PASS' : 'FAIL',
      count: buried,
      what: `deaths, every one of them written down on the day it happened (and ${moved} people walked to another village)`,
      detail: missing.slice(0, 8),
    });
    expect(buried, 'a hundred days and nobody died anywhere: the run is not living').toBeGreaterThan(20);
    expect(missing, 'somebody left the roll and was never written down').toEqual([]);
  });
});

/**
 * Purses move.
 *
 * The dullest thing on A5's list and the easiest to fail without noticing: a village whose money
 * never moves is exactly what this game had before villagers carried a purse that outlived being
 * drawn, and from the outside it looks precisely like a village.
 *
 * Asked of people rather than of a village's total, and that is not a detail. A working villager
 * settles at a purse where the wage and the day's costs cancel exactly, so his purse is the same
 * every evening while money goes through it every morning — a village of those has a total that
 * never budges and an economy that is running perfectly well. What would be broken is somebody
 * whose purse never changed at all: never paid, never charged, holding what he was born with.
 */
describe('the money itself', () => {
  it('comes into a purse and goes out of one, every day, everywhere it should', () => {
    const stuck: string[] = [];
    let flowed = 0, standstill = 0, lives = 0;

    for (const run of RUNS) {
      for (const [village, evenings] of run.books) {
        const quiet = LEFT_ALONE.includes(village);
        /** How long each person has been on the roll with a trade, and the best purse they held. */
        const working = new Map<string, { days: number; best: number; trade: string }>();

        for (let n = 1; n < evenings.length; n++) {
          const before = evenings[n - 1], after = evenings[n];
          const closing = new Map(after.roll.map((row) => [who(row), row]));
          let paid = 0, charged = 0, workers = 0;

          for (const row of before.roll) {
            if (!row.trade) continue;
            workers++;
            const kept = working.get(who(row)) ?? { days: 0, best: 0, trade: row.trade };
            kept.days++;
            kept.best = Math.max(kept.best, row.purse);
            working.set(who(row), kept);
            paid += row.earns;
            charged += row.spends + (closing.get(who(row))?.hungry === 0 ? row.food : 0);
          }
          if (workers === 0) continue;
          if (Math.abs(worth(after) - worth(before)) <= 1e-9) standstill++;
          if (paid > 0 && charged > 0) { flowed++; continue; }
          // a besieged village earns nothing and pays for nothing, which is the point of a siege
          if (!quiet) continue;
          stuck.push(`${at(run, village, after.day)}: ${workers} people at work, ${coins(paid)} paid in and ${coins(charged)} paid out`);
        }

        if (!quiet) continue;
        for (const [name, kept] of working) {
          lives++;
          if (kept.days >= 10 && kept.best <= 0) {
            stuck.push(`${at(run, village, FOUNDED + DAYS)}: ${name}, ${kept.trade}, was on the roll working for ${kept.days} days and never held a coin`);
          }
        }
      }
    }

    report({
      verdict: stuck.length === 0 ? 'PASS' : 'FAIL',
      count: flowed,
      what: `village-days on which money both came in and went out (${lives} working lives watched, none unpaid)`,
      detail: stuck.length > 0 ? stuck.slice(0, 8) : [
        `On ${standstill} of those evenings a village was worth to the penny what it had been worth the`,
        'evening before. That is not money standing still — it is a village at the point where the wage',
        'and the day exactly cancel, which is the thing the last section of this report is about.',
      ],
    });
    expect(flowed, 'nobody in any of these villages was ever paid anything').toBeGreaterThan(500);
    expect(stuck, 'a village that has quietly stopped paying anybody').toEqual([]);
  });
});

/**
 * A village under pressure gets poorer, and one left alone does not.
 *
 * The half of A5 that is about the game rather than about the bookkeeping: prosperity is meant to
 * be a thing the player can protect, which means it has to be a thing that can be taken away and a
 * thing that comes back. Read against the untroubled village on the same seed over the same days,
 * so that a run where everybody happened to be old is not read as a raid.
 */
describe('what a band standing over a village does to it', () => {
  it('makes it poorer while it is there, and lets it recover when it goes', () => {
    const wrong: string[] = [];
    const said: string[] = [];

    for (const run of RUNS) {
      const control = run.books.get('Ashford')!;
      const raided = VILLAGES.find((v) => v.village === 'Thornby')!.band!;
      const evenings = run.books.get('Thornby')!;
      const on = (books: Books[], day: number): Books => books[day - FOUNDED];

      const before = worth(on(evenings, raided.from - 1));
      const during = worth(on(evenings, raided.until - 1));
      const after = worth(on(evenings, FOUNDED + DAYS));
      const wasQuiet = worth(on(control, raided.from - 1));
      /*
       * Both as a share of what the place had, and both over the same ten days, because a village
       * left alone does lose money: people die of old age and their purses go into the ground with
       * them, and on a bad week that is more than a raid takes. What has to be true is not that a
       * quiet village never loses a coin, it is that being leaned on costs a village very much
       * more than being left alone does.
       */
      const raidedBy = (during - before) / Math.max(1, before);
      const quietBy = (worth(on(control, raided.until - 1)) - wasQuiet) / Math.max(1, wasQuiet);

      if (raidedBy >= quietBy - COST_OF_A_BAND) {
        wrong.push(`Thornby (seed ${run.seed}) lost ${Math.round(-raidedBy * 100)}% of itself under a band and Ashford lost ${Math.round(-quietBy * 100)}% being left alone: a band costs a village nothing`);
      }
      if (after <= during) {
        wrong.push(`Thornby (seed ${run.seed}) never recovered: ${coins(during)} the day the band left, ${coins(after)} sixty days later`);
      }
      said.push(`seed ${run.seed}: Thornby ${coins(before)} → ${coins(during)} under the band (${Math.round(raidedBy * 100)}%) → ${coins(after)} by day ${FOUNDED + DAYS}; Ashford ${Math.round(quietBy * 100)}% over the same days`);
    }

    report({
      verdict: wrong.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length,
      what: 'raided villages that got poorer while the band was there and made it back afterwards',
      detail: wrong.length > 0 ? wrong : said,
    });
    expect(wrong, 'pressure is not doing to a village what the whole design says it does').toEqual([]);
  });
});

/**
 * Neither collapse nor runaway.
 *
 * Collapse is a village left alone that empties, starves, or ends with nothing; runaway is coin
 * arriving from somewhere nothing minted. The second is already covered to the coin by the audit,
 * so what is stated here is the bound it implies: what a village holds can never be more than what
 * its own books say it earned and its own mine says it dug.
 */
describe('a hundred days, at the end of them', () => {
  it('leaves a village neither empty nor impossibly rich', () => {
    const wrong: string[] = [];
    const trail: string[] = [];

    for (const run of RUNS) {
      for (const [village, evenings] of run.books) {
        const end = evenings[evenings.length - 1];
        const founded = run.founded.get(village)!;
        const starved = end.stones.filter((stone) => stone.cause === 'hunger').length;

        // everything the books ever said came in, over the whole run, mine included
        let could = 0;
        for (let n = 0; n < evenings.length - 1; n++) {
          for (const row of evenings[n].roll) could += row.earns;
          could += run.minted.get(village)!.get(evenings[n + 1].day) ?? 0;
        }
        if (worth(end) > could + 1e-3) {
          wrong.push(`${at(run, village, end.day)}: holds ${coins(worth(end))} and its books account for ${coins(could)} ever coming in`);
        }

        if (!LEFT_ALONE.includes(village)) continue;
        if (end.roll.length * 2 < founded) {
          wrong.push(`${at(run, village, end.day)}: left alone and down from ${founded} souls to ${end.roll.length}`);
        }
        if (starved > 0) {
          wrong.push(`${at(run, village, end.day)}: left alone and ${starved} of its stones read starved`);
        }
        if (worth(end) <= 0) wrong.push(`${at(run, village, end.day)}: left alone and has nothing at all`);
        trail.push(`seed ${run.seed} ${village}: ${end.roll.length} of ${founded} souls, ${coins(worth(end))} gold between them, ${end.stones.length} stones`);
      }
    }

    report({
      verdict: wrong.length === 0 ? 'PASS' : 'FAIL',
      count: RUNS.length * LEFT_ALONE.length,
      what: 'villages left alone for a hundred days that neither emptied nor starved nor ended broke',
      detail: wrong.length > 0 ? wrong : trail,
    });
    expect(wrong, 'a hundred days left a village in a state the design says it should not be in').toEqual([]);
  });
});

// --- and what the hundred days actually came to ---------------------------------------------

/**
 * What the books say about the economy itself.
 *
 * Not assertions. Everything above is a fault if it fires; everything here is what a hundred days
 * came to, printed because somebody has to decide about it and cannot decide about a number nobody
 * has written down. The first three are read straight off the books. The last one has to know what
 * the money is *for*, so it is the one place in this file that reads a constant out of
 * `prosperity.ts` — and it is deliberately last, below everything that judges.
 */
describe('what the hundred days came to', () => {
  it('says so, and writes the account out', () => {
    const first = RUNS[0];

    // 1. the wage table, as the books actually pay it
    const wages = new Map<string, number>();
    for (const run of RUNS) {
      for (const evenings of run.books.values()) {
        for (const evening of evenings) {
          for (const row of evening.roll) {
            if (row.trade && row.earns > 0) wages.set(row.trade, Math.max(wages.get(row.trade) ?? 0, row.earns));
          }
        }
      }
    }
    const best = Math.max(...wages.values());
    const paidBest = [...wages].filter(([, wage]) => wage >= best).map(([trade]) => trade);
    report({
      verdict: 'NOTE',
      count: wages.size,
      what: 'trades anybody in these villages actually held, and what the roll pays them',
      detail: [
        [...wages].sort((a, b) => b[1] - a[1]).map(([trade, wage]) => `${trade} ${wage}`).join(', '),
        `Only ${paidBest.join(' and ')} is paid the higher rate. Everybody else in every village is on the`,
        'subsistence floor, which is why nothing below ever gets anywhere.',
      ],
    });

    // 2. where a purse settles, and how long it stays there
    const settled: string[] = [];
    for (const village of LEFT_ALONE) {
      const evenings = first.books.get(village)!;
      const end = evenings[evenings.length - 1];
      const working = end.roll.filter((row) => row.trade).map((row) => row.purse).sort((a, b) => a - b);
      const middle = working.length > 0 ? working[Math.floor(working.length / 2)] : 0;
      let unchanged = 0;
      for (let n = evenings.length - 1; n > 0; n--) {
        const was = evenings[n - 1].roll.filter((row) => row.trade).map((row) => row.purse).sort((a, b) => a - b);
        if (was.length === 0 || Math.abs(was[Math.floor(was.length / 2)] - middle) > 1e-6) break;
        unchanged++;
      }
      settled.push(`${village}: the middle working villager holds ${coins(middle)} gold, and has held exactly that for ${unchanged} days`);
    }
    report({
      verdict: 'NOTE',
      count: LEFT_ALONE.length,
      what: 'villages left alone: where a working purse comes to rest',
      detail: settled,
    });

    // 3. the mint, and what happens to it
    const mining = VILLAGES.filter((v) => v.mine).map((v) => v.village);
    const mint: string[] = [];
    for (const run of RUNS) {
      for (const village of mining) {
        const evenings = run.books.get(village)!;
        const paid = [...run.minted.get(village)!].filter(([, gold]) => gold > 0);
        const last = paid.length > 0 ? Math.max(...paid.map(([day]) => day)) : 0;
        const total = paid.reduce((sum, [, gold]) => sum + gold, 0);
        const lastMiner = evenings.filter((e) => e.roll.some((row) => row.trade === 'miner')).pop();
        const kept = worth(evenings[evenings.length - 1]);
        mint.push(`seed ${run.seed} ${village}: ${total} gold minted, the last of it on day ${last}; the village last had a miner on day ${lastMiner?.day ?? 0} of ${FOUNDED + DAYS}, and holds ${coins(kept)} of it`);
      }
    }
    report({
      verdict: 'NOTE',
      count: mining.length * RUNS.length,
      what: 'the only source of new money in the world, and how long it lasted',
      detail: mint,
    });

    // 4. what goes into the ground, against what is spent living
    let intoTheGround = 0, spentLiving = 0;
    for (const run of RUNS) {
      for (const evenings of run.books.values()) {
        for (let n = 1; n < evenings.length; n++) {
          const here = new Set(evenings[n].roll.map(who));
          for (const row of evenings[n - 1].roll) {
            if (!here.has(who(row))) intoTheGround += row.purse;
            else spentLiving += row.spends + (evenings[n].roll.find((r) => who(r) === who(row))!.hungry === 0 ? row.food : 0);
          }
        }
      }
    }
    report({
      verdict: 'NOTE',
      count: Math.round(intoTheGround),
      what: `gold that left the world in somebody's pocket, against ${Math.round(spentLiving)} spent on living`,
      detail: ['A purse goes into the ground with its owner: there is no inheritance anywhere in this world.'],
    });

    // 5. and the one thing here that has to know what money buys
    const ends = RUNS.flatMap((run) => [...run.books.values()].map((evenings) => evenings[evenings.length - 1]));
    const richest = Math.max(...ends.flatMap((end) => end.roll.map((row) => row.purse)));
    const village = Math.max(...ends.map(worth));
    const eachOf = Math.max(...ends.map((end) => worth(end) / Math.max(1, end.roll.length)));
    report({
      verdict: 'NOTE',
      count: Math.round(richest),
      what: `gold in the richest purse in the world after a hundred days; a second storey costs ${PROSPER.STOREY}`,
      detail: [
        `The best-off village between them holds ${coins(village)} — and a storey is bought out of the village`,
        `average, which at its highest here is ${coins(eachOf)} a head against the ${PROSPER.STOREY} one costs. The cheapest`,
        `thing a village can build for itself costs ${PROSPER.LUXURY}. Nobody on any of these seeds came within a`,
        'factor of ten of either, so the storeys and the saunas that prosperity.ts exists to raise have',
        'never once been raised, and nothing a villager earns has ever changed anything anybody can see.',
      ],
    });

    /*
     * Written to a file rather than logged, because a passing test's output is swallowed and the
     * run that passed is the whole point of the exercise. `chore test economy` prints it.
     */
    const pad = (word: string): string => word.padEnd(8);
    const failed = covered.filter((line) => line.verdict === 'FAIL');
    const lines = [
      `ECONOMY BENCH — ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${new Date().toISOString()}`,
      '',
      `  ${VILLAGES.length} villages on ${RUNS.length} seeds, ${DAYS} days each, audited against their own books and`,
      '  nothing else: the roll, the stones and the births, which is what a player pays a clerk to see.',
      '  PASS and FAIL are faults. NOTE is what the hundred days came to, and is for somebody to',
      '  decide about rather than for a machine to judge.',
      '',
    ];
    for (const line of covered) {
      lines.push(`  ${pad(line.verdict)} ${String(line.count).padStart(7)}  ${line.what}`);
      for (const detail of line.detail ?? []) lines.push(`  ${' '.repeat(8)}          ${detail}`);
    }
    lines.push(
      '',
      `  Written by src/game/economy.test.ts to ${REPORT}. Run it again with: chore test economy`,
      '',
    );
    writeFileSync(REPORT, lines.join('\n'));

    expect(covered.length, 'the bench stopped reporting what it did').toBeGreaterThan(8);
    expect(wages.size, 'the villages have stopped raising anybody who works for a living').toBeGreaterThan(5);
    expect(failed.map((line) => line.what), 'the account above is not clean').toEqual([]);
  });
});
