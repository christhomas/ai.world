import { describe, expect, it } from 'vitest';
import { Mines, type Working } from './mines';
import { ORE, Ore, keptBack, worthOfOre } from './ore';
import { MINING, freshMine, restOvernight } from './mining';
import type { Person } from '../world/people';

/**
 * The stone a village keeps for its own forge, and the one rule it has to obey.
 *
 * Nothing may be minted. A mine yields what a mine yields; a village with a forge gets some of it
 * as stone rather than as nuggets and works the place out sooner. That is the whole design, and
 * everything below is a way of failing if it stops being true.
 */
const MINE = 'cave:1';
const ASHFORD = 'Ashford';

const working = (): Working => ({ village: ASHFORD, mine: MINE, name: 'Ash Hole', x: 0, z: 0, heardIn: [ASHFORD] });
const crew = (): Person[] => ([1, 2].map((n) => ({
  id: `m${n}`, name: `Miner ${n}`, village: ASHFORD, sex: 'm', trade: 'miner',
  born: 0, lives: 80, mother: '', father: '', knows: [], memories: [], opinions: [], purse: 0, hungry: 0,
} as unknown as Person)));

describe('what a shift sets aside', () => {
  it('carries the part-piece instead of flooring it away', () => {
    /*
     * The fault the carry exists for, and the first version of this had it. A day at a fresh face
     * is worth twenty-six and a piece of ore is worth thirty-four, so a fifth of a day floored is
     * nought — every day, for ever, in every village. The feature did nothing and nothing failed.
     */
    expect(Math.floor((MINING.A_DAY * ORE.KEPT_BACK) / worthOfOre()), 'a day on its own is not a piece').toBe(0);
    let carry = 0, got = 0;
    for (let day = 0; day < 40; day++) {
      const kept = keptBack(MINING.A_DAY, carry);
      carry = kept.carry;
      got += kept.ore;
    }
    expect(got, 'forty days of a fifth is several pieces').toBeGreaterThan(2);
  });

  it('charges the seam exactly what the stone was worth', () => {
    // the books balance on what actually came out, not on the share it was rounded from
    const kept = keptBack(1000, 0);
    expect(kept.spent).toBe(kept.ore * worthOfOre());
    expect(kept.carry).toBeLessThan(worthOfOre());
  });

  it('works a mine out sooner where there is a forge, and by exactly the stone', () => {
    /*
     * The conservation, stated as the only thing that matters: two identical days, one with a
     * forge and one without, differ in the seam by what the forge took and in nothing else.
     */
    const plain = restOvernight(freshMine(MINE), { gold: 100, scared: false, lost: false, dropped: 0 });
    const forged = restOvernight(freshMine(MINE), { gold: 100, scared: false, lost: false, dropped: 0 }, 68);
    expect(forged.worked - plain.worked).toBe(68);
  });

  it('gives a village with no forge nothing at all, which is the point of it', () => {
    const mines = new Mines(7, 1);
    const dug = mines.advance(30, [working()], () => crew());
    expect(dug.every((one) => one.ore === 0), 'stone with nobody to work it').toBe(true);
  });

  it('pays the crew the same for the same day, and spends the seam instead', () => {
    /*
     * Where the cost actually falls, and it is worth being exact because the obvious reading is
     * wrong. Nothing is deducted from a day's takings: the same day at the same face pays the same
     * gold with a forge as without, which is the first assertion.
     *
     * What the stone costs is the *mine*. `worked` rises by what the ore was worth, so every day
     * after it is worth slightly less, and over a month the forged village has earned less gold
     * and has a heap of stone instead. That is not a leak — it is the seam being spent on
     * something other than nuggets, which is the whole design.
     */
    const plain = new Mines(7, 1).advance(30, [working()], () => crew());
    const forged = new Mines(7, 1).advance(30, [working()], () => crew(), () => true);
    expect(forged[0].gold, 'the first day is the same day').toBe(plain[0].gold);

    const stone = forged.reduce((sum, one) => sum + one.ore, 0);
    expect(stone, 'a month of shifts is some stone').toBeGreaterThan(0);

    const goldPlain = plain.reduce((sum, one) => sum + one.gold, 0);
    const goldForged = forged.reduce((sum, one) => sum + one.gold, 0);
    expect(goldForged, 'the seam paid for the stone').toBeLessThan(goldPlain);
    expect(goldPlain - goldForged, 'and it did not pay more than the stone is worth')
      .toBeLessThanOrEqual(stone * worthOfOre());
  });

  it('remembers the part-piece through a save', () => {
    // it is a running total of days and there is nowhere else that remembers a mine between them
    const mines = new Mines(7, 1);
    mines.advance(10, [working()], () => crew(), () => true);
    const back = Mines.from(7, JSON.parse(JSON.stringify(mines.save())));
    const on = back.advance(20, [working()], () => crew(), () => true);
    const fresh = Mines.from(7, JSON.parse(JSON.stringify(mines.save())));
    expect(on.reduce((s, one) => s + one.ore, 0)).toBe(
      fresh.advance(20, [working()], () => crew(), () => true).reduce((s, one) => s + one.ore, 0),
    );
  });
});

describe('the heap by the adit', () => {
  it('starts a village that has had a seam and a forge for years with something in it', () => {
    const heap = new Ore();
    heap.minedThrough(ASHFORD, 4, 1);
    expect(heap.at(ASHFORD), 'a week of four miners at a quarter a day').toBeGreaterThan(0);
  });

  it('takes all of a piece of work or none of it', () => {
    const heap = new Ore();
    heap.land(ASHFORD, 3);
    expect(heap.draw(ASHFORD, 5)).toBe(false);
    expect(heap.at(ASHFORD), 'nothing was taken').toBe(3);
    expect(heap.shortBy(ASHFORD, 5)).toBe(2);
  });

  it('remembers what a player sold here after the forge has spent it', () => {
    const heap = new Ore();
    heap.brought(ASHFORD, 10);
    expect(heap.draw(ASHFORD, 10)).toBe(true);
    expect(heap.sold(ASHFORD), 'the hauling is not forgotten by the spending').toBe(10);
  });
});
