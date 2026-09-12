import { describe, expect, it } from 'vitest';
import {
  BUILD, CATALOGUE, Houses, beside, buildable, builderIn, canAttachTo, canBuildAt, canLayAKeel,
  daysFor, deposit, isFinished, onOffer, owed, progressOf, saidOfJob, stageAt, stillOnItsSite,
  storeysOf, type Commission, BUILDS,
} from './building';
import { BOAT, moorageFor } from './sailing';
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
    expect(stageAt(job(), 10)).toBe('marked');
  });

  it('goes up in recognisable stages rather than inflating', () => {
    const j = job();
    const seen = [0, 2, 4, 6].map((d) => stageAt(j, 10 + d));
    expect(seen).toEqual(['marked', 'begun', 'nearly', 'done']);
  });

  it('gives every kind the same three stages to be seen at, whatever its number of days is', () => {
    /*
     * The stages are fractions of the whole job rather than days, which is what lets a fountain
     * that takes two days and a house that takes six both be worth riding past twice. Before this
     * they were the house's own thresholds and everything shorter spent its whole life pegged out.
     */
    for (const entry of CATALOGUE) {
      const hired: Commission = { ...job(), what: entry.id, price: entry.price };
      const seen = [0, 0.3, 0.7, 1].map((part) => stageAt(hired, 10 + entry.days * part));
      expect(seen, `${entry.name} is not worth looking at twice`)
        .toEqual(['marked', 'begun', 'nearly', 'done']);
    }
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
    // `what` is on it now: building is a verb that takes an object, and a builder holding a
    // commission has to be holding one for something in particular even while the list is one long
    expect(reload(h).hired)
      .toEqual({ village: 'Ashford', price: BUILD.PRICE, paid: deposit(), what: BUILDS.HOUSE });
  });

  it('remembers what he was told to build, when it is not the default', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit(), 'bath house');
    expect(reload(h).hired?.what).toBe('bath house');
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

/**
 * What was ordered, carried from the table to the plot.
 *
 * `Commission.what` existed and `takeOn` recorded it, and the one step between agreeing a job and
 * standing it somewhere threw it away and wrote `house:` into the id. A field nothing reads is a
 * field that is not there, whatever the type says.
 */
describe('a commission for something in particular', () => {
  it('remembers what it was for when it reaches the ground', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit(), 'bath house');
    const job = h.place(10, 20, 4)!;
    expect(job.what).toBe('bath house');
  });

  it('names it in the id, so two different things on one tile are two buildings', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit(), 'bath house');
    const bath = h.place(10, 20, 4)!;
    h.takeOn('Ashford', BUILD.PRICE, deposit());
    const house = h.place(10, 20, 4)!;
    expect(bath.id).not.toBe(house.id);
    expect(house.id.startsWith(`${BUILDS.HOUSE}:`)).toBe(true);
  });

  it('is a house when nobody said otherwise, which is every job ever written down', () => {
    const h = new Houses();
    h.takeOn('Ashford', BUILD.PRICE, deposit());
    expect(h.place(1, 2, 3)!.what).toBe(BUILDS.HOUSE);
  });
});

/**
 * Building a verb that takes an object, now that the object can be more than one thing.
 *
 * The catalogue was one line long for a version and the shortness was honest: there was no second
 * thing to offer, and a menu with one item on it is a verb nobody has to think about. What unstuck
 * it was that three of the four entries are geometry that was already in the game — `house()` has
 * taken a number of storeys since villagers started spending an inheritance on one, and there were
 * a bath house and a bathing pool modelled and used by nothing.
 *
 * The rule that came with them is the one worth testing: half the catalogue does not stand on a
 * piece of ground at all. A storey needs a roof to go on, a pool and a fountain need a yard, and a
 * yard is a thing that belongs to a house.
 */
describe('the catalogue of what can be built', () => {
  it('prices and times everything in it, and starts with the house', () => {
    expect(CATALOGUE[0].id).toBe(BUILDS.HOUSE);
    for (const entry of CATALOGUE) {
      expect(entry.price, `${entry.id} is free`).toBeGreaterThan(0);
      expect(entry.days, `${entry.id} takes no time`).toBeGreaterThan(0);
      expect(entry.name, `${entry.id} has no name a builder would say`).toMatch(/^an? /);
    }
  });

  it('reads an unknown order as a house, which is what every old save holds', () => {
    expect(buildable(undefined).id).toBe(BUILDS.HOUSE);
    expect(buildable('a summer palace').id).toBe(BUILDS.HOUSE);
  });

  it('takes a fountain two days where a house takes a week', () => {
    const fountain = { ...job(), what: BUILDS.FOUNTAIN };
    expect(daysFor(fountain)).toBe(buildable(BUILDS.FOUNTAIN).days);
    expect(daysFor(job())).toBe(BUILD.DAYS);
    // and the stages follow the days rather than the week: a fountain half done is half done
    expect(isFinished(fountain, 10 + buildable(BUILDS.FOUNTAIN).days)).toBe(true);
    expect(isFinished(job(), 10 + buildable(BUILDS.FOUNTAIN).days)).toBe(false);
  });

  it('names what is finished rather than calling everything a house', () => {
    const pool = { ...job(), what: BUILDS.POOL };
    expect(saidOfJob(pool, 10 + buildable(BUILDS.POOL).days)).toContain('bathing pool');
  });
});

describe('something added to a house', () => {
  const houseAt = (x: number, z: number, began = 10): Commission =>
    ({ id: `house:${x},${z}`, x, z, village: 'Ashford', began, paid: BUILD.PRICE, price: BUILD.PRICE });
  const done = 10 + BUILD.DAYS;

  it('goes on the side of the house the owner is standing', () => {
    const house = houseAt(20, 20);
    const north = beside(house, BUILDS.POOL, 20, 8);
    expect(north.z, 'the pool went to the far side of the house from where he stood').toBeLessThan(20);
    const east = beside(house, BUILDS.POOL, 40, 20);
    expect(east.x).toBeGreaterThan(20);
    // and out of the wall rather than inside it
    expect(Math.hypot(east.x - house.x, east.z - house.z)).toBeCloseTo(BUILD.BESIDE_AT, 6);
  });

  it('sits on the house itself when it is the house that changes', () => {
    const house = houseAt(20, 20);
    expect(beside(house, BUILDS.STOREY, 40, 20)).toEqual({ x: 20, z: 20 });
  });

  it('has somewhere to go even when the owner is standing in the doorway', () => {
    // nought over nought is not a direction, and a pool at NaN,NaN is drawn nowhere at all
    const spot = beside(houseAt(20, 20), BUILDS.FOUNTAIN, 20, 20);
    expect(Number.isFinite(spot.x) && Number.isFinite(spot.z)).toBe(true);
  });

  it('will not go on nothing at all', () => {
    const verdict = canAttachTo(null, BUILDS.POOL, done, []);
    expect(verdict.ok).toBe(false);
  });

  it('will not go on a house that is still a frame', () => {
    const verdict = canAttachTo(houseAt(20, 20), BUILDS.POOL, 11, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.why).toContain('not finished');
  });

  it('will not be started while the house it goes on is still owing', () => {
    // the argument a builder would actually make, and the reason the rule is here rather than in
    // the dialogue: a man owed four hundred gold does not begin the next job on credit
    const owing = { ...houseAt(20, 20), paid: deposit() };
    const verdict = canAttachTo(owing, BUILDS.POOL, done, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.why).toContain('Settle up');
  });

  it('allows a pool and a fountain on one house, and only one second storey', () => {
    const house = houseAt(20, 20);
    const storey: Commission = {
      id: 'storey:1', what: BUILDS.STOREY, to: house.id, x: 20, z: 20,
      village: 'Ashford', began: 10, paid: 260, price: 260,
    };
    expect(canAttachTo(house, BUILDS.POOL, done, [storey]).ok).toBe(true);
    expect(canAttachTo(house, BUILDS.STOREY, done, [storey]).ok).toBe(false);
  });

  it('makes the house a floor taller the day the storey is finished, and not before', () => {
    /*
     * Counted rather than written down, the way a crop ripens and a grudge fades. A storey that
     * had to be applied on the day it finished would be a storey that never arrived on a world
     * nobody had open that day — and the whole of this file is the argument that a building is a
     * subtraction from today rather than a thing that ticks.
     */
    const house = houseAt(20, 20);
    const storey: Commission = {
      id: 'storey:1', what: BUILDS.STOREY, to: house.id, x: 20, z: 20,
      village: 'Ashford', began: 30, paid: 260, price: 260,
    };
    const jobs = [house, storey];
    const up = 30 + buildable(BUILDS.STOREY).days;
    expect(storeysOf(house, jobs, 31)).toBe(1);
    expect(storeysOf(house, jobs, up)).toBe(2);
    // and a pool does not make anybody taller
    const pool: Commission = { ...storey, id: 'pool:1', what: BUILDS.POOL };
    expect(storeysOf(house, [house, pool], 99)).toBe(1);
  });

  it('remembers what it was added to, through the store and through a save', () => {
    const h = new Houses();
    h.takeOn('Ashford', 150, deposit(150), BUILDS.POOL);
    const job = h.place(24, 20, 40, 0, 'house:20,20');
    expect(job?.to).toBe('house:20,20');
    expect(job?.what).toBe(BUILDS.POOL);
    const reopened = Houses.from(JSON.parse(JSON.stringify(h.toJSON())));
    expect(reopened.entries()[0].to).toBe('house:20,20');
  });

  it('adopts somebody else\'s pool as a pool rather than as a house', () => {
    // what crosses the wire when another player builds one. Without `what` their bathing pool is
    // drawn as a cottage on every other screen, which is how the field was found to be missing
    const h = new Houses();
    h.adopt({
      id: 'pool:Ashford:24,20', village: 'Ashford', x: 24, z: 20, rot: 0, day: 12,
      what: BUILDS.POOL, to: 'house:Ashford:20,20',
    });
    expect(h.entries()[0].what).toBe(BUILDS.POOL);
    expect(h.entries()[0].to).toBe('house:Ashford:20,20');
  });

  it('is asked for by kind at the door, so a pool is not mistaken for the house', () => {
    const h = new Houses();
    h.adopt({ id: 'house:1', village: 'Ashford', x: 20, z: 20, rot: 0, day: 1 });
    h.adopt({ id: 'pool:1', village: 'Ashford', x: 22, z: 20, rot: 0, day: 1, what: BUILDS.POOL, to: 'house:1' });
    // standing between the two, nearer the pool
    expect(h.nearest(22.2, 20, 6)?.id).toBe('pool:1');
    expect(h.nearest(22.2, 20, 6, Houses.isABuilding)?.id).toBe('house:1');
  });
});

describe('what a builder will offer you', () => {
  const house = (over: Partial<Commission> = {}): Commission =>
    ({ id: 'house:1', x: 20, z: 20, village: 'Ashford', began: 10, paid: BUILD.PRICE, price: BUILD.PRICE, ...over });
  const done = 10 + BUILD.DAYS;

  it('offers only what stands on its own ground to somebody with nothing', () => {
    const offered = onOffer([], done).map((entry) => entry.id);
    expect(offered).toContain(BUILDS.HOUSE);
    expect(offered, 'a pool was offered to somebody with no house to put it beside').not.toContain(BUILDS.POOL);
  });

  it('offers the rest once a house is standing and paid for', () => {
    const offered = onOffer([house()], done).map((entry) => entry.id);
    for (const id of [BUILDS.HOUSE, BUILDS.STOREY, BUILDS.POOL, BUILDS.FOUNTAIN]) {
      expect(offered, `${id} was not offered to a man with a house`).toContain(id);
    }
  });

  it('goes back to offering only a house while the last one is unfinished or unpaid', () => {
    expect(onOffer([house()], 11).map((e) => e.id)).not.toContain(BUILDS.POOL);
    expect(onOffer([house({ paid: deposit() })], done).map((e) => e.id)).not.toContain(BUILDS.POOL);
  });

  it('does not count a pool as something to put a pool on', () => {
    // the rule is about buildings rather than about anything you have paid for: a yard needs a
    // house in it, and a fountain is not a house however finished it is
    const pool = house({ id: 'pool:1', what: BUILDS.POOL, to: 'house:1', price: 150, paid: 150 });
    expect(onOffer([pool], done).map((e) => e.id)).not.toContain(BUILDS.STOREY);
  });
});

/**
 * The builder builds boats, which is the first commission that is not on a village plot.
 *
 * Everything else this man puts up stands where he put it for ever: a house, a pool beside it, a
 * fountain in the yard, a floor on top. A boat is built on the shore and then leaves, and that one
 * difference is what these are about — where she may be laid, that a coast is what makes her
 * possible at all, and that her yard is empty afterwards rather than holding a second boat.
 */
describe('having a boat built', () => {
  const ashore = { x: 0, z: 0 };
  const village = { x: 20, z: 20 };
  /** A shore with the water at the end of it and a jetty in sight: the case that should be allowed. */
  const keelAt = (toWater: number, toPier: number) =>
    canLayAKeel(ashore.x, ashore.z, true, village, [], true, toWater, toPier);

  it('is on the menu to somebody who owns nothing, the way a house is', () => {
    // she goes on a piece of shore rather than on a building, so there is nothing to own first —
    // which is the whole of what `on` decides, and the reason it is a word rather than a boolean
    const offered = onOffer([], 10 + BUILD.DAYS, true).map((entry) => entry.id);
    expect(offered).toContain(BUILDS.BOAT);
    expect(offered, 'a pool was offered to somebody with no house').not.toContain(BUILDS.POOL);
  });

  it('is not on the menu at all in a village with no harbour', () => {
    /*
     * The deposit is not refundable and the dialogue says so, which is what makes this a menu
     * question and not only a ground question. A builder forty miles inland who offered boats
     * would be taking sixty-four gold for a job the player can never stand anywhere: the refusal
     * would arrive after the money had gone, and the money is the part that does not come back.
     */
    const inland = onOffer([], 10 + BUILD.DAYS, false).map((entry) => entry.id);
    expect(inland, 'a boat was offered in a village with no water near it').not.toContain(BUILDS.BOAT);
    expect(inland, 'and the rest of his trade went with it').toContain(BUILDS.HOUSE);
  });

  it('costs less than the one on the pier, which is the only reason to wait for her', () => {
    /*
     * The boatwright at the end of a jetty sells a finished hull and you sail it away that minute.
     * If a commissioned boat were dearer as well as slower, this entry would be a line in a table
     * that never ran — so the trade a village actually offers is the same boat for less, if you
     * can wait five days for her.
     */
    const ordered = buildable(BUILDS.BOAT);
    expect(ordered.price).toBeLessThan(BOAT.PRICE);
    expect(ordered.days).toBeGreaterThan(0);
  });

  it('wants the water at the end of the yard rather than a cart ride away', () => {
    expect(keelAt(1, 10).ok, 'a shore with the sea at the end of it was refused').toBe(true);
    const inland = keelAt(Infinity, 10);
    expect(inland.ok).toBe(false);
    expect(!inland.ok && inland.why).toMatch(/water/);
  });

  it('wants a jetty to tie her up at, which is what makes this a coastal village\'s building', () => {
    // the gate the harbour earns: a beach is somewhere to build a boat and nowhere to keep one
    const noHarbour = keelAt(1, Infinity);
    expect(noHarbour.ok).toBe(false);
    expect(!noHarbour.ok && noHarbour.why).toMatch(/tie her up/);
  });

  it('still asks everything a house is asked, because a yard is a piece of ground', () => {
    // the shore rules are added to the ground rules rather than replacing them: level, clear, and
    // near enough to a village that somebody will walk out to it every morning
    expect(canLayAKeel(0, 0, false, village, [], true, 1, 1).ok, 'laid on ground that will not take it').toBe(false);
    expect(canLayAKeel(0, 0, true, null, [], true, 1, 1).ok, 'laid where no village could send a man').toBe(false);
    expect(canLayAKeel(0, 0, true, village, [{ x: 1, z: 1 }], true, 1, 1).ok, 'laid on top of something').toBe(false);
    expect(canLayAKeel(0, 0, true, village, [], false, 1, 1).ok, 'laid through a tree').toBe(false);
  });

  it('leaves the shore bare once she has been launched, and not before', () => {
    /*
     * The one thing about her that no other commission needs. A hull that went on being drawn on
     * the stocks after she was in the water would be two boats where the player paid for one, and
     * the record is a date rather than a flag so that a world reopened a fortnight later finds the
     * beach empty because she left on a day that is written down.
     */
    const houses = new Houses();
    houses.takeOn('Ashford', buildable(BUILDS.BOAT).price, 60, BUILDS.BOAT);
    const boat = houses.place(4, 4, 10, 0)!;
    expect(stillOnItsSite(boat), 'her yard was empty while she was being built').toBe(true);

    houses.launch(boat, 15);
    expect(boat.launched).toBe(15);
    expect(stillOnItsSite(boat), 'she is drawn on the beach and at the jetty at once').toBe(false);
    // and nothing that stays where it was put is ever taken off its site by the same question
    expect(stillOnItsSite(job()), 'a house walked off its plot').toBe(true);
  });

  it('ties her up at the nearest jetty rather than leaving her on the sand', () => {
    /*
     * Where she ends up is a fact about the coast rather than about the yard: the dock tile is the
     * one `piers.ts` leaves clear past the last deck board, and it is where a boat bought from the
     * boatwright is left too — so a boat you commissioned and a boat you bought are found in the
     * same place, which is what a player would expect of both.
     */
    const near = { dockX: 10, dockZ: 0, dx: 1, dz: 0 };
    const far = { dockX: 400, dockZ: 0, dx: 1, dz: 0 };
    const lies = moorageFor({ x: 8, z: 0 }, [far, near])!;
    expect(lies.x).toBeCloseTo(11.5, 5);
    expect(lies.z).toBeCloseTo(0.5, 5);
    expect(moorageFor({ x: 0, z: 0 }, []), 'a coast with no jetty on it').toBeNull();
  });
});
