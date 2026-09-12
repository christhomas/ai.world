import { describe, expect, it } from 'vitest';
import { GROWTH, housesStanding, roomFor, whatTheVillageBuilds, whatTheVillageSpends } from './growth';
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

const worker = (id: string): Person => ({ id, trade: 'farmer' } as Person);
const idle = (id: string): Person => ({ id, trade: '' } as Person);
const crowd = (many: number, make = worker): Person[] =>
  Array.from({ length: many }, (_, n) => make(`p${n}`));
const paid = (wages: Map<string, number>): number =>
  Math.round([...wages.values()].reduce((sum, much) => sum + much, 0) * 100) / 100;

/** A village of six roofs, full to the last bed, with money in the hall and the ground to grow on. */
const full = { laidOut: 6, holds: 18, purse: GROWTH.A_HOUSE + WATCH_WAGE };

describe('what a house costs a village', () => {
  it('is the wage bill for raising one: a crew, for as long as it takes, at a building rate', () => {
    const aDayOfBuilding = WATCH_WAGE * (PROSPER.TRADED / PROSPER.A_DAY);
    expect(GROWTH.A_HOUSE).toBe(GROWTH.A_HOUSEFUL * 6 * aDayOfBuilding);
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

  it('holds a couple and their children, which is what a house is founded with', () => {
    expect(GROWTH.A_HOUSEFUL).toBe(2 + LIFE.CHILDREN);
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
    expect(housesStanding(6, ['well', 'house', 'storey', 'house'])).toBe(8);
  });
});

describe('when a village raises a house', () => {
  it('does it when it is full, has the ground and can pay', () => {
    const raised = whatTheVillageBuilds(full.purse, [], full.laidOut, full.holds, crowd(18));
    expect(raised).not.toBeNull();
    expect(raised!.costs).toBe(GROWTH.A_HOUSE);
    expect(raised!.holdsMore).toBe(GROWTH.A_HOUSEFUL);
  });

  it('does not while there is a spare bed, however much is in the hall', () => {
    // the pace is set by how fast a village fills, not by how rich it is: a place with somewhere to
    // put the next child puts them there rather than building
    expect(whatTheVillageBuilds(1e9, [], full.laidOut, full.holds, crowd(17))).toBeNull();
  });

  it('does not once the ground has run out, however long it has saved', () => {
    const built = Array.from({ length: roomFor(full.laidOut) - full.laidOut }, () => 'house');
    expect(housesStanding(full.laidOut, built)).toBe(roomFor(full.laidOut));
    expect(whatTheVillageBuilds(1e9, built, full.laidOut, 99, crowd(99))).toBeNull();
  });

  it('does not if it could not still pay the man on the tower afterwards', () => {
    const short = GROWTH.A_HOUSE + WATCH_WAGE - 0.01;
    expect(whatTheVillageBuilds(short, [], full.laidOut, full.holds, crowd(18))).toBeNull();
    expect(whatTheVillageBuilds(short + 0.01, [], full.laidOut, full.holds, crowd(18))).not.toBeNull();
  });

  it('does not with nobody to build it, because a house is not raised by wishing', () => {
    const children = crowd(18, idle);
    expect(whatTheVillageBuilds(1e9, [], full.laidOut, full.holds, children)).toBeNull();
  });

  it('pays every coin of it back to the people who raised it', () => {
    // the village builds with its own hands, so nothing is minted and nothing is burnt — which is
    // the same guarantee `whatTheHallBuys` gives and the thing the economy audit reads
    const raised = whatTheVillageBuilds(full.purse, [], full.laidOut, 7, crowd(7))!;
    expect(paid(raised.wages)).toBe(GROWTH.A_HOUSE);
    expect(raised.wages.size).toBe(7);
  });

  it('pays only the people who hold a trade', () => {
    const people = [worker('a'), idle('b'), worker('c'), ...crowd(15, idle)];
    const raised = whatTheVillageBuilds(full.purse, [], full.laidOut, full.holds, people)!;
    expect([...raised.wages.keys()].sort()).toEqual(['a', 'c']);
  });
});

describe('everything a village spends on one morning', () => {
  it('puts the roof before the wish list, and still pays the watchman', () => {
    // rich enough for a well twice over, and it builds a house instead: a village houses its people
    // before it pleases them, and one building a morning is the hall's own rule kept
    const rich = WORKS[0].costs * 2;
    const spending = whatTheVillageSpends(rich, ['watchtower'], full.laidOut, full.holds, crowd(18));
    expect(spending.works).toEqual(['house']);
    expect(spending.holdsMore).toBe(GROWTH.A_HOUSEFUL);
    expect(spending.spent).toBe(GROWTH.A_HOUSE + WATCH_WAGE);
    expect(spending.watch).not.toBe('');
    expect(paid(spending.wages)).toBe(spending.spent);
  });

  it('goes back to buying what the hall wants the moment there is nowhere left to build', () => {
    const built = Array.from({ length: roomFor(full.laidOut) - full.laidOut }, () => 'house');
    const spending = whatTheVillageSpends(WORKS[0].costs, built, full.laidOut, 99, crowd(99));
    expect(spending.works).toEqual([WORKS[0].id]);
    expect(spending.holdsMore).toBe(0);
  });

  it('changes nothing at all on a morning a village can afford nothing', () => {
    const spending = whatTheVillageSpends(0, [], full.laidOut, full.holds, crowd(18));
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
  const live = (laidOut: number, aDay: number, mornings: number) => {
    const built: string[] = [];
    let purse = 0, holds = laidOut * 3, people = holds;
    for (let morning = 0; morning < mornings; morning++) {
      purse += aDay * people;                    // more people is more earners is more tax
      const spending = whatTheVillageSpends(purse, built, laidOut, holds, crowd(people));
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
    expect(plain.holds).toBe(18 + (plain.houses - 6) * GROWTH.A_HOUSEFUL);
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
});
