import { describe, expect, it } from 'vitest';
import { GROWTH, costOfARoof, housesStanding, roomFor, whatTheVillageBuilds, whatTheVillageSpends } from './growth';
import { ROOFS, STANDARD, holdsFor, isARoof, roofOfWork, roofsOf, workOf } from './roofs';
import { WATCH_WAGE, WORKS } from './hall';
import { PROSPER } from './prosperity';
import { LIFE, type Person } from './people';

/**
 * A village that could get rich and could not get bigger.
 *
 * Births only ever backfilled the dead, so every village in the world stayed exactly the size it
 * was laid out at however well it did — a treasury with thousands in it, eleven people working, and
 * nowhere for any of it to go. What is pinned here is the loop that ends that: houses are the cap,
 * a full village saves for another, the village raises it and is paid for raising it, and then it
 * grows into it and pays more tax.
 *
 * And the brake, which is the thing worth having: a village only has the ground it was laid out on,
 * so one in a narrow valley runs out of room while one on a plain keeps going, and neither of them
 * was told to.
 */

/** Somebody grown, working and fed, in a household of their own number. */
const soul = (n: number, each: number, trade = 'farmer', family = ''): Person => ({
  id: `${family}p${n}`, name: `Given${n} ${family || `Family${Math.floor(n / each)}`}`,
  trade, born: 0, hungry: 0,
} as Person);

/** A village's people, in households of a roofful apiece. */
const crowd = (many: number, each = STANDARD.holds, trade = 'farmer'): Person[] =>
  Array.from({ length: many }, (_, n) => soul(n, each, trade));

/** Or households of stated sizes, for the occasions where which family is which is the point. */
const families = (...sizes: readonly number[]): Person[] =>
  sizes.flatMap((many, family) => Array.from({ length: many }, (_, n) => ({
    id: `f${family}p${n}`, name: `Given${n} Family${family}`, trade: 'farmer', born: 0, hungry: 0,
  } as Person)));

const paid = (wages: Map<string, number>): number =>
  Math.round([...wages.values()].reduce((sum, much) => sum + much, 0) * 100) / 100;

/** Enough in the cellar that food is never the thing being tested. */
const STOCKED = 1e6;
/** And the day these villages are living, by which everybody founded on day nought is grown. */
const TODAY = LIFE.CHILD_UNTIL + 1;

/** Six roofs as a village is laid out with them, full to the last bed, with the ground to grow on. */
const WANTED = ROOFS[2];                      // one rung up from what a village is laid out with
const full = { laidOut: 6, holds: holdsFor(6, []), purse: costOfARoof(WANTED) + WATCH_WAGE };
const townsfolk = crowd(full.holds);

describe('what a house costs a village', () => {
  it('is the wage bill for raising one: a crew, for as long as it takes, at a building rate', () => {
    const aDayOfBuilding = WATCH_WAGE * (PROSPER.TRADED / PROSPER.A_DAY);
    expect(GROWTH.A_HOUSE).toBe(STANDARD.holds * 6 * aDayOfBuilding);
  });

  it('lands within a whisker of what a builder charges the hero for the same job', () => {
    // 420 is `BUILD.PRICE` in `game/building.ts`, arrived at years ago on entirely different
    // reasoning and unreachable from here because the world may not read the game. Two price
    // systems that cannot see each other agreeing is the best evidence either of them is right.
    expect(Math.abs(GROWTH.A_HOUSE - 420) / 420).toBeLessThan(0.05);
  });

  it('is under the cheapest thing on the hall wish list, so a roof beats a luxury', () => {
    expect(GROWTH.A_HOUSE).toBeLessThan(WORKS[0].costs);
  });

  it('goes by the room in it, so a village gets the same room for the same money either way', () => {
    for (const roof of ROOFS) {
      expect(costOfARoof(roof) / roof.holds, roof.id).toBe(GROWTH.A_HOUSE / STANDARD.holds);
    }
    // and a bigger roof costs more, which is the only reason a poor village builds a small one
    expect(costOfARoof(ROOFS[0])).toBeLessThan(costOfARoof(ROOFS[ROOFS.length - 1]));
  });
});

describe('how much room a village has', () => {
  it('reads the ground off the founding, so a valley and a plain grow differently', () => {
    // `structures.ts` tries eighty plots and keeps whatever the footprint check will have, so the
    // count a village was laid out with *is* the ground's verdict on it. Nobody wrote a rule
    // saying the narrow one should stay small; it simply has less room.
    const valley = 3, plain = 6;
    expect(roomFor(valley)).toBeLessThan(roomFor(plain));
    expect(roomFor(plain)).toBe(plain * GROWTH.ROOM);
  });

  it('counts the houses it has raised out of what it has built, and nothing else', () => {
    expect(housesStanding(6, [])).toBe(6);
    expect(housesStanding(6, ['well', 'house', 'storey', workOf(ROOFS[0])])).toBe(8);
  });
});

describe('when a village raises a house', () => {
  it('does it when it is full, has the ground and can pay', () => {
    const raised = whatTheVillageBuilds(full.purse, [], full.laidOut, full.holds, townsfolk, STOCKED);
    expect(raised).not.toBeNull();
    expect(raised!.costs).toBe(costOfARoof(WANTED));
    expect(raised!.holdsMore).toBe(WANTED.holds);
  });

  it('does not while there is a spare bed, however much is in the hall', () => {
    // the pace is set by how fast a village fills, not by how rich it is: a place with somewhere to
    // put the next child puts them there rather than building
    const room = crowd(full.holds - 1);
    expect(whatTheVillageBuilds(1e9, [], full.laidOut, full.holds, room, STOCKED)).toBeNull();
  });

  it('does not once the ground has run out, however long it has saved', () => {
    const built = Array.from({ length: roomFor(full.laidOut) - full.laidOut }, () => workOf(STANDARD));
    expect(housesStanding(full.laidOut, built)).toBe(roomFor(full.laidOut));
    const packed = crowd(holdsFor(full.laidOut, built));
    expect(whatTheVillageBuilds(1e9, built, full.laidOut, packed.length, packed, STOCKED)).toBeNull();
  });

  it('does not if it could not still pay the man on the tower afterwards', () => {
    const short = full.purse - 0.01;
    expect(whatTheVillageBuilds(short, [], full.laidOut, full.holds, townsfolk, STOCKED)).toBeNull();
    expect(whatTheVillageBuilds(full.purse, [], full.laidOut, full.holds, townsfolk, STOCKED)).not.toBeNull();
  });

  it('does not with nobody to build it, because a house is not raised by wishing', () => {
    const children = crowd(full.holds, STANDARD.holds, '');
    expect(whatTheVillageBuilds(1e9, [], full.laidOut, full.holds, children, STOCKED)).toBeNull();
  });

  it('does not while the store is too low to feed another mouth', () => {
    // the larder used to gate this with a flat "is the cellar half full". It gates it now by
    // nobody in the village wanting a nursery, which comes to the same thing on a morning like
    // this one and to something far more honest on every other
    expect(whatTheVillageBuilds(1e9, [], full.laidOut, full.holds, townsfolk, 0)).toBeNull();
  });

  it('does not while the families who have run out of room are going hungry', () => {
    const lean = crowd(full.holds).map((person) => ({ ...person, hungry: 2 }));
    expect(whatTheVillageBuilds(1e9, [], full.laidOut, full.holds, lean, STOCKED)).toBeNull();
  });

  it('pays every coin of it back to the people who raised it', () => {
    // the village builds with its own hands, so nothing is minted and nothing is burnt — which is
    // the same guarantee `whatTheHallBuys` gives and the thing the economy audit reads
    const small = crowd(holdsFor(2, []));
    const raised = whatTheVillageBuilds(full.purse, [], 2, small.length, small, STOCKED)!;
    expect(paid(raised.wages)).toBe(raised.costs);
    expect(raised.wages.size).toBe(small.length);
  });

  it('pays only the people who hold a trade', () => {
    const people = crowd(full.holds);
    for (const person of people.slice(2)) person.trade = '';
    const raised = whatTheVillageBuilds(full.purse, [], full.laidOut, full.holds, people, STOCKED)!;
    expect([...raised.wages.keys()].sort()).toEqual(['p0', 'p1']);
  });
});

/**
 * What size goes up, which is the half of this that makes a village a place rather than a count.
 *
 * One rung up from the best roof over anybody who has run out of room, because the point of
 * building is more room than they had. And nothing smaller when it cannot afford that, for the
 * reason `nextWork` saves for the cheapest thing it has not got rather than skipping to something
 * it can reach today: a list you may skip about in is not a ladder. So being poor costs a village
 * its pace and never its shape, and a skyline is a history rather than a purchase.
 */
describe('what size a village builds', () => {
  const sizeBuilt = (purse: number, built: string[] = []) => {
    const people = crowd(holdsFor(full.laidOut, built));
    return whatTheVillageBuilds(purse, built, full.laidOut, people.length, people, STOCKED)?.roof ?? null;
  };

  it('saves for the size it needs rather than putting up something smaller', () => {
    // enough for a house twice over and it builds nothing, because a house is not more room than
    // the families asking for it already have
    expect(sizeBuilt(costOfARoof(ROOFS[1]) + WATCH_WAGE)).toBeNull();
    expect(sizeBuilt(costOfARoof(WANTED) + WATCH_WAGE)?.id).toBe(WANTED.id);
  });

  it('will not leap a rung, however rich the hall is', () => {
    // a village laid out in houses builds a longhouse next, not a great house: the ladder is
    // climbed, and that is what makes a skyline a history rather than a purchase
    expect(sizeBuilt(1e9)?.id).toBe('longhouse');
  });

  it('reaches the great houses once a family has filled a longhouse', () => {
    // one house and one longhouse, each with a family in it that has run out of room. The best roof
    // over anybody who is asking is the longhouse, so the next thing up is the thing above it
    const built = [workOf(ROOFS[2])];
    const people = families(ROOFS[1].holds, ROOFS[1].holds, ROOFS[2].holds);
    const raised = whatTheVillageBuilds(1e9, built, 2, people.length, people, STOCKED);
    expect(raised?.roof.id).toBe('greathouse');
  });

  it('writes the size down, so a village re-lived comes out the same size it was', () => {
    const raised = whatTheVillageBuilds(1e9, [], full.laidOut, full.holds, townsfolk, STOCKED)!;
    const spending = whatTheVillageSpends(1e9, [], full.laidOut, full.holds, townsfolk, STOCKED);
    // the size that went up, which is what this is about — the entry also carries the morning it
    // was begun now, and that is `roofs.test.ts`'s business rather than this one's
    expect(spending.works.map(roofOfWork)).toEqual([raised.roof]);
    expect(spending.works.every(isARoof)).toBe(true);
    expect(holdsFor(full.laidOut, spending.works)).toBe(full.holds + raised.roof.holds);
  });
});

describe('everything a village spends on one morning', () => {
  it('puts the roof before the wish list, and still pays the watchman', () => {
    // rich enough for a well twice over, and it builds a house instead: a village houses its people
    // before it pleases them, and one building a morning is the hall's own rule kept
    const rich = WORKS[0].costs * 2;
    const spending = whatTheVillageSpends(rich, ['watchtower'], full.laidOut, full.holds, townsfolk, STOCKED);
    expect(spending.works.every(isARoof)).toBe(true);
    expect(spending.works.length).toBe(1);
    expect(spending.holdsMore).toBeGreaterThan(0);
    expect(spending.watch).not.toBe('');
    expect(paid(spending.wages)).toBe(spending.spent);
  });

  it('goes back to buying what the hall wants the moment there is nowhere left to build', () => {
    const built = Array.from({ length: roomFor(full.laidOut) - full.laidOut }, () => workOf(STANDARD));
    const packed = crowd(holdsFor(full.laidOut, built));
    const spending = whatTheVillageSpends(WORKS[0].costs, built, full.laidOut, packed.length, packed, STOCKED);
    expect(spending.works).toEqual([WORKS[0].id]);
    expect(spending.holdsMore).toBe(0);
  });

  it('changes nothing at all on a morning a village can afford nothing', () => {
    const spending = whatTheVillageSpends(0, [], full.laidOut, full.holds, townsfolk, STOCKED);
    expect(spending.spent).toBe(0);
    expect(spending.works).toEqual([]);
    expect(spending.holdsMore).toBe(0);
    expect(spending.wages.size).toBe(0);
  });
});

/**
 * The loop, turned by hand.
 *
 * The register lives the days and moves the coins; what is checked here is the shape of what comes
 * out of it when it does. A village is handed a morning's tax, a morning at a time, and the three
 * things worth knowing are that it grows, that it grows into what it builds, and that it stops —
 * because the ground stops it and not because a counter ran out.
 */
describe('a village left alone with a tax take', () => {
  /** The village's people, household by household, filling its roofs in the order it has them. */
  const living = (laidOut: number, built: readonly string[], many: number): Person[] =>
    roofsOf(laidOut, built).flatMap((roof, at) => {
      const under = Math.max(0, Math.min(roof.holds, many - roofsOf(laidOut, built)
        .slice(0, at).reduce((sum, one) => sum + one.holds, 0)));
      return Array.from({ length: under }, (_, n) => soul(n, 1, 'farmer', `Family${at}`));
    });

  const live = (laidOut: number, aDay: number, mornings: number) => {
    const built: string[] = [];
    let purse = 0, holds = holdsFor(laidOut, built), people = holds;
    for (let morning = 0; morning < mornings; morning++) {
      purse += aDay * people;                    // more people is more earners is more tax
      const spending = whatTheVillageSpends(
        purse, built, laidOut, holds, living(laidOut, built, people), STOCKED);
      purse = Math.round((purse - spending.spent) * 100) / 100;
      built.push(...spending.works);
      holds += spending.holdsMore;
      people = Math.min(holds, people + 1);      // births fill what the roofs will hold
    }
    return { houses: housesStanding(laidOut, built), holds, people, built };
  };

  it('grows, and grows into what it has built', () => {
    const plain = live(6, 0.5, 400);
    expect(plain.houses, 'four hundred mornings of tax and not one house').toBeGreaterThan(6);
    // every roof it raised is full, which is the whole of what "houses are the cap" buys
    expect(plain.holds).toBe(holdsFor(6, plain.built));
    expect(plain.people).toBe(plain.holds);
  });

  it('stops where the ground stops, and spends what is left on what it wants', () => {
    const plain = live(6, 0.5, 4000);
    expect(plain.houses).toBe(roomFor(6));
    // and with nowhere left to build, the hall goes back to its own list and works down it
    expect(plain.built).toContain(WORKS[0].id);
  });

  it('leaves the village in the narrow valley smaller than the one on the plain, for ever', () => {
    const valley = live(3, 0.5, 4000);
    const plain = live(6, 0.5, 4000);
    expect(valley.houses).toBeLessThan(plain.houses);
    expect(valley.people).toBeLessThan(plain.people);
    // neither of them was told to be the size it is: one had room for six houses and one for three
    expect(valley.houses).toBe(roomFor(3));
  });

  it('climbs the ladder, so the same village is a different shape at the end of it', () => {
    const grown = live(6, 0.5, 4000).built.filter(isARoof);
    // it starts with longhouses, because that is one rung up from what it was laid out with, and
    // ends with great houses, because by then somebody has filled a longhouse
    expect(roofOfWork(grown[0])).toBe(ROOFS[2]);
    expect(roofOfWork(grown[grown.length - 1])).toBe(ROOFS[3]);
  });

  it('is slower when it is poor, and ends up the same shape anyway', () => {
    const poor = live(6, 0.08, 800).built.filter(isARoof);
    const rich = live(6, 0.8, 800).built.filter(isARoof);
    expect(poor.length).toBeLessThan(rich.length);
    expect(poor[0]).toBe(rich[0]);
  });
});
