import { describe, expect, it } from 'vitest';
import { BUILD, Houses, builderIn, canBuildAt, deposit, isFinished, owed, progressOf, saidOfJob, stageAt, type Commission } from './building';
import { GRUDGE } from './grudge';

const job = (began = 10): Commission => ({
  id: 'house:1', x: 20, z: 20, village: 'Ashford', began, paid: deposit(), price: BUILD.PRICE,
});

/**
 * Everything in this world belonged to somebody else — you could sleep in an inn and drink in a
 * pub and none of it was ever yours. This is the first thing that stays where you put it.
 */
describe('having a house built', () => {
  it('is nothing at all on the day it is commissioned', () => {
    expect(progressOf(job(), 10)).toBe(0);
    expect(stageAt(job(), 10)).toBe('pegs');
  });

  it('goes up in recognisable stages rather than inflating', () => {
    const j = job();
    const seen = [0, 2, 4, 6].map((d) => stageAt(j, 10 + d));
    expect(seen).toEqual(['pegs', 'frame', 'roof', 'house']);
  });

  it('takes days, so it is a thing being built rather than a purchase', () => {
    expect(isFinished(job(), 10 + BUILD.DAYS - 1)).toBe(false);
    expect(isFinished(job(), 10 + BUILD.DAYS)).toBe(true);
  });

  it('asks for the rest of the money only when it is done', () => {
    expect(owed(job(), 12)).toBe(0);
    expect(owed(job(), 10 + BUILD.DAYS)).toBe(BUILD.PRICE - deposit());
  });

  it('wants less up front than the whole price, or it is not a deposit', () => {
    expect(deposit()).toBeGreaterThan(0);
    expect(deposit()).toBeLessThan(BUILD.PRICE);
  });

  it('refuses ground that will not take a house', () => {
    const no = canBuildAt(0, 0, false, { x: 0, z: 0 }, []);
    expect(no.ok).toBe(false);
  });

  it('refuses a plot with no village to send a builder from', () => {
    expect(canBuildAt(0, 0, true, null, []).ok).toBe(false);
  });

  it('refuses somewhere nobody would walk to every morning', () => {
    expect(canBuildAt(BUILD.WITHIN + 50, 0, true, { x: 0, z: 0 }, []).ok).toBe(false);
  });

  it('refuses to put one on top of what is already standing', () => {
    expect(canBuildAt(10, 10, true, { x: 0, z: 0 }, [{ x: 12, z: 10 }]).ok).toBe(false);
  });

  it('takes a clear plot near a village', () => {
    expect(canBuildAt(10, 10, true, { x: 0, z: 0 }, [{ x: 60, z: 60 }]).ok).toBe(true);
  });

  /**
   * 2026-09-05: added because the first house put up in the running game had an oak through the
   * middle of the roof. A tree is not a structure and so is not in `standing`, and the ground it
   * grows on is perfectly flat, so every other check here happily said yes.
   */
  it('refuses a plot with a tree standing in the middle of it', () => {
    const no = canBuildAt(10, 10, true, { x: 0, z: 0 }, [], false);
    expect(no.ok).toBe(false);
    expect(no.ok === false && no.why).toContain('growing');
  });

  it('counts the days down out loud, and asks for the money at the end', () => {
    expect(saidOfJob(job(), 11)).toContain('days');
    expect(saidOfJob(job(), 10 + BUILD.DAYS - 1)).toContain('One more day');
    expect(saidOfJob(job(), 10 + BUILD.DAYS)).toContain('finished');
  });
});

/**
 * A house that vanishes when you close the tab is a prop. Everything below is about the parts of
 * a commission that have to survive being written to disk and read back: the builder you are
 * holding, the day work started, the balance, and whatever you left in the box.
 */
describe('a commission that outlives the session', () => {
  const reload = (h: Houses): Houses => Houses.from(JSON.parse(JSON.stringify(h.toJSON())));

  it('remembers a builder taken on before there is anywhere to put the house', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit());
    expect(reload(h).hired).toEqual({ village: 'Ashford', price: BUILD.PRICE, paid: deposit() });
  });

  it('carries the deposit over onto the plot, so it is never asked for twice', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit());
    const job = h.place(20, 20, 10)!;
    expect(h.hired).toBeNull();
    expect(job.paid).toBe(deposit());
    expect(owed(job, 10 + BUILD.DAYS)).toBe(BUILD.PRICE - deposit());
  });

  it('will not put a house down with nobody hired', () => {
    expect(new Houses().place(20, 20, 10)).toBeNull();
  });

  it('brings the plot, the day, the facing and the strongbox back off the disk', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit());
    const job = h.place(20.5, -14.5, 10, 1.5)!;
    const box = h.strongbox(job);
    box.gold = 300;
    box.items.knife = 2;
    const back = reload(h).entries()[0];
    expect([back.x, back.z, back.began, back.rot]).toEqual([20.5, -14.5, 10, 1.5]);
    expect(back.store).toEqual({ gold: 300, items: { knife: 2 } });
  });

  it('finds the house you are standing at, and not one over the hill', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit());
    h.place(20, 20, 10);
    expect(h.nearest(21, 21, 3.4)?.village).toBe('Ashford');
    expect(h.nearest(60, 60, 3.4)).toBeNull();
  });
});

/**
 * What being owed for it does. The builder has already finished by the time the balance falls
 * due — the roof is on and the argument is about money — so the answer cannot be that he downs
 * tools. It is that the village he drinks in hears about it, once a day, until it is settled.
 */
describe('a house that has not been paid for', () => {
  const started = (): { houses: Houses; job: Commission } => {
    const houses = new Houses();
    houses.takeOn('Ashford', BUILD.PRICE, deposit());
    return { houses, job: houses.place(20, 20, 10)! };
  };

  it('costs nothing at all while the work is still going on', () => {
    const { houses } = started();
    expect(houses.charge(12)).toEqual([]);
    expect(houses.charge(10 + BUILD.DAYS)).toEqual([]);
  });

  it('costs the village a day at a time, and only once for each day', () => {
    const { houses } = started();
    expect(houses.charge(10 + BUILD.DAYS)).toEqual([]);
    expect(houses.charge(11 + BUILD.DAYS)).toEqual([{ village: 'Ashford', weight: BUILD.UNPAID_A_DAY }]);
    expect(houses.charge(11 + BUILD.DAYS)).toEqual([]);
  });

  it('charges a fortnight away as one fortnight, not as fourteen days of nothing', () => {
    const { houses } = started();
    expect(houses.charge(24 + BUILD.DAYS)).toEqual([{ village: 'Ashford', weight: 14 * BUILD.UNPAID_A_DAY }]);
  });

  it('outruns what a village forgives in a day, or owing for a house would cost nothing', () => {
    expect(BUILD.UNPAID_A_DAY).toBeGreaterThan(GRUDGE.FORGIVEN_A_DAY);
  });

  it('stops the moment the balance is handed over', () => {
    const { houses, job } = started();
    houses.pay(job, BUILD.PRICE - deposit());
    expect(owed(job, 30)).toBe(0);
    expect(houses.charge(30)).toEqual([]);
  });

  it('never takes more than the price, however much is pushed at it', () => {
    const { houses, job } = started();
    houses.pay(job, BUILD.PRICE * 3);
    expect(job.paid).toBe(BUILD.PRICE);
  });
});

/**
 * The builder is a regular of the room rather than somebody on the village register, so that a
 * half-built house cannot be orphaned by a wolf. That only works if the same room always has the
 * same man in it, on every machine playing that world.
 */
describe('the builder in the corner', () => {
  it('is the same man in the same pub every time you walk in', () => {
    expect(builderIn('Ashford', 7)).toBe(builderIn('Ashford', 7));
  });

  it('is not the same man in every pub in the country', () => {
    const names = new Set(['Ashford', 'Barrowdean', 'Cransley', 'Dunmere', 'Eastfold', 'Farrowgate', 'Greyholt', 'Hollin']
      .map((v) => builderIn(v, 7)));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('a house somebody else paid for', () => {
  it('stands in the village on every screen, at the stage its day says', () => {
    const mine = new Houses();
    const theirs = { id: 'house:Ashfield:10,20', village: 'Ashfield', x: 10.5, z: 20.5, rot: 1.2, day: 4 };
    mine.adopt(theirs);
    expect(mine.count).toBe(1);
    const [job] = mine.entries();
    expect(job).toMatchObject({ id: theirs.id, village: 'Ashfield', began: 4, rot: 1.2 });
    // the money was theirs and stays theirs: nobody here owes a village for it
    expect(job.paid).toBe(0);
    expect(job.price).toBe(0);
  });

  it('is one house however many times the world mentions it', () => {
    const mine = new Houses();
    const theirs = { id: 'house:Ashfield:10,20', village: 'Ashfield', x: 10.5, z: 20.5, rot: 0, day: 4 };
    mine.adopt(theirs);
    mine.adopt(theirs);
    expect(mine.count).toBe(1);
  });
});
