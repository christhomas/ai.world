import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from '../world/graph';
import { TerrainSampler } from '../world/terrain';
import type { Structures } from '../world/structures';
import {
  ROAM, Roaming, bandAt, bandFor, bandsNear, bandsOver, breaksAt, distanceTo, nightsNear,
  outOfSight, planBands, pressingOn, pressureOn, regionOf, stopsOf, temperOf, tollOf, warningFor,
  type Band,
} from './roaming';

/** Growing a world is the expensive part of these tests, so each one is grown once. */
const worlds = new Map<number, Structures>();
const world = (seed: number): Structures => {
  const known = worlds.get(seed);
  if (known) return known;
  const grown = new TerrainSampler(generateRoadGraph(seed)).structures;
  worlds.set(seed, grown);
  return grown;
};

/** Somewhere no band will ever be, for the half of every comparison that should feel nothing. */
const nowhere = { name: 'Nowhere', x: 1e5, z: 1e5 };

/** The furthest a band gets from where it stood on `from`, over that many days. */
const strayed = (band: Band, from: number, days: number): number => {
  const start = bandAt(band, from);
  let most = 0;
  for (let day = from; day <= from + days; day++) {
    const now = bandAt(band, day);
    most = Math.max(most, Math.hypot(now.x - start.x, now.z - start.z));
  }
  return most;
};

/** The numbers a whole band's members go by, which is what `alive` starts out holding. */
const everyone = (band: Band): number[] => Array.from({ length: band.size }, (_, n) => n);

/** A day this band is in a mood to do something, which most of them are most of the time. */
const badDay = (band: Band): number => {
  for (let day = 1; day <= 400; day++) if (temperOf(band, day) > 0.5) return day;
  throw new Error('a band that is never in a bad mood is a bug in the ebb');
};

describe('where a band is', () => {
  it('is the same place for everybody who asks, and a different place tomorrow', () => {
    const bands = planBands(1, world(1));
    expect(bands.length).toBe(ROAM.BANDS);
    // the same world, planned again, has the same bands walking the same roads
    expect(planBands(1, world(1))).toEqual(bands);
    expect(planBands(2, world(1)).map((b) => b.circuit[0].name)).not.toEqual(bands.map((b) => b.circuit[0].name));

    for (const band of bands) {
      expect(bandAt(band, 9)).toEqual(bandAt(band, 9));
      expect(band.circuit.length).toBeGreaterThan(1);
    }
    // a band camped on a place stays put for a day or two, so this is most of them rather than all
    const moved = bands.filter((b) => distanceTo(b, bandAt(b, 9).x, bandAt(b, 9).z, 10) > 1);
    expect(moved.length).toBeGreaterThan(bands.length / 2);
  });

  it('is somewhere else entirely by next week', () => {
    for (const seed of [1, 5]) {
      const bands = planBands(seed, world(seed));
      const away = bands.map((b) => strayed(b, 1, 7));
      // every one of them has left the ground it was pressing, so a village cleared last week
      // tells you nothing about the village this week
      expect(Math.min(...away)).toBeGreaterThan(ROAM.PRESS_WITHIN);
      // and the usual one has crossed the whole reach of its own round
      expect(away.reduce((a, b) => a + b, 0) / away.length).toBeGreaterThan(ROAM.CIRCUIT);
    }
  });

  it('stands over the places on its round rather than merely passing them', () => {
    const band = planBands(1, world(1))[0];
    let camped = 0;
    for (let day = 1; day <= 60; day++) {
      const now = bandAt(band, day);
      if (!now.camped) continue;
      camped++;
      // camped means camped: it is on the place, not near it
      expect(now.x).toBe(now.from.x);
      expect(now.z).toBe(now.from.z);
    }
    // roughly half of every leg, which is what turns a visit into a week the place remembers
    expect(camped).toBeGreaterThan(10);
  });

  it('offers only the bands somebody could actually walk into', () => {
    const bands = planBands(3, world(3));
    const here = bandAt(bands[0], 12);
    expect(bandsNear(bands, here.x, here.z, 12, 1)).toEqual([bands[0]]);
    expect(bandsNear(bands, 1e5, 1e5, 12)).toEqual([]);

    // and keeps one it has already stood up until you are properly clear of it, so nothing blinks
    const edge = { x: here.x + (ROAM.SIGHT + ROAM.LEAVE) / 2, z: here.z };
    expect(bandsNear(bands, edge.x, edge.z, 12)).toEqual([]);
    expect(outOfSight(bands[0], edge.x, edge.z, 12)).toBe(false);
    expect(outOfSight(bands[0], here.x + ROAM.LEAVE + 1, here.z, 12)).toBe(true);
  });
});

describe('what a band does to a village', () => {
  const band = planBands(1, world(1))[0];
  const home = band.circuit[0];

  it('leans on what it is standing over and on nothing over the horizon', () => {
    const day = badDay(band);
    const now = bandAt(band, day);
    expect(pressureOn(band, { name: 'here', x: now.x, z: now.z }, day)).toBeGreaterThan(0);
    expect(pressureOn(band, nowhere, day)).toBe(0);
    // and it is gentler at arm's length than on the doorstep
    const doorstep = pressureOn(band, { name: 'a', x: now.x, z: now.z }, day);
    const fields = pressureOn(band, { name: 'b', x: now.x + ROAM.PRESS_WITHIN * 0.7, z: now.z }, day);
    expect(fields).toBeGreaterThan(0);
    expect(fields).toBeLessThan(doorstep);
  });

  it('costs a village people, and costs a village nothing ever reaches none', () => {
    const bands = planBands(1, world(1));
    const over = (place: { name: string; x: number; z: number }) => {
      let taken = 0, worstDay = 0, worstNight = 1;
      for (let day = 1; day <= 60; day++) {
        let today = 0;
        for (const b of bands) {
          const on = pressureOn(b, place, day);
          today += tollOf(b, place, day, on);
          worstNight = Math.max(worstNight, nightsNear(on));
        }
        taken += today;
        worstDay = Math.max(worstDay, today);
      }
      return { taken, worstDay, worstNight };
    };

    const worked = world(1).villages.map(over).sort((a, b) => b.taken - a.taken)[0];
    const spared = over(nowhere);
    // the places bands work bury people over a couple of months; a place off every round buries
    // nobody at all, and has ordinary nights while it is at it
    expect(worked.taken).toBeGreaterThan(10);
    expect(spared.taken).toBe(0);
    expect(spared.worstNight).toBe(1);
    // and on a bad day one takes more than a village can replace, which is how a place that was
    // doing well enough in the spring is failing by the summer
    expect(worked.worstDay).toBeGreaterThan(1);
    expect(worked.worstNight).toBeGreaterThan(1);
    expect(worked.worstNight).toBeLessThanOrEqual(1 + ROAM.NIGHTS_WORSE);
    expect(nightsNear(0)).toBe(1);
  });

  it('says what should happen and does none of it', () => {
    const day = badDay(band);
    const pressing = pressingOn(band, home, day);
    expect(pressing).not.toBeNull();
    expect(pressing!.village).toBe(home.name);
    expect(pressing!.said).toContain(home.name);
    expect(pressing!.nights).toBe(nightsNear(pressing!.pressure));
    // asked twice, it answers the same thing: nothing anywhere has been changed by asking
    expect(pressingOn(band, home, day)).toEqual(pressing);
    expect(pressingOn(band, nowhere, day)).toBeNull();
  });

  it('leans less as its numbers are cut down', () => {
    const day = badDay(band);
    const whole = pressureOn(band, home, day, band.size);
    const half = pressureOn(band, home, day, Math.ceil(band.size / 2));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(whole);
    expect(pressureOn(band, home, day, 0)).toBe(0);
  });
});

describe('the ebb', () => {
  const bands = planBands(1, world(1));

  it('has quiet spells and bad ones rather than one long slide', () => {
    for (const band of bands.slice(0, 8)) {
      const days: number[] = [];
      for (let day = 1; day <= 90; day++) days.push(temperOf(band, day));
      expect(Math.max(...days)).toBeLessThanOrEqual(1);
      expect(Math.min(...days)).toBe(0);                       // every band takes weeks off
      expect(days.filter((t) => t === 0).length).toBeGreaterThan(5);
      expect(Math.max(...days)).toBeGreaterThan(0.4);          // and every band has bad weeks

      // it falls as often as it rises: pressure that only ever went up would be a slope with an
      // end to it, and there would be nothing to arrive in time for
      let up = 0, down = 0;
      for (let i = 1; i < days.length; i++) (days[i] > days[i - 1] ? up++ : down++);
      expect(Math.min(up, down)).toBeGreaterThan(days.length / 4);
    }
  });

  it('is no worse in its third month than in its first', () => {
    const month = (band: Band, from: number) => {
      let sum = 0;
      for (let day = from; day < from + 30; day++) sum += temperOf(band, day);
      return sum;
    };
    const first = bands.reduce((sum, b) => sum + month(b, 1), 0);
    const third = bands.reduce((sum, b) => sum + month(b, 61), 0);
    // the same world left alone for a season is not a worse world: the ebb has no trend in it
    expect(third).toBeLessThan(first * 1.5);
    expect(third).toBeGreaterThan(first * 0.5);
  });
});

describe('dealing with one', () => {
  const structures = world(1);
  const opened = () => new Roaming(1, structures, 10);

  it('breaks when enough of it is put down, and stops leaning on anything', () => {
    const roaming = opened();
    const band = roaming.abroad()[0];
    expect(roaming.standing(band)).toBe(band.size);
    expect(roaming.alive(band)).toEqual(everyone(band));
    // a pack does not have to be killed to the last one: the rest of it runs
    expect(breaksAt(band)).toBeLessThan(band.size);

    const enough = band.size - breaksAt(band);
    for (let member = 0; member < enough - 1; member++) roaming.felled(band, member, 10);
    expect(roaming.isBroken(band)).toBe(false);
    expect(roaming.standing(band)).toBe(band.size - enough + 1);
    // and the ones left keep the numbers they were stood up with, so the next kill is not a guess
    expect(roaming.alive(band)).toEqual(everyone(band).slice(enough - 1));
    expect(roaming.alive(band).length).toBe(roaming.standing(band));

    expect(roaming.felled(band, enough - 1, 10)).not.toBeNull();
    expect(roaming.isBroken(band)).toBe(true);
    expect(roaming.abroad().map((b) => b.id)).not.toContain(band.id);
    expect(roaming.pressings([band.circuit[0]], 10).map((p) => p.band.id)).not.toContain(band.id);
  });

  it('lets a pack scatter and makes a lone thing be killed outright', () => {
    const sizes = new Set<number>();
    for (const band of planBands(1, structures)) {
      sizes.add(band.size);
      expect(breaksAt(band)).toBeLessThan(band.size);
      // one or two of something have nobody to run with; a real pack always leaves survivors
      if (band.size >= 3) expect(breaksAt(band)).toBeGreaterThan(0);
      else expect(breaksAt(band)).toBe(0);
    }
    // and a world holds both sorts, so both halves of that are worth having
    expect([...sizes].some((n) => n >= 3)).toBe(true);
    expect([...sizes].some((n) => n <= 2)).toBe(true);
  });

  it('stays broken for the stated time, and then something else moves in', () => {
    const roaming = opened();
    const band = roaming.abroad()[0];
    for (let member = 0; member < band.size - breaksAt(band); member++) roaming.felled(band, member, 10);
    expect(roaming.backOn(band)).toBe(10 + ROAM.BROKEN_FOR);

    // the day before, its ground is still quiet
    expect(roaming.advance(10 + ROAM.BROKEN_FOR - 1)).toEqual([]);
    expect(roaming.isBroken(roaming.bandOf(0))).toBe(true);

    const arrived = roaming.advance(10 + ROAM.BROKEN_FOR);
    expect(arrived.map((b) => b.id)).toEqual([band.id]);
    expect(arrived[0].era).toBe(band.era + 1);
    expect(roaming.standing(arrived[0])).toBe(arrived[0].size);
    expect(roaming.isBroken(arrived[0])).toBe(false);
    expect(roaming.abroad().map((b) => b.id)).toContain(band.id);
    // and it is a different pack on that ground, rolled from the era rather than from the old one
    expect(bandFor(1, stopsOf(structures), 0, 1)).toEqual(arrived[0]);
  });

  it('counts one kill once, however many people saw it', () => {
    const roaming = opened();
    const band = roaming.abroad()[0];
    const fell = roaming.felled(band, 0, 10);
    expect(fell).not.toBeNull();
    expect(roaming.felled(band, 0, 10)).toBeNull();
    expect(roaming.apply(fell!)).toBe(false);
    expect(roaming.standing(band)).toBe(band.size - 1);

    // a kill against a pack that is already dead and buried changes nothing about its successor
    expect(roaming.apply({ band: band.id, era: band.era + 1, member: 0, day: 10 })).toBe(false);
    expect(roaming.apply({ band: 'band:nonsense', era: 0, member: 0, day: 10 })).toBe(false);
    expect(roaming.standing(band)).toBe(band.size - 1);
  });

  it('carries the killing across a save and nothing the seed already knows', () => {
    const roaming = opened();
    const band = roaming.abroad()[0];
    const enough = band.size - breaksAt(band);
    for (let member = 0; member < enough; member++) roaming.felled(band, member, 10);
    const saved = roaming.save();
    expect(saved.lost.length).toBe(enough);
    expect(saved.broken[band.id]).toBe(10);

    const reopened = Roaming.from(1, structures, saved, 10);
    expect(reopened.isBroken(reopened.bandOf(0))).toBe(true);
    expect(reopened.abroad().map((b) => b.id)).toEqual(roaming.abroad().map((b) => b.id));
    expect(reopened.advance(10 + ROAM.BROKEN_FOR).map((b) => b.id)).toEqual([band.id]);
  });

  it('has a word for anybody who walks into one', () => {
    for (const band of planBands(1, structures)) {
      expect(warningFor(band)).toContain(band.circuit[0].name);
    }
  });
});

describe('one person can hold a region, and not a world', () => {
  it('puts a handful of bands over a neighbourhood and a world of them over a world', () => {
    for (const seed of [1, 2, 5, 12]) {
      const structures = world(seed);
      const bands = planBands(seed, structures);
      const villages = structures.villages;
      const region = regionOf(villages, villages[0].x, villages[0].z);
      expect(region.length).toBeGreaterThan(0);
      expect(region.length).toBeLessThan(villages.length);

      // a band broken today is back in BROKEN_FOR days, so what somebody has to hold is however
      // many different bands come over their ground inside one of those windows
      let mostHere = 0, mostAnywhere = 0;
      for (let start = 1; start <= 60; start++) {
        const here = new Set<string>();
        const anywhere = new Set<string>();
        for (let day = start; day < start + ROAM.BROKEN_FOR; day++) {
          for (const b of bandsOver(bands, region, day)) here.add(b.id);
          for (const b of bandsOver(bands, villages, day)) anywhere.add(b.id);
        }
        mostHere = Math.max(mostHere, here.size);
        mostAnywhere = Math.max(mostAnywhere, anywhere.size);
      }
      expect(mostHere).toBeLessThanOrEqual(ROAM.HOLD);
      expect(mostAnywhere).toBeGreaterThanOrEqual(ROAM.HOLD * 2);
      expect(mostAnywhere).toBeGreaterThanOrEqual(mostHere * 3);
    }
  });

  it('leaves nowhere in the world permanently safe', () => {
    const structures = world(1);
    const bands = planBands(1, structures);
    // every village is worked by something over a season: a place nothing ever comes to is a
    // place nobody has any reason to defend
    for (const village of structures.villages) {
      let seen = 0;
      for (let day = 1; day <= 90; day++) seen += bandsOver(bands, [village], day).length;
      expect(seen).toBeGreaterThan(0);
    }
  });
});
