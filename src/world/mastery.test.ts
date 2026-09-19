import { describe, expect, it } from 'vitest';
import { FIELD, fieldWork } from './fields';
import { FOOD, broughtIn } from './food';
import { ownedBy } from './holdings';
import { aDaysTrade } from './livelihoods';
import { aDaysPractice, handOf } from './mastery';
import { LIFE, foundVillage, type Person } from './people';
import { PROSPER } from './prosperity';

/**
 * A hand that learns the work it was raised to.
 *
 * A trade was a name on `Person.trade` and nothing else, so a farmer of forty days put exactly the
 * same four meals on the table as one who came of age this morning. A village that buried its only
 * farmer raised the next adult into the gap and the books did not notice — which made a funeral
 * free, made `vacancies.ts` a formality, and made a village's yield a fact about its trade list
 * rather than about the people on it.
 *
 * These hold the shape of the answer as much as its arithmetic, because the shape is the part that
 * was argued over:
 *
 * - **Nothing in the world got bigger.** `FOOD.PER_FARMER` still means what its comment says — what
 *   one farmer puts on the table — and a practised farmer puts exactly that on it. What changed is
 *   that a hand new to the work falls short of it until he has learned it. `rank.ts` records the
 *   principle that a bigger place has things a smaller one has not got *rather than larger numbers*,
 *   and a mastery expressed as a bonus would have been the first multiplier in the economy.
 * - **It is a fact about a pair of hands, never about a holding.** The paddocks hold what the
 *   paddocks hold and the boats land what the boats land, whoever is standing in them.
 * - **And nobody is practised at a kitchen garden.** The shellfish on the rocks are already written
 *   down as the one thing nobody is employed to do; a child with a bucket brings back what a soldier
 *   would, and now what a master farmer would too.
 */

/**
 * Days at a trade after which there is nothing further to learn.
 *
 * Written down here rather than imported, because `mastery.ts` offers no constant to import: a
 * table exported for its own tests to read is exactly what `reachable.test.ts` counts as work that
 * fell out of the program. The first assertion below pins this number against the curve, so the two
 * cannot drift apart without something going red.
 */
const MASTERED = 40;

let next = 0;
/** Somebody at a trade, with however many days of it behind them. */
function villager(trade: string, worked?: number): Person {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Hollowbeck', sex: 'man', trade, worked,
    born: -30, lives: 70, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse: 40, hungry: 0,
  };
}

describe('a hand that learns', () => {
  it('has nothing further to teach anybody after forty days of it', () => {
    expect(handOf(villager('farmer', MASTERED))).toBe(1);
    expect(handOf(villager('farmer', MASTERED - 1))).toBeLessThan(1);
    expect(handOf(villager('farmer', 0))).toBeLessThan(handOf(villager('farmer', MASTERED - 1)));
  });

  it('feeds the village better after forty days at it than on the first morning', () => {
    // the sentence the issue is named for, as arithmetic
    const grown = villager('farmer', 0);
    const practised = villager('farmer', MASTERED);
    expect(broughtIn(practised)).toBeGreaterThan(broughtIn(grown));
  });

  it('never carries a practised hand past the number the trade is written down as', () => {
    // the whole of the argument with `rank.ts`: nothing here makes a number bigger than it was
    const practised = villager('farmer', MASTERED);
    const lifetime = villager('farmer', MASTERED * 10);
    expect(broughtIn(practised)).toBe(FOOD.PER_HEAD + FOOD.PER_FARMER);
    expect(broughtIn(lifetime)).toBe(broughtIn(practised));
  });

  it('takes a hunter the same way it takes a farmer', () => {
    expect(broughtIn(villager('hunter', MASTERED))).toBeGreaterThan(broughtIn(villager('hunter', 0)));
    expect(broughtIn(villager('hunter', MASTERED))).toBe(FOOD.PER_HEAD + FOOD.PER_HUNTER);
  });

  it('leaves the garden and the rocks exactly where they were', () => {
    /*
     * A kitchen garden is a household's and the shellfish are anybody's, so neither is a thing to
     * get good at. A soldier of forty days brings back what a soldier of one day does, on a shore
     * and off it.
     */
    for (const shore of [false, true]) {
      expect(broughtIn(villager('soldier', 0), shore))
        .toBe(broughtIn(villager('soldier', MASTERED), shore));
    }
    // and the practised farmer's shore is still half a meal, not half a practised meal
    expect(broughtIn(villager('farmer', 0), true) - broughtIn(villager('farmer', 0), false))
      .toBe(FOOD.PER_SHORE);
  });

  it('takes somebody whose days nobody has counted at the trade\'s own number', () => {
    /*
     * `null` and nought are different answers here exactly as they are in `whoFed`: a person with no
     * days against their name is not a novice, they are somebody nobody asked about. Every villager
     * in a lived village has the days counted; a caller standing a person up out of thin air wants
     * what `FOOD.PER_FARMER` has always meant.
     */
    expect(broughtIn(villager('farmer'))).toBe(FOOD.PER_HEAD + FOOD.PER_FARMER);
    expect(handOf(villager('farmer'))).toBe(1);
  });
});

describe('what counts as a day of practice', () => {
  it('counts a day the village actually worked', () => {
    const people = [villager('farmer', 0), villager('hunter', 3)];
    aDaysPractice(people, 0);
    expect(people.map((p) => p.worked)).toEqual([1, 4]);
  });

  it('counts nothing on a day nobody could go out', () => {
    // the same threshold the work itself stops at: people who are being buried are not in the
    // fields, and a fortnight under a warband is a fortnight nobody learned anything in
    const people = [villager('farmer', 6)];
    aDaysPractice(people, PROSPER.UNTROUBLED + 0.1);
    expect(people[0].worked).toBe(6);
  });

  it('counts nothing for a man who is laid up', () => {
    const hurt = { ...villager('farmer', 6), hurt: 2 };
    aDaysPractice([hurt], 0);
    expect(hurt.worked).toBe(6);
  });

  it('leaves a child alone, because a child holds no trade to be practised at', () => {
    const child = villager('', 0);
    aDaysPractice([child], 0);
    expect(child.worked).toBe(0);
  });
});

describe('what it does to a village', () => {
  it('makes a day of work a fact about the people rather than about the trade list', () => {
    const green = [villager('farmer', 0), villager('farmer', 0), villager('hunter', 0)];
    const seasoned = green.map((p) => ({ ...p, worked: MASTERED }));
    expect(aDaysTrade(seasoned, 0, 0).grown).toBeGreaterThan(aDaysTrade(green, 0, 0).grown);
  });

  it('makes losing the only master a real loss', () => {
    // what `vacancies.ts` was missing teeth for: the village replaces its dead farmer the next
    // morning and the fields notice
    const others = [villager('seller', MASTERED), villager('miner', MASTERED)];
    const master = aDaysTrade([...others, villager('farmer', MASTERED)], 0, 0).grown;
    const novice = aDaysTrade([...others, villager('farmer', 0)], 0, 0).grown;
    expect(novice).toBeLessThan(master);
  });

  it('pays a man standing in a farm for the hand he has rather than for the trade he holds', () => {
    /*
     * The half of #384 that made it its own issue. A village with holdings counts its crop per
     * *farm* — one entry per gate, because a cleared acre is an improvement to a holding — and a
     * farm is capital, which this file's own argument says does not get better at anything. The
     * hand standing in it does. So the rate the day hands over is the man's and not the trade's:
     * wired the other way round, a novice would be paid a master's crop while being fed a novice's,
     * which is the same mismatch #384 exists to remove wearing the other coat.
     *
     * Four acres against each gate as well, so the two halves can be told apart: the acres are the
     * same for both men and only the base yield moves.
     */
    const green = villager('farmer', 0);
    const master = villager('farmer', MASTERED);
    const acres = [green, master].flatMap((who) =>
      Array.from({ length: FIELD.MOST }, (_, n) => fieldWork(`farm-${who.id}`, n, 0)));
    const day = aDaysTrade([green, master], 0, 0, {
      holdings: [green, master].map((who) => ({
        id: `farm-${who.id}`, kind: 'farm', owner: ownedBy(who), worker: who.id,
      })),
      works: acres,
    });
    const cleared = FIELD.MOST * FIELD.FOOD;
    expect(cleared, 'the acres are counted, or the difference below proves nothing').toBeGreaterThan(0);
    expect(day.fields.get(ownedBy(master))).toBeCloseTo(FOOD.PER_FARMER + cleared, 10);
    expect(day.fields.get(ownedBy(green)))
      .toBeCloseTo(FOOD.PER_FARMER * handOf(green) + cleared, 10);
    // the ground each of them stands on is identical, so the whole of the gap is the hand
    expect(day.fields.get(ownedBy(master))! - day.fields.get(ownedBy(green))!)
      .toBeCloseTo(FOOD.PER_FARMER * (1 - handOf(green)), 10);
    // and the larder took what the gates were credited with, so nobody is fed by a second number
    expect(day.grown).toBeCloseTo(2 * FOOD.PER_HEAD + 2 * cleared
      + FOOD.PER_FARMER * (1 + handOf(green)), 10);
  });

  it('founds a village whose grandparents already know their work', () => {
    /*
     * A founder is handed an age, and the days behind them follow from it with nothing rolled —
     * which is the whole reason this shape was chosen over any other. A village founded with
     * grandparents in it has practised hands on day one; a village of its own children does not,
     * and has to wait for them.
     */
    const people = foundVillage(11, 'Hollowbeck', 4, ['farmer', 'seller', 'miner']);
    const grown = people.filter((p) => p.trade !== '');
    expect(grown.length).toBeGreaterThan(0);
    for (const person of grown) {
      expect(person.worked).toBe(Math.max(0, -person.born - LIFE.CHILD_UNTIL));
    }
    expect(grown.some((p) => (p.worked ?? 0) > 0)).toBe(true);
    // and nobody who has not grown up yet has a day against their name
    for (const child of people.filter((p) => p.trade === '')) expect(child.worked).toBe(0);
  });
});
