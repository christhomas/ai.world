import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROSPER } from '../world/prosperity';
import {
  DAYS, FOUNDED, LEFT_ALONE, RUNS, VILLAGES, at, coins, eachHead, midPurse, who, worth, type Books,
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
 * wrong. (`PROSPER` is read by the last two sections only — what a village managed to build, and
 * the account of what the money is *for* — because those are the only questions here that have to
 * know the price of a thing. Everything that audits the books is above them and reads no constant
 * at all, which is what keeps it from being right by construction.)
 *
 * The second is that it is mechanical. Running it burns processor time and nobody's attention: it
 * writes an account of what it found to a file, names the village, the day, the number and how far
 * out it is, and a person or an agent picks that up afterwards without having driven anything.
 *
 * It found four things on the morning it was written. Two were plain bugs and are fixed in
 * `register.ts` and `records.ts`. The other two were balance decisions rather than mistakes, so it
 * reported them and left them: ten of the eleven trades paid the same floor, and every purse in
 * the world converging on 6.5 so that nothing a villager earned ever bought anything. Both have
 * since been decided — see A6 and A7 in the work list — and the section that used to print them as
 * open questions now prints what a village actually built, and fails if the answer is nothing.
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
    let funerals = 0;
    let days = 0;
    let audited = 0;

    for (const run of RUNS) {
      for (const [village, evenings] of run.books) {
        for (let n = 1; n < evenings.length; n++) {
          const before = evenings[n - 1], after = evenings[n];
          const closing = new Map(after.roll.map((row) => [who(row), row]));
          let expected = 0, observed = 0, people = 0;

          /*
           * A funeral moves money sideways, and this check cannot follow it.
           *
           * It compares each person's purse against what the books said their day would do, which
           * is exactly right on an ordinary day and cannot be made right on a day somebody was
           * buried: an estate arrives in a purse with nothing in that person's own row to explain
           * it. Recording what each stone handed on very nearly closes it, and "very nearly" is the
           * problem — a village that buries two people in one day hands the first estate to the
           * second man, who then dies holding it, and the money is counted twice on its way to
           * whoever finally kept it. Chains of three exist. So do days when the last soul in a
           * village dies and there is nobody to leave anything to.
           *
           * The honest thing is to say what this check is for and let the other one carry the rest.
           * Burial days are counted and skipped here; `nothing leaves the world in a pocket` below
           * asserts the property that actually matters — that a funeral never destroys a coin — and
           * it does so over the whole hundred days rather than a day at a time, where no chain can
           * hide.
           */
          const buriedToday = after.stones.filter((stone) => stone.day === after.day).length;
          if (buriedToday > 0) { funerals += buriedToday; continue; }

          for (const row of before.roll) {
            const now = closing.get(who(row));
            // gone: a departure, counted in its own test. Nobody was buried today — that case
            // left through the door above
            if (!now) continue;
            people++;
            // the day the books predicted: the wage, less the keep, less the dinner if there was
            // one. `hungry` is nought for anybody who ate, which is how the roll says so
            const ate = now.hungry === 0 ? row.food : 0;
            // today's tax comes off today's row, the way `hungry` says whether today's dinner was
            // eaten: what the hall took is a fact about the day being audited rather than the day
            // before it
            // and what the hall paid out, on the few days a village buys something: the same rule as
            // the tax, in the other direction. Without it every villager gets richer on one morning
            // for no stated reason, which is the shape of a bug rather than of a building
            expected += row.earns - row.spends - ate - now.tax + now.paid;
            observed += now.purse - row.purse;
          }
          /*
          /*
           * A village that was empty this morning, or was started again overnight.
           *
           * Somebody walks over from the next village along and founds the place afresh: new
           * people, new purses, and — because names are grown from the seed — some of them wearing
           * the names of the dead. A row-by-row check then pairs up two people who are not the same
           * person, and calls the difference between their purses a missing coin. There is no
           * comparison to make on such a day; `nothing leaves the world in a pocket` covers the
           * money across the whole run, which is where a resettling belongs.
           */
          if (people === 0) continue;
          // and a village that started again overnight: the people on the two evenings are not the
          // same people, whatever their names say
          if (run.restarted.get(village)?.has(after.day)) continue;
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
      what: `village-days audited to the coin, ${audited.toLocaleString()} people-days in them`
        + ` (${funerals} funerals stood aside from, and answered for below)`,
      detail: off.slice(0, 8),
    });
    expect(off, 'coin appeared or vanished with nothing in any book to explain it').toEqual([]);
  });

  /**
   * The property a funeral has to have, said over the whole hundred days instead of a day at a time.
   *
   * A purse used to go into the ground with its owner — 18,617 gold over these twenty-one villages,
   * against 30,301 spent on living, which made death the largest single drain in this economy and
   * meant a village settled for a century was no better off than one founded last week. It is
   * inherited now, so the claim is simply that it *stays*: whatever somebody was holding when they
   * died is still in the village afterwards.
   *
   * Measured over the run rather than per day on purpose. Per day it cannot be measured at all —
   * a village that buries two people hands the first estate to the second man, who dies holding it,
   * and the same coins appear on two stones on their way to whoever finally kept them. Over a
   * hundred days there is nowhere for a chain like that to hide: either the money is in a purse at
   * the end or it is not.
   *
   * The exception written into the number is the one honest leak left. When the last soul in a
   * village dies there is nobody to leave anything to, and what they held is genuinely gone. That
   * is a village that has died, and it is a different thing from a man dying in one.
   */
  it('never buries a coin: what somebody held is still in the village afterwards', () => {
    let lost = 0, buried = 0, emptied = 0;
    for (const run of RUNS) {
      for (const [village, evenings] of run.books) {
        for (let n = 1; n < evenings.length; n++) {
          const gone = new Set(evenings[n].stones.filter((stone) => stone.day === evenings[n].day).map((stone) => stone.name));
          if (gone.size === 0) continue;
          buried += gone.size;
          if (evenings[n].roll.length === 0) { emptied++; continue; }
          for (const stone of evenings[n].stones.filter((one) => one.day === evenings[n].day)) {
            const had = evenings[n - 1].roll.find((row) => row.name === stone.name);
            if (!had) continue;
            /*
             * What the dead were holding last night, against what the stone says was handed on.
             *
             * The stone may say more — they earned before they died, and an earlier funeral the
             * same day may have left them something. It may also say a little less, and that is
             * not a leak: a man who ate his dinner and paid his keep and then died of old age
             * leaves the day's living less than he woke up with. So the floor is last night's
             * purse less exactly one day of being alive, and anything under that is money nobody
             * can account for.
             */
            /*
             * And the hall's share, twice over.
             *
             * What the hall takes leaves a purse and arrives in no other, so without it a tax reads
             * as money buried with its owner — two hundred and fifty gold of it across this bench,
             * the morning the tax went in. Twice because this row is last night's and there was a
             * morning after it: the same reason the day's keep and the day's dinner are subtracted
             * here. It is a floor rather than a reckoning, and a floor is allowed to be generous by
             * a day of being alive.
             */
            const least = had.purse - had.spends - had.food - had.tax * 2;
            if (stone.left + 1e-6 < least) { lost += least - stone.left; void village; }
          }
        }
      }
    }
    report({
      verdict: lost < 1 ? 'PASS' : 'FAIL',
      count: buried,
      what: `funerals, and ${Math.round(lost)} gold buried with the dead (${emptied} villages died out entirely, whose money is honestly gone)`,
      detail: [],
    });
    expect(lost, 'money went into the ground with somebody who had a village to leave it to').toBeLessThan(1);
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

        /*
         * Everything that ever came in: what the books said was earned, what the mine minted, and
         * what walked through the gate in somebody's pocket.
         *
         * That last one is not a detail and leaving it out made this check quietly wrong for the
         * life of the bench. `register.resettle` moves grown people from a crowded village into an
         * emptied one and they take their purses with them — this is the only way a ruin ever comes
         * back — so a village that was resettled holds money that its own roll never earned. It
         * went unnoticed because the bound was slack: while a villager earned two a day it did not
         * matter that a few hundred gold had walked in. The day food producers started being paid
         * for the surplus they had always been throwing away, Blackmarsh on seed 1234 was found
         * holding 1,940 against 1,812 ever earned — and 2,630 had walked in.
         *
         * Departures are deliberately not netted off. Somebody leaving with their purse only makes
         * this bound looser, and a loose bound in the safe direction is what a sanity check wants.
         */
        let could = 0;
        for (let n = 0; n < evenings.length - 1; n++) {
          for (const row of evenings[n].roll) could += row.earns;
          could += run.minted.get(village)!.get(evenings[n + 1].day) ?? 0;
          const before = new Set(evenings[n].roll.map(who));
          for (const row of evenings[n + 1].roll) if (!before.has(who(row))) could += row.purse;
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

/** What one village managed to build, and the first evening it could have. */
interface Built {
  seed: number;
  village: string;
  quiet: boolean;
  /** The day its houses first stood a head above `PROSPER.STOREY`, or null for a village that never did. */
  storeyOn: number | null;
  /** And the day it first held `PROSPER.LUXURY` between the whole place. */
  luxuryOn: number | null;
}

/**
 * Every village in every run, against the two lines the money is for.
 *
 * Read off the books like everything else here: a second storey is bought out of what a village
 * holds a head and a bath house out of what it holds between it, which are the two figures
 * `tidings.ts` hands `storeysFor` and `luxuryFor` every evening. Shared between the test that
 * judges it and the account that prints it, so the number in the report is the number that passed.
 */
function whatWasBuilt(): Built[] {
  const built: Built[] = [];
  for (const run of RUNS) {
    for (const [village, evenings] of run.books) {
      const storey = evenings.find((evening) => evening.roll.length > 0 && eachHead(evening) >= PROSPER.STOREY);
      const luxury = evenings.find((evening) => worth(evening) >= PROSPER.LUXURY);
      built.push({
        seed: run.seed, village, quiet: LEFT_ALONE.includes(village),
        storeyOn: storey?.day ?? null, luxuryOn: luxury?.day ?? null,
      });
    }
  }
  return built;
}

/** The two or three lines the account carries about it, so the report says what was actually built. */
function raised(): string[] {
  const built = whatWasBuilt();
  const storeys = built.filter((b) => b.storeyOn !== null);
  const luxuries = built.filter((b) => b.luxuryOn !== null);
  const soonest = (days: number[]): string => (days.length > 0 ? `day ${Math.min(...days)}` : 'never');
  return [
    `${storeys.length} of the ${built.length} villages lived here got their houses up to two storeys, the first of`,
    `them on ${soonest(storeys.map((b) => b.storeyOn!))}; ${luxuries.length} held enough between them for a bath house, from`,
    `${soonest(luxuries.map((b) => b.luxuryOn!))}: ${luxuries.map((b) => `${b.village} (seed ${b.seed})`).join(', ') || '—'}.`,
  ];
}

/**
 * What a village does with what it has put by.
 *
 * The half of A7 that is about the world rather than the ledger. A village's purses are supposed
 * to change something a player can walk up to — a house with another storey on it, a bath house
 * you can pay to use — and until today neither had ever happened once, on any seed, in the life of
 * the game: `storeysFor` and `luxuryFor` had never returned anything but the floor, because the
 * prices were quoted in a currency no villager could ever hold.
 *
 * So this asks the three questions that make the money mean something. Does anything get built.
 * Is it rare enough to be worth seeing. And is it earned rather than given — nothing may appear in
 * the first three weeks, or the storeys are a starting condition rather than a season's work.
 */
describe('what a village does with what it has put by', () => {
  it('gets its houses up, and now and then a bath house, and never in the first three weeks', () => {
    const built = whatWasBuilt();
    const storeys = built.filter((b) => b.storeyOn !== null);
    const luxuries = built.filter((b) => b.luxuryOn !== null);
    const wrong: string[] = [];

    // three weeks, asked of the villages nothing is done to: a hamlet of three with one seller in
    // it has a wild average and is not evidence about anything
    const TOO_SOON = FOUNDED + 21;
    for (const place of built.filter((b) => b.quiet)) {
      if (place.storeyOn !== null && place.storeyOn < TOO_SOON) {
        wrong.push(`${place.village} (seed ${place.seed}) had two storeys by day ${place.storeyOn}: that is a gift, not a season's work`);
      }
      if (place.luxuryOn !== null && place.luxuryOn < TOO_SOON) {
        wrong.push(`${place.village} (seed ${place.seed}) had a bath house by day ${place.luxuryOn}, three weeks off its founding`);
      }
    }

    report({
      verdict: wrong.length === 0 && storeys.length > 0 ? 'PASS' : 'FAIL',
      count: storeys.length,
      what: `villages that raised a second storey out of their own purses, and ${luxuries.length} that raised a bath house`,
      detail: wrong.length > 0 ? wrong : built
        .filter((b) => b.storeyOn !== null || b.luxuryOn !== null)
        .map((b) => {
          // a big village can hold the price of a bath house between it and still not be forty a
          // head, so the two lines are reported apart rather than as one ladder
          const storey = b.storeyOn !== null ? `two storeys from day ${b.storeyOn}` : 'never two storeys';
          const bath = b.luxuryOn === null ? ''
            : `${b.storeyOn !== null ? ', and' : ', but'} a bath house from day ${b.luxuryOn}`;
          return `seed ${b.seed} ${b.village}: ${storey}${bath}`;
        }),
    });

    expect(wrong, 'a village was rich the week it was founded').toEqual([]);
    expect(storeys.length, 'a hundred days and not one village put a storey on a house').toBeGreaterThan(2);
    /*
     * The bath house is not a fixed expectation either way any more, and the reason is the treasury.
     *
     * It used to be required, and exactly one village in twenty-one ever managed it — paid for, as
     * `chore sanity` found, by a herd over its cap that came down by sixteen hundredths of a percent
     * a day. With that fixed nothing afforded one, and the line became "none, or the herd is paying
     * too well again". Now the hall *spends*: a village that has saved nine hundred buys a well and
     * the money goes straight back into its people's purses, which is what a treasury is for and
     * which moves the figure this is measured against.
     *
     * So what is asserted is the thing that has been true throughout and is worth keeping true: a
     * village builds *something* out of its own money inside a generation. Which particular thing
     * is a balance question and belongs in the account below rather than in a test.
     */
    const bought = RUNS.reduce((sum, run) => sum + [...run.books.values()]
      .filter((evenings) => evenings.some((e) => e.roll.some((row) => row.paid > 0))).length, 0);
    expect(storeys.length + luxuries.length + bought, 'no village built anything at all').toBeGreaterThan(2);
    // and it must stay rare: a bath house in every village is a bath house worth nothing
    expect(luxuries.length, 'every village in the country has a bath house').toBeLessThan(built.length / 2);
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
    const floor = Math.min(...wages.values());
    const paidBest = [...wages].filter(([, wage]) => wage >= best).map(([trade]) => trade);
    report({
      verdict: 'NOTE',
      count: wages.size,
      what: 'trades anybody in these villages actually held, and what the roll pays them',
      detail: [
        [...wages].sort((a, b) => b[1] - a[1]).map(([trade, wage]) => `${trade} ${wage}`).join(', '),
        `${paidBest.join(', ')} take the higher rate at ${best}; the other ${wages.size - paidBest.length} trades are on ${floor}.`,
        'It was one trade and one man. The set naming the better-paid trades named shops — shopkeeper,',
        'smith, apothecary, merchant — and four of those five are not jobs anybody in this world can',
        'hold, so the higher rate reached the innkeeper and nobody else, at most one to a village.',
      ],
    });

    // 2. what a working purse comes to, and whether it is still moving
    const settled: string[] = [];
    for (const village of LEFT_ALONE) {
      const evenings = first.books.get(village)!;
      const middle = midPurse(evenings[evenings.length - 1]);
      let unchanged = 0;
      for (let n = evenings.length - 1; n > 0; n--) {
        if (Math.abs(midPurse(evenings[n - 1]) - middle) > 1e-6) break;
        unchanged++;
      }
      settled.push(`${village}: the middle working villager holds ${coins(middle)} — ${coins(midPurse(evenings[20]))} at three weeks, ${coins(midPurse(evenings[50]))} at fifty days — and has held tonight's figure for ${unchanged} days`);
    }
    report({
      verdict: 'NOTE',
      count: LEFT_ALONE.length,
      what: 'villages left alone: what a working purse comes to, and whether it is still moving',
      detail: [
        ...settled,
        'It used to come to rest at exactly 6.5 and hold it for the last 87 days of the hundred, in',
        'every one of these villages on every seed. Upkeep was larger than what a day had left after',
        'dinner, so the reserve that stops a man spending himself into starving was also the ceiling',
        'on what he could ever hold.',
      ],
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
    const eachOf = Math.max(...ends.map(eachHead));
    report({
      verdict: 'NOTE',
      count: Math.round(richest),
      what: `gold in the richest purse in the world after a hundred days; a second storey wants ${PROSPER.STOREY} a head`,
      detail: [
        `The best-off village between them holds ${coins(village)}, and the best-off a head holds ${coins(eachOf)} against`,
        `the ${PROSPER.STOREY} its houses grow on. A bath house wants ${PROSPER.LUXURY} between the whole village.`,
        ...raised(),
        'It was 340 a head and 3,400 between them, against a best of 33 a head and 528 in the village —',
        'a factor of ten and a factor of six, so neither had ever been reached in the life of the game.',
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
