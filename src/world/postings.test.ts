import { describe, expect, it } from 'vitest';
import { POST, POSTINGS, couldStand, postsToday, turnedAway, wageForAGuard, wagesOwed } from './postings';
import { PROSPER } from './prosperity';
import type { Person } from './people';

/**
 * Work somebody is engaged to do that is not their own — a builder's job and a farmer's guard,
 * which turned out to be one thing.
 *
 * Both items asked the same question in different words: **how does work get paid for when the
 * worker may die?** An escrow answers it for a fee and a daily wage answers it for a wage, and the
 * answer this world already had is better than either — `whoStandsWatch` remembers nothing between
 * days, so a village that buries its watchman has somebody else up the tower in the morning and
 * nothing had to notice.
 *
 * So these are about the property that makes both items true at once: **a post belongs to the
 * holding and not to the man standing it.** Nothing is stored, so nothing can dangle.
 */

let next = 0;
function villager(trade: string, purse: number): Person {
  next++;
  return {
    id: `p${String(next).padStart(3, '0')}`, name: `Person ${next}`, village: 'Ashford',
    sex: 'woman', trade, born: -30, lives: 70, mother: '', father: '', knows: [],
    memories: [], opinions: [], purse, hungry: 0,
  };
}

const farm = (id: string, owner: string) => ({ id, kind: 'farm', owner });

describe('who stands a post this morning', () => {
  it('posts nobody at all when there is nothing overhead', () => {
    /*
     * Not a saving to be made but the absence of a reason. A farm with an empty sky has no use for
     * a man with a stick, and a wage paid in peacetime would be a subscription rather than the
     * decision item 39 is about.
     */
    const owner = villager('farmer', 400);
    expect(wageForAGuard(0)).toBe(0);
    expect(postsToday([owner, villager('soldier', 5)], [farm('f1', owner.id)], 0)).toEqual([]);
  });

  it('asks more for a day of it the worse the thing overhead is', () => {
    // the bill and the threat arrive together, which is what makes it a choice at the moment both
    // are most expensive rather than a standing cost
    expect(wageForAGuard(1)).toBeGreaterThan(wageForAGuard(0.2));
    expect(wageForAGuard(0.2)).toBeGreaterThan(0);
    // and never under what the man would have earned doing anything else, or nobody would take it
    expect(wageForAGuard(0.01)).toBeGreaterThan(PROSPER.A_DAY);
  });

  it('asks the soldiers first, which is the point of the whole item', () => {
    /*
     * Item 39's own answer. A soldier's wage today is invented beyond the village — the polite way
     * of saying nobody pays it — and this gives the one trade whose business is standing about with
     * a weapon somebody who actually wants him. A village does not take its doctor off his surgery
     * to do it, and one post each: one soldier and two farms guards one farm, which is the honest
     * answer and reads from the road as what it is.
     */
    const one = villager('farmer', 400), two = villager('farmer', 400);
    const soldier = villager('soldier', 20);
    const posts = postsToday(
      [one, two, soldier, villager('doctor', 400), villager('', 5)],
      [farm('f1', one.id), farm('f2', two.id)],
      1,
    );
    expect(posts).toHaveLength(2);
    expect(posts[0].who, 'the soldier was passed over for the odd-job man').toBe(soldier.id);
    expect(posts[0].funder).toBe(one.id);
  });

  it('will not put a child on a gate with a dragon overhead', () => {
    /*
     * The trap in "whoever has nothing else to do": in this world almost everybody with no trade is
     * a child, because a trade comes with growing up. A village short of soldiers falls back to its
     * grown idlers and never to its nine-year-olds.
     */
    const owner = villager('farmer', 400);
    const child = { ...villager('', 0), born: 90 };
    const grownIdler = { ...villager('', 0), born: -40 };
    const today = 100;
    expect(postsToday([owner, child], [farm('f1', owner.id)], 1, today)).toEqual([]);
    expect(postsToday([owner, grownIdler], [farm('f1', owner.id)], 1, today)).toHaveLength(1);
  });

  it('puts the same man on the same gate on two machines that never spoke', () => {
    // nothing is stored, so the only thing keeping two clients agreeing is that the choosing is
    // deterministic. Taken in id order, which is the same order everywhere
    const owner = villager('farmer', 400);
    const hands = [villager('soldier', 5), villager('soldier', 5), villager('soldier', 5)];
    const here = postsToday([owner, ...hands], [farm('f1', owner.id)], 0.8);
    const there = postsToday([owner, ...[...hands].reverse()], [farm('f1', owner.id)], 0.8);
    expect(here).toEqual(there);
  });

  it('leaves a poor farm unguarded and a rich one guarded, which is the decision', () => {
    /*
     * A farmer will lay out a fifth of what he holds and no more. Without that the first bad
     * morning empties him — a guard is sixteen gold with a dragon overhead and a villager holds
     * tens — and a farmer who paid his last coin to save a cow would be a man who starves to keep
     * his herd, which is not a decision anybody makes.
     */
    const poor = villager('farmer', 10), rich = villager('farmer', 400);
    const posts = postsToday(
      [poor, rich, villager('soldier', 5), villager('soldier', 5)],
      [farm('poor', poor.id), farm('rich', rich.id)],
      1,
    );
    expect(posts.map((post) => post.funder)).toEqual([rich.id]);
    expect(wageForAGuard(1)).toBeGreaterThan(poor.purse * POST.LAYS_OUT);
  });

  it('posts nobody where there is nobody left to ask', () => {
    // a village of farmers and tradesmen has nobody to spare, and the answer is that the cattle
    // take their chances rather than that somebody is conjured
    const owner = villager('farmer', 400);
    expect(postsToday([owner, villager('doctor', 90)], [farm('f1', owner.id)], 1)).toEqual([]);
  });
});

describe('what the post is worth to the man who paid for it', () => {
  it('turns back a share of a raid for each man on the gate, and never more than all of it', () => {
    // a man with a stick does not send a dragon home, and pretending otherwise would make one guard
    // the answer to everything. Three do not send back four cows out of three
    const guard = { kind: 'guard', holding: 'f1', who: 'a', funder: 'b', wage: 12 };
    expect(turnedAway([], 9), 'cattle came back with nobody watching them').toBe(0);
    expect(turnedAway([guard], 9)).toBe(3);
    expect(turnedAway([guard, guard], 9)).toBe(6);
    expect(turnedAway([guard, guard, guard, guard], 9)).toBe(9);
    expect(turnedAway([guard], 0)).toBe(0);
  });

  it('rounds a saved beast down, because half a cow saved is a cow that was taken', () => {
    const guard = { kind: 'guard', holding: 'f1', who: 'a', funder: 'b', wage: 12 };
    expect(turnedAway([guard], 2)).toBe(0);
    expect(turnedAway([guard], 4)).toBe(1);
  });

  it('bills each farmer for his own men and nobody else for them', () => {
    const one = villager('farmer', 400), two = villager('farmer', 400);
    const posts = postsToday(
      [one, two, villager('soldier', 5), villager('soldier', 5)],
      [farm('f1', one.id), farm('f2', two.id)],
      1,
    );
    const owed = wagesOwed(posts);
    expect(owed.get(one.id)).toBe(wageForAGuard(1));
    expect(owed.get(two.id)).toBe(wageForAGuard(1));
    expect([...owed.values()].reduce((sum, much) => sum + much, 0))
      .toBe(posts.reduce((sum, post) => sum + post.wage, 0));
  });
});

describe('the seat the builder will sit in', () => {
  it('is in the table already, with the thing that decides who may take it', () => {
    /*
     * Item 37 in one row. A builder's job is a post on the yard, funded by the hall rather than by
     * a villager, and who takes it is whoever knows how to build — which is `canDo`, asked here.
     * It is left empty in the way `SORTS` left the yard and the boat empty and said so: a job is a
     * holding this world does not raise yet, and when it does, nothing here changes.
     */
    const crew = POSTINGS.find((posting) => posting.kind === 'crew')!;
    expect(crew.on).toBe('yard');
    expect(couldStand(villager('builder', 0), crew), 'a builder could not take a building job').toBe(true);
    expect(couldStand(villager('farmer', 0), crew), 'a farmer was handed a building job').toBe(false);
    // and a guard is work anybody can do, which is why a village posts its spare hands
    const guard = POSTINGS.find((posting) => posting.kind === 'guard')!;
    expect(couldStand(villager('soldier', 0), guard)).toBe(true);
  });
});
