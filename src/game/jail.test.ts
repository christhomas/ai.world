import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { generateRoadGraph } from '../world/graph';
import { TerrainSampler } from '../world/terrain';
import { StructureKind, type Structure, type Village } from '../world/structures';
import { JAIL, Jail, clockAt, fineFor, hoursLeftIn, toldOnWaking, windOn } from './jail';
import { LAW, Standing } from './standing';

/** A house, in as much detail as the law cares about: there is one, and it has a wall to lean on. */
const house = (n: number): Structure => ({
  kind: StructureKind.House, tx: n * 4, tz: 0, hw: 1, hd: 1, level: 0, rot: 0, biome: Biome.Plains, path: [],
});

/** A village on paper: a name, somewhere on the road, and a station on the street or none. */
const village = (name: string, x = 0, lawful = true): Village => ({
  name, board: null, x, z: 0, radius: 20, level: 0, biome: Biome.Plains,
  houses: [house(0)], shops: [], pub: null, stable: null,
  station: lawful ? { house: house(0), doorX: x, doorZ: 0 } : null,
  church: null, churchDoor: null, hall: null, watchHouse: null, stalls: [],
});

/** The villages a seed actually grows, for the questions only a whole world can answer. */
const grown = (seed: number): Village[] => new TerrainSampler(generateRoadGraph(seed)).structures.villages;

describe('where a village puts its station', () => {
  it('grows the same stations from the same seed, every time', () => {
    const sign = (villages: Village[]): string[] =>
      villages.map((v) => `${v.name}:${v.station ? `${v.station.doorX},${v.station.doorZ}` : 'none'}`);

    const first = sign(grown(3));
    expect(sign(grown(3))).toEqual(first);
    expect(first.some((s) => !s.endsWith('none'))).toBe(true);   // and some of them do have one
    expect(first.some((s) => s.endsWith('none'))).toBe(true);    // and some of them do not
  });

  it('never gives a hamlet one, and never leaves a proper village without', () => {
    for (const seed of [1, 2, 3]) {
      for (const v of grown(seed)) {
        expect(v.station !== null, `${v.name} has ${v.houses.length} houses`).toBe(v.houses.length >= 6);
      }
    }
  });

  it('takes a house of its own rather than the pub, and hangs a sign by the door', () => {
    const structures = new TerrainSampler(generateRoadGraph(2)).structures;
    const withLaw = structures.villages.filter((v) => v.station);
    expect(withLaw.length).toBeGreaterThan(0);

    for (const v of withLaw) {
      const station = v.station!;
      expect(station.house).not.toBe(v.pub?.house);
      expect(v.houses).toContain(station.house);
      const sign = structures.all.some((s) => s.kind === StructureKind.Sign
        && Math.hypot(s.tx - station.house.tx, s.tz - station.house.tz) <= 3);
      expect(sign, `no sign outside the station at ${v.name}`).toBe(true);
    }
  });
});

describe('the cell at the back of it', () => {
  it('holds one prisoner at a time and turns the next away', () => {
    const jail = new Jail();
    const oakford = village('Oakford');

    expect(jail.commit(oakford, 'Sarn', 6, 1, 1)).not.toBeNull();
    expect(jail.commit(oakford, 'Bram', 6, 1, 1)).toBeNull();
    expect(jail.holds('Oakford', 1)?.who).toBe('Sarn');
  });

  it('holds somebody who is not the hero, and can hold both at once in different villages', () => {
    const jail = new Jail();
    jail.commit(village('Oakford'), 'Black Sarn', 24 * 14, 5, 5);
    jail.take([village('Ashmere', 40)], 40, 0, 'you', 8, 5, 5, 60);

    const inside = jail.everyone(5);
    expect(inside.map((h) => h.who).sort()).toEqual(['Black Sarn', 'you']);
    expect(inside.filter((h) => h.hero).map((h) => h.village)).toEqual(['Ashmere']);
  });

  it('opens the door when the hour comes round, and not a moment before', () => {
    const jail = new Jail();
    jail.commit(village('Oakford'), 'Sarn', 6, 10, 10);       // six hours is a quarter of a day

    expect(jail.hoursLeft('Oakford', 10.125)).toBeCloseTo(3);
    expect(jail.holds('Oakford', 10.24)?.who).toBe('Sarn');
    expect(jail.holds('Oakford', 10.26)).toBeNull();
    expect(jail.hoursLeft('Oakford', 10.26)).toBe(0);
  });

  it('lets somebody out early only when it is told to', () => {
    const jail = new Jail();
    const oakford = village('Oakford');
    jail.commit(oakford, 'Sarn', 20, 1, 1);

    expect(jail.release('Oakford')?.who).toBe('Sarn');
    expect(jail.holds('Oakford', 1)).toBeNull();
    expect(jail.commit(oakford, 'Bram', 4, 1, 1)).not.toBeNull();   // and the cell is free again
  });
});

describe('being taken in', () => {
  it('holds a worse criminal longer, and takes more off them for it', () => {
    const bad = new Standing(LAW.WANTED_AT - 1);
    const worst = new Standing(LAW.WORST);
    const held = (you: Standing) =>
      new Jail().take([village('Oakford')], 0, 0, 'you', you.sentence(), 5, 5, 1000);

    const light = held(bad)!;
    const heavy = held(worst)!;
    expect(heavy.hours).toBeGreaterThan(light.hours);
    expect(heavy.until).toBeGreaterThan(light.until);
    expect(heavy.fine).toBeGreaterThan(light.fine);
    expect(held(new Standing())).toBeNull();          // nobody the law does not want is held at all
  });

  it('takes a fine it can take, and never empties a purse', () => {
    expect(fineFor(10, 1000)).toBe(10 * JAIL.FINE_AN_HOUR);
    expect(fineFor(10, 20)).toBe(Math.floor(20 * JAIL.FINE_SHARE));
    expect(fineFor(10, 0)).toBe(0);

    const broke = new Jail().take([village('Oakford')], 0, 0, 'you', 10, 1, 1, 0)!;
    expect(broke.fine).toBe(0);
    expect(toldOnWaking(broke)).toContain('Oakford');
    expect(toldOnWaking(broke)).toContain('10 hours');
  });

  it('serves the hours on the world clock, so the days go by while you are inside', () => {
    const clock = { day: 2, time: 0.9 };
    const jail = new Jail();
    const held = jail.take([village('Oakford')], 0, 0, 'you', 14, clockAt(clock), clock.day, 100)!;
    expect(jail.holds('Oakford', clockAt(clock))?.who).toBe('you');

    windOn(clock, held.hours);

    expect(clock.day).toBe(3);                        // a night went past outside the window
    expect(clock.time).toBeCloseTo(0.4833, 3);
    expect(clockAt(clock)).toBeCloseTo(held.until);
    expect(hoursLeftIn(held, clockAt(clock))).toBeCloseTo(0);
    expect(jail.holds('Oakford', clockAt(clock) + 1e-6)).toBeNull();
  });

  it('winds the clock through as many days as the sentence needs', () => {
    const clock = { day: 1, time: 0 };
    windOn(clock, JAIL.HOURS_A_DAY * 2 + 12);
    expect(clock.day).toBe(3);
    expect(clock.time).toBeCloseTo(0.5);
  });

  it('walks the prisoner to the next village when the near cell will not take them', () => {
    const jail = new Jail();
    const oakford = village('Oakford');
    const ashmere = village('Ashmere', 60);
    jail.commit(oakford, 'Sarn', 20, 1, 1);

    const held = jail.take([oakford, ashmere], 0, 0, 'you', 6, 1, 1, 0)!;
    expect(held.village).toBe('Ashmere');
    expect(held.x).toBe(60.5);                        // and wakes at that station's door

    // past the walk a constable will make, and past every village that has a station at all
    expect(jail.take([village('Farfield', JAIL.ESCORT + 10)], 0, 0, 'you', 6, 1, 1, 0)).toBeNull();
    expect(jail.take([village('Nowhere', 2, false)], 0, 0, 'you', 6, 1, 1, 0)).toBeNull();
  });
});

describe('a station broken open', () => {
  it('empties the cell and leaves the village lawless until it is rebuilt', () => {
    const jail = new Jail();
    const oakford = village('Oakford');
    jail.commit(oakford, 'Sarn', 20, 1, 1);

    expect(jail.brokenOpen('Oakford', 1)?.who).toBe('Sarn');
    expect(jail.holds('Oakford', 1)).toBeNull();
    expect(jail.lawless('Oakford', 1)).toBe(true);
    expect(jail.canHold(oakford, 1, 1)).toBe(false);
    expect(jail.commit(oakford, 'Bram', 4, 1, 1)).toBeNull();

    const back = 1 + JAIL.REBUILD_DAYS;
    expect(jail.lawless('Oakford', back - 1)).toBe(true);
    expect(jail.lawless('Oakford', back)).toBe(false);
    expect(jail.standingAgain('Oakford')).toBe(back);
    expect(jail.commit(oakford, 'Bram', 4, back, back)?.who).toBe('Bram');
  });

  it('sends the law to the next village while the roof is off, and stops when it is back on', () => {
    const jail = new Jail();
    const oakford = village('Oakford');
    const ashmere = village('Ashmere', 60);
    jail.brokenOpen('Oakford', 2);

    expect(jail.nearest([oakford, ashmere], 0, 0, 2, 2)?.name).toBe('Ashmere');
    jail.rebuild('Oakford');
    expect(jail.lawless('Oakford', 2)).toBe(false);
    expect(jail.nearest([oakford, ashmere], 0, 0, 2, 2)?.name).toBe('Oakford');
  });

  it('remembers who is inside and which stations are heaps, across a save', () => {
    const jail = new Jail();
    jail.commit(village('Oakford'), 'Sarn', 20, 1, 1);
    jail.brokenOpen('Ashmere', 1);

    const reopened = Jail.from(JSON.parse(JSON.stringify(jail.toJSON())));
    expect(reopened.holds('Oakford', 1)?.who).toBe('Sarn');
    expect(reopened.lawless('Ashmere', 1)).toBe(true);
    expect(reopened.lawless('Ashmere', 1 + JAIL.REBUILD_DAYS)).toBe(false);
    expect(new Jail().toJSON().cells).toEqual([]);    // a country nothing has happened in writes nothing
  });
});

/**
 * The charge sheet, which is the cell's memory.
 *
 * A cell forgets a prisoner the moment their hour comes — it has to, or nobody else could be put
 * in it. The sheet is the other half of that: what a village remembers about having held somebody,
 * long after they walked out. It is written where the arrest happens, because every way anybody
 * ends up behind a door goes through that one call, and a sheet kept anywhere else would be a
 * second list somebody would forget to add to.
 */
describe('the charge sheet the watch keeps', () => {
  it('writes a line when somebody is taken in, and keeps it after they are let out', () => {
    const jail = new Jail();
    const oakford = village('Oakford');
    jail.commit(oakford, 'Sarn', 12, 1, 1, 30);
    jail.release('Oakford');

    expect(jail.holds('Oakford', 1), 'still holding somebody who was let out').toBeNull();
    expect(jail.charges()).toEqual([{ who: 'Sarn', village: 'Oakford', day: 1, hours: 12, fine: 30 }]);
  });

  it('writes the hero down as somebody with a name, so the sheet reads as a sheet', () => {
    const jail = new Jail();
    jail.commit(village('Oakford'), 'you', 6, 1, 1, 15, true);
    expect(jail.charges()[0].who, 'the hero is written down in the third person and lower case').toBe('You');
  });

  it('carries every village its own sheet, and nobody else\'s', () => {
    const jail = new Jail();
    jail.commit(village('Oakford'), 'Sarn', 6, 1, 1);
    jail.commit(village('Ashmere', 60), 'Bram', 6, 1, 1);
    expect(jail.charges().filter((c) => c.village === 'Oakford').map((c) => c.who)).toEqual(['Sarn']);
    expect(jail.charges().filter((c) => c.village === 'Ashmere').map((c) => c.who)).toEqual(['Bram']);
  });

  it('keeps the recent names and lets the old ones go', () => {
    const jail = new Jail();
    const oakford = village('Oakford');
    for (let n = 0; n < JAIL.SHEET_KEPT + 5; n++) {
      jail.commit(oakford, `Sarn ${n}`, 2, n, n);
      jail.release('Oakford');
    }
    const sheet = jail.charges();
    expect(sheet.length, 'a sheet that grows for ever is a history, not a record').toBe(JAIL.SHEET_KEPT);
    expect(sheet[sheet.length - 1].who, 'the newest name has fallen off the end').toBe(`Sarn ${JAIL.SHEET_KEPT + 4}`);
    expect(sheet.some((c) => c.who === 'Sarn 0'), 'the oldest name is still on it').toBe(false);
  });

  it('survives a save, and a save written before there was a sheet at all', () => {
    const jail = new Jail();
    jail.commit(village('Oakford'), 'Sarn', 12, 1, 1, 30);
    const reopened = Jail.from(JSON.parse(JSON.stringify(jail.toJSON())));
    expect(reopened.charges().map((c) => c.who)).toEqual(['Sarn']);

    // an older save has cells but no sheets in them, and must open rather than throw
    const older = Jail.from({ cells: [{ village: 'Ashmere', held: null, standingAgain: 4 }] });
    expect(older.charges()).toEqual([]);
    expect(older.lawless('Ashmere', 1)).toBe(true);
  });
});
