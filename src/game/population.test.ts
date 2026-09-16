import { reportAt } from '../../tools/reports';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIFE } from '../world/people';
import {
  DAYS, FOUNDED, LEFT_ALONE, RUNS, VILLAGES, at, coins, who, type Books, type Run,
} from './economy.bench';

/**
 * What happens to the people, as against what happens to their money.
 *
 * `economy.test.ts` audits a hundred days of books to the coin and can say that 537 people died
 * and that seven villages out of twenty-one emptied. It cannot say why any of it happened, because
 * a ledger of purses has nothing in it about who was born, who paired, who reached sixteen or what
 * a village was refused when it wanted to build. A population that quietly fails to replace itself
 * looks exactly like a population that is fine, right up until the last funeral.
 *
 * So this reads the same run for a different question. It judges by the books as the audit does —
 * the roll and the births book, which is what a player pays a clerk to see — and it works out from
 * them the numbers nobody has ever had: how many children a couple actually has, how many of them
 * live to be adults, how old people are when they die, and how much of a village's life is spent
 * with every bed in it full.
 *
 * ## Replacement here is exactly 2.0
 *
 * The real-world figure is 2.1 children per woman; the tenth covers the sex ratio at birth and the
 * women who do not live to the end of childbearing. Neither applies here — children in this world
 * die of nothing but starvation — so a couple needs two children who reach sixteen, and no more.
 *
 * That number is worth holding on to while reading what follows, because `roofsOf` lays every
 * village out with `STANDARD` roofs, and a standard roof holds a couple and exactly two children.
 * Every village in the world therefore begins at precisely replacement, with no headroom for a
 * parent who dies early, a household that cannot pair, or somebody who walks to the next valley.
 *
 * ## What this deliberately does not do
 *
 * It does not fail when a village dies out. Item #248 is where that is being decided, and a bench
 * that goes red before the thing it is measuring has been fixed is a bench somebody turns off. The
 * die-outs are reported, named and counted here; the FAIL belongs with the fix.
 */

/** Where the run leaves its account of itself. Printed by `chore population`. */
const REPORT = reportAt('population-report.txt');

interface Line {
  verdict: 'PASS' | 'FAIL' | 'NOTE';
  count: number;
  what: string;
  detail?: string[];
}

const covered: Line[] = [];
const report = (line: Line): void => { covered.push(line); };

/** What this world needs from a couple for a village to stand still. See the note above. */
const REPLACEMENT = 2;

/**
 * How old somebody has to be, in days, before they count as grown.
 *
 * In **days**, and the emphasis is the whole of a bug this file had on the morning it was written.
 * `RollRow.age` is in *years* — `yearsOld` divides by `DAYS_IN_A_YEAR`, which is 40 — so a villager
 * who lives the longest life this world allows dies aged 2. Read as days, that said every funeral
 * in the world was a two-day-old child and that not one person had ever reached sixteen, which is
 * exactly the sort of number somebody reports before checking it.
 *
 * So nothing here reads `age`. A person's age is `day - born`, in the unit `LIFE` is written in,
 * taken from the books that carry both.
 */
const GROWN = LIFE.CHILD_UNTIL;

/** And the age past which a death is plainly old age rather than anything a village did wrong. */
const ELDERLY = LIFE.SHORTEST_LIFE;

/** The villages something is deliberately done to, which must not be read as ordinary. */
const STRESSED = new Set(VILLAGES.filter((v) => !LEFT_ALONE.includes(v.village)).map((v) => v.village));

/** Every village in every run, as one list, so a section reads the world rather than a seed. */
function everywhere(): Array<{ run: Run; village: string; evenings: Books[] }> {
  return RUNS.flatMap((run) => [...run.books.entries()].map(([village, evenings]) => ({
    run, village, evenings,
  })));
}

/** Who was on the roll that evening, by the name-and-birthday the books identify people with. */
const rollOf = (books: Books): Map<string, Books['roll'][number]> =>
  new Map(books.roll.map((row) => [who(row), row]));

describe('who is born, and who lives to be anybody', () => {
  /**
   * The number this whole file exists to produce.
   *
   * Children are attributed to a couple rather than to a mother, because a roof holds a couple and
   * it is the roof that limits them — so the question the world's design actually poses is how many
   * children come out of one household, not how many one woman has.
   */
  it('counts children per couple, and how many of them reach sixteen', () => {
    const perCouple: number[] = [];
    const grownPerCouple: number[] = [];
    const childless: string[] = [];

    for (const { run, village, evenings } of everywhere()) {
      // every child the books ever recorded here, with the couple the roll says they belong to
      const children = new Map<string, { mother: string; father: string; oldest: number }>();
      for (const books of evenings) {
        for (const row of books.roll) {
          if (!row.mother && !row.father) continue;      // founding adults have no parents on the roll
          const id = who(row);
          // days, not `row.age`, which is years: see the note on GROWN
          const days = books.day - row.born;
          const had = children.get(id);
          if (had) had.oldest = Math.max(had.oldest, days);
          else children.set(id, { mother: row.mother, father: row.father, oldest: days });
        }
      }

      const couples = new Map<string, { born: number; grown: number }>();
      for (const child of children.values()) {
        const couple = `${child.mother} & ${child.father}`;
        const tally = couples.get(couple) ?? { born: 0, grown: 0 };
        tally.born++;
        if (child.oldest >= GROWN) tally.grown++;
        couples.set(couple, tally);
      }

      for (const tally of couples.values()) {
        perCouple.push(tally.born);
        grownPerCouple.push(tally.grown);
      }
      if (couples.size === 0) childless.push(at(run, village, FOUNDED + DAYS));
    }

    const mean = (all: number[]): number => (all.length === 0 ? 0 : all.reduce((a, b) => a + b, 0) / all.length);
    const bornEach = mean(perCouple);
    const grownEach = mean(grownPerCouple);

    report({
      verdict: 'NOTE',
      count: perCouple.length,
      what: `couples that had a child at all, averaging ${coins(bornEach)} children each, of whom ${coins(grownEach)} reached ${GROWN}`,
      detail: [
        `Replacement in this world is exactly ${REPLACEMENT}, because nothing kills a child here but hunger.`,
        `So the number to read is the second one: ${coins(grownEach)} against ${REPLACEMENT}.`,
        ...(childless.length > 0
          ? [`${childless.length} village-runs recorded no birth to any couple at all: ${childless.slice(0, 6).join('; ')}`]
          : []),
      ],
    });

    // the bench is a measurement and not yet a bound: see the note at the top of this file
    expect(perCouple.length).toBeGreaterThan(0);
  });

  /**
   * How old people are when they go, which is the other half of whether a village holds together.
   *
   * A world where everybody dies of age is a world whose population is set by its roofs. A world
   * where a quarter of the funerals are children is a different world with a different fix, and
   * until now nothing anywhere could tell the two apart.
   */
  it('counts how old everybody was when they died', () => {
    let asChild = 0, asAdult = 0, old = 0;
    const youngest: string[] = [];

    for (const { run, village, evenings } of everywhere()) {
      const restarted = run.restarted.get(village) ?? new Set<number>();
      for (let n = 1; n < evenings.length; n++) {
        // a village that was founded again is two different sets of people with some shared names
        if (restarted.has(evenings[n].day)) continue;
        const now = rollOf(evenings[n]);
        for (const row of evenings[n - 1].roll) {
          if (now.has(who(row))) continue;
          const days = evenings[n - 1].day - row.born;
          if (days < GROWN) {
            asChild++;
            if (youngest.length < 6) youngest.push(`${row.name}, ${days} days old, in ${at(run, village, evenings[n].day)}`);
          } else if (days < ELDERLY) asAdult++;
          else old++;
        }
      }
    }

    report({
      verdict: 'NOTE',
      count: asChild + asAdult + old,
      what: `funerals: ${old} of old age, ${asAdult} of grown people short of sixty, ${asChild} of children`,
      detail: asChild > 0
        ? ['A child dies here only of hunger, so any of these is a village that could not feed itself:', ...youngest]
        : ['No child died anywhere in a hundred days, in any village, on any seed.'],
    });

    expect(asChild + asAdult + old).toBeGreaterThan(0);
  });
});

describe('what a village has room for, against what it holds', () => {
  /**
   * How much of a village's life is spent with every bed full.
   *
   * This is the fertility gate said as a number. `whoCouldHaveAChild` skips any family whose roof
   * is full, so a village at its own ceiling is a village where nobody may have a child — and a
   * village that spends most of its life there is one whose births are limited by carpentry rather
   * than by anything a player would recognise as a reason.
   */
  it('counts the mornings a village had no bed to put a child in', () => {
    const full: string[] = [];
    let atCeiling = 0, evenings = 0;

    for (const run of RUNS) {
      for (const [village, standing] of run.standing) {
        const shut = standing.filter((s) => s.souls > 0);
        if (shut.length === 0) continue;
        const packed = shut.filter((s) => s.souls >= s.room).length;
        atCeiling += packed;
        evenings += shut.length;
        const share = packed / shut.length;
        if (share > 0.5) {
          full.push(`${at(run, village, FOUNDED + DAYS)}: full on ${Math.round(share * 100)}% of its evenings (${packed} of ${shut.length})`);
        }
      }
    }

    report({
      verdict: 'NOTE',
      count: atCeiling,
      what: `village-evenings with every bed full, out of ${evenings} lived — ${Math.round((atCeiling / Math.max(1, evenings)) * 100)}% of the world's nights`,
      detail: full.length > 0
        ? ['Villages that spent more than half their lives with nowhere to put a child:', ...full]
        : ['No village spent half its life at its own ceiling.'],
    });

    expect(evenings).toBeGreaterThan(0);
  });

  /**
   * Whether a village ever built its way out of it.
   *
   * A standard roof holds two children, which is exactly replacement; a longhouse holds four, and
   * is the only way in the game for a village to do better than break even. So the day a village
   * raises its first extra roof is the day it becomes able to grow at all, and a village that never
   * raises one is a village living on a coin toss for a hundred days.
   */
  it('counts the roofs a village raised, and the day it first managed one', () => {
    const never: string[] = [];
    const first: string[] = [];

    for (const run of RUNS) {
      for (const [village, standing] of run.standing) {
        const lived = standing.filter((s) => s.souls > 0);
        if (lived.length === 0) continue;
        const start = lived[0].buildings;
        const raised = lived.findIndex((s) => s.buildings > start);
        if (raised < 0) never.push(`${village} (seed ${run.seed})`);
        else first.push(`${village} (seed ${run.seed}) on day ${lived[raised].day}, reaching ${lived[lived.length - 1].buildings} buildings by day ${FOUNDED + DAYS}`);
      }
    }

    report({
      verdict: 'NOTE',
      count: first.length,
      what: `villages that raised anything at all in a hundred days, against ${never.length} that never did`,
      detail: [...first, ...(never.length > 0 ? [`Never raised a thing: ${never.join(', ')}`] : [])],
    });

    expect(first.length + never.length).toBeGreaterThan(0);
  });

  /**
   * And the ones that ended.
   *
   * Reported rather than judged, for the reason at the top of this file. What the report has to
   * make plain is which of them were being leaned on and which were simply left alone — a hamlet of
   * one house and a village under a warband are meant to be hard, and an ordinary village quietly
   * running out of people is the thing #248 is about.
   */
  it('names the villages that emptied, and says which were left alone', () => {
    const quiet: string[] = [];
    const pressed: string[] = [];

    for (const run of RUNS) {
      for (const [village, standing] of run.standing) {
        const last = standing[standing.length - 1];
        if (!last || last.souls > 0) continue;
        const emptied = standing.find((s) => s.souls === 0)?.day ?? last.day;
        const before = standing.filter((s) => s.day < emptied && s.souls > 0).pop();
        const line = `${village} (seed ${run.seed}) emptied on day ${emptied}; ten days earlier it held ${before?.souls ?? 0} of ${before?.room ?? 0} beds with ${before?.food ?? 0} meals in store`;
        (STRESSED.has(village) ? pressed : quiet).push(line);
      }
    }

    report({
      verdict: 'NOTE',
      count: quiet.length + pressed.length,
      what: `villages that died out, ${quiet.length} of them with nothing done to them at all`,
      detail: [
        ...(quiet.length > 0 ? ['Left alone, and still gone:', ...quiet] : ['Every village left alone was still standing on day 101.']),
        ...(pressed.length > 0 ? ['Raided, bare, or a hamlet of one house — hard on purpose:', ...pressed] : []),
      ],
    });

    expect(quiet.length + pressed.length).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Written to a file rather than logged, because a passing test's output is swallowed and the run
 * that passed is the whole point. `chore population` prints it.
 */
describe('the account of itself', () => {
  it('writes what it found', () => {
    const lines = [
      `POPULATION BENCH — ${new Date().toISOString()}`,
      '',
      `  ${VILLAGES.length} villages on ${RUNS.length} seeds, ${DAYS} days each, read out of their own roll`,
      '  and births book. Nothing here judges: item #248 is where the decision goes.',
      '',
      ...covered.map((line) => [
        `  ${line.verdict.padEnd(6)}${String(line.count).padStart(8)}  ${line.what}`,
        ...(line.detail ?? []).map((d) => `                    ${d}`),
      ].join('\n')),
      '',
      '  Written by src/game/population.test.ts. Run it again with: chore population',
      '',
    ].join('\n');
    writeFileSync(REPORT, lines);
    expect(covered.length).toBeGreaterThan(0);
  });
});
