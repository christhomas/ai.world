import { describe, expect, it } from 'vitest';
import { FOOD, broughtIn, grownInADay } from './food';
import { aDaysTrade, whoFed } from './livelihoods';
import { aDaysFishing, coastOf } from './harvest';
import { LIFE, type Person } from './people';

/**
 * What a coast eats, which is the second way food has ever reached a village.
 *
 * There has been exactly one until now — the herd — and everything about how a village lives has
 * been shaped by it: a farm is capital, it grows towards a cap on its own, it can be wiped out by
 * wolves and it takes a month to come back. A coast is not that, and these are about the two ways
 * it differs, because a fishing village that is only a farm with a boat is not worth the harbour.
 *
 * **The shellfish are a floor.** Gathered off the rocks by anybody with a bucket, so they are per
 * head rather than per trade, they want no boat and no jetty, and they are what makes a coastal
 * hamlet on a rock survive where an inland one starves. It never makes it rich: half a meal a head
 * against a meal eaten.
 *
 * **The fish are the paid half, and they are capped by hulls.** A village's catch is what its boats
 * land, not what its fishermen would like to land — which is what makes a harbour an investment
 * rather than a decoration, and it is the first source of outside money in this economy that
 * somebody *decided* to have.
 */

let next = 0;
function villager(trade: string): Person {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Sandhaven', sex: 'woman', trade,
    born: -30, lives: 70, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse: 40, hungry: 0,
  };
}

/** A village of this many souls, all of them holding the trade named. */
const folk = (trade: string, many: number): Person[] =>
  Array.from({ length: many }, () => villager(trade));

describe('shellfish, which is the floor', () => {
  it('feeds everybody on a shore a little, whatever they do for a living', () => {
    // per head and not per trade, because a child with a bucket at low water brings back what a
    // soldier would. It is the one thing in this economy nobody is employed to do
    const soldier = villager('soldier');
    expect(broughtIn(soldier, true) - broughtIn(soldier, false)).toBe(FOOD.PER_SHORE);
    const child = villager('');
    expect(broughtIn(child, true) - broughtIn(child, false)).toBe(FOOD.PER_SHORE);
  });

  it('is what lets a hamlet on a rock live where the same hamlet inland dies', () => {
    /*
     * The whole reason fishing villages exist, said as arithmetic. A village with no farmer grows
     * `PER_HEAD` a head and eats `MEAL` a head, so inland it breaks exactly even and the first
     * week anybody is ill it is eating its store. On a shore the same village runs half a meal a
     * head to the good for ever.
     */
    const people = folk('sailor', 10);
    const inland = grownInADay(people, 0, 0, false);
    const coastal = grownInADay(people, 0, 0, true);
    expect(inland).toBe(people.length * FOOD.MEAL);
    expect(coastal).toBeGreaterThan(people.length * FOOD.MEAL);
    expect(coastal - inland).toBe(people.length * FOOD.PER_SHORE);
  });

  it('never makes anybody rich, which is the other half of being a floor', () => {
    // half a meal a head against a farmer's four. A coast is somewhere to settle when the ground
    // is poor, not a better farm — and a fishing village that out-earned a farming one would have
    // made the whole of the rest of this economy pointless
    expect(FOOD.PER_SHORE).toBeLessThan(FOOD.PER_FARMER);
    expect(FOOD.PER_SHORE).toBeLessThan(FOOD.MEAL);
  });
});

describe('the catch, which is the paid half', () => {
  it('is capped by the hulls a village keeps rather than by the men who would crew them', () => {
    /*
     * The one thing it shares with the paddocks, and the reason a harbour is an investment: more
     * boats is more fish, where more fishermen alone is only more people standing on a jetty.
     */
    expect(aDaysFishing(2, 5).meals).toBe(2 * FOOD.PER_BOAT);
    expect(aDaysFishing(5, 2).meals).toBe(2 * FOOD.PER_BOAT);
    expect(aDaysFishing(0, 5).meals, 'fish were landed without a boat').toBe(0);
    expect(aDaysFishing(5, 0).meals, 'a boat went out with nobody in it').toBe(0);
  });

  it('has no stock behind it, which is what makes a coast unlike a farm', () => {
    /*
     * Cattle breed and a shoal does not belong to anybody. So there is nothing to run down and
     * nothing to build up: a boat that goes out lands a day's fish and a boat that stays in lands
     * nothing, and tomorrow is exactly the same offer. What that buys is a village whose income has
     * no memory — a farm ruined by wolves takes a month to come back, and a fleet that missed a
     * week has missed a week.
     */
    const monday = aDaysFishing(2, 2);
    const tuesday = aDaysFishing(2, 2);
    expect(tuesday).toEqual(monday);
    // and a week idle costs it nothing at all: the offer on the eighth day is the offer on the first
    expect(aDaysFishing(2, 2)).toEqual(monday);
  });

  it('brings money in from outside the valley, which a harbour had better do', () => {
    // a jetty is 340 gold and 30 lengths of timber, and the thing it unlocks has to pay for itself
    expect(aDaysFishing(1, 1).gold).toBeGreaterThan(0);
    expect(aDaysFishing(2, 2).gold).toBe(aDaysFishing(1, 1).gold * 2);
  });
});

describe('a village on a coast, over one day', () => {
  it('reads its shore off its trades and its boats off its holdings', () => {
    /*
     * Nothing new is stored, which is what lets a village be re-lived from its founding and arrive
     * at the same coast. A place that can raise a fisherman is a place with water at its door.
     */
    expect(coastOf({}).shore, 'a village with no trades had a shore').toBe(false);
    expect(coastOf({ trades: ['farmer', 'fisherman'] }).shore).toBe(true);
    expect(coastOf({ trades: ['fisherman'], holdings: [{ kind: 'farm' }, { kind: 'boat' }] }).boats)
      .toBe(1);
  });

  it('changes nothing at all for a village nobody has told about a coast', () => {
    /*
     * The property that makes this safe to land before the register passes anything. `aDaysTrade`
     * defaults to an inland village, so every place in the world goes on living exactly the day it
     * lived yesterday until one word is added at the one call site.
     */
    const people = folk('farmer', 6);
    const told = aDaysTrade(people, 12, 0, {});
    const untold = aDaysTrade(people, 12, 0);
    expect(untold.grown).toBe(told.grown);
    expect(untold.fish).toBe(0);
    expect(untold.shore).toBe(false);
  });

  it('feeds a fishing village better than the same village inland, and pays its crews', () => {
    const people = [...folk('fisherman', 3), ...folk('seller', 5)];
    const sea = { trades: ['fisherman'], holdings: [{ kind: 'boat' }, { kind: 'boat' }] };
    const coast = aDaysTrade(people, 0, 0, sea);
    const inland = aDaysTrade(people, 0, 0);

    expect(coast.grown).toBeGreaterThan(inland.grown);
    expect(coast.fish, 'two boats and three men landed the wrong number').toBe(2 * FOOD.PER_BOAT);
    // and the money for what went to the next valley is the crews', the way the meat is the
    // farmers': it came off their boats
    const paidToCrew = people.slice(0, 3).reduce((sum, p) => sum + (coast.paid.get(p.id) ?? 0), 0);
    const paidInland = people.slice(0, 3).reduce((sum, p) => sum + (inland.paid.get(p.id) ?? 0), 0);
    expect(paidToCrew).toBeGreaterThan(paidInland);
  });

  it('shares the catch among the fishermen and the shellfish among everybody', () => {
    /*
     * What somebody is paid for the village's dinner is what they put into it. A fisherman put in
     * his boat, so the catch is his and his crewmates'; the shellfish are nobody's in particular
     * and are already in every single share.
     */
    const people = [...folk('fisherman', 2), ...folk('soldier', 2)];
    const fed = whoFed(people, 0, true, 10);
    const crew = fed.get(people[0].id) ?? 0;
    const soldier = fed.get(people[2].id) ?? 0;
    expect(crew).toBeGreaterThan(soldier);
    expect(soldier, 'a soldier on a shore gathered nothing').toBe(FOOD.PER_HEAD + FOOD.PER_SHORE);
    expect(crew).toBe(FOOD.PER_HEAD + FOOD.PER_SHORE + 10 / 2);
  });

  it('leaves a coastal village with the larder that lets its families have children', () => {
    /*
     * The join that makes this a reason for a village to exist rather than a number going up. A
     * family that is going hungry is not asking for a nursery — `roofs.ts` gates children on the
     * larder — so a coast that feeds itself is a coast that *grows* where an inland rock does not.
     */
    const people = folk('sailor', 8);
    const coast = aDaysTrade(people, 0, 0, { trades: ['fisherman'] });
    const inland = aDaysTrade(people, 0, 0);
    const eaten = people.length * FOOD.MEAL;
    expect(inland.grown - eaten, 'an inland village of idlers was putting food by').toBe(0);
    expect(coast.grown - eaten, 'a coastal village could not put anything by').toBeGreaterThan(0);
    expect(LIFE.CHILDREN, 'children are what a larder is for').toBeGreaterThan(0);
  });
});
