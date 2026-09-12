import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from '../world/graph';
import { TerrainSampler } from '../world/terrain';
import type { Structures } from '../world/structures';
import {
  ROAM, Roaming, bandAt, bandFor, bandsNear, bandsOver, breaksAt, distanceTo, nightsNear,
  groundsOf, outOfSight, planBands, pressingOn, pressureOn, regionOf, stopsOf, temperOf, tollOf, warningFor,
  type Band, wayTo, nameFor, DRAGON_COUNTRY,
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

/**
 * A day this band is in a mood *and* standing over the given place.
 *
 * Both halves matter and only asking for the first is a test that passes by luck: a band leans on
 * what it is standing over, so a bad day it happens to spend two valleys away proves nothing about
 * leaning. Whichever way the world is laid out, a band comes home on its round.
 */
const badDayOver = (band: Band, place: { name: string; x: number; z: number }): number => {
  for (let day = 1; day <= 400; day++) if (pressureOn(band, place, day) > 0) return day;
  throw new Error(`a band that never comes to ${place.name} is a bug in the round`);
};

describe('where a band is', () => {
  it('is the same place for everybody who asks, and a different place tomorrow', () => {
    const bands = planBands(1, world(1));
    // no count to check against any more: a country has as many bands as it has ground worth
    // holding, so what is asked is that it is neither a wilderness nor a war
    expect(bands.length, 'a country nothing walks in').toBeGreaterThan(8);
    expect(bands.length, 'a country that is all war bands').toBeLessThan(stopsOf(world(1)).length);
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

    // and keeps one it has already stood up until you are properly clear of it, so nothing blinks.
    // Asked about this band rather than about the whole list: whether some *other* band happens to
    // be walking past the same spot on the same day is a fact about one world's villages, and the
    // day the ground stopped being flat it stopped being true — Millmoor's round came within sight
    // of Elderwick's, which is a thing bands are allowed to do.
    const edge = { x: here.x + (ROAM.SIGHT + ROAM.LEAVE) / 2, z: here.z };
    expect(bandsNear(bands, edge.x, edge.z, 12)).not.toContain(bands[0]);
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
    const day = badDayOver(band, home);
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
    const day = badDayOver(band, home);
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

      // it falls about as often as it rises: pressure that only ever went up would be a slope with
      // an end to it, and there would be nothing to arrive in time for.
      //
      // A sixth rather than a quarter, because a spell that is quiet for most of a month is flat
      // for those days and flat counts as neither up nor down; asking for a quarter each way was
      // asking for a band that is never at rest, which is the opposite of what this is about. It
      // was a fifth until the ground stopped being flat: a band's temper is drawn from its own
      // name, the names moved when the villages did, and Elderwick came out at sixteen days of
      // ninety against a fence of eighteen. Nothing about the rhythm changed — a different band
      // was asked. The fence is a claim about the shape of a spell rather than about whichever
      // band happens to sort first, so it is set below where any of them lands rather than on top
      // of one of them.
      let up = 0, down = 0;
      for (let i = 1; i < days.length; i++) (days[i] > days[i - 1] ? up++ : down++);
      expect(Math.min(up, down), `${band.id} rises ${up} days and falls ${down} of ${days.length}`)
        .toBeGreaterThanOrEqual(days.length / 6);
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
    expect(roaming.isBroken(roaming.groundFor(band.id)!)).toBe(true);

    const arrived = roaming.advance(10 + ROAM.BROKEN_FOR);
    expect(arrived.map((b) => b.id)).toEqual([band.id]);
    expect(arrived[0].era).toBe(band.era + 1);
    expect(roaming.standing(arrived[0])).toBe(arrived[0].size);
    expect(roaming.isBroken(arrived[0])).toBe(false);
    expect(roaming.abroad().map((b) => b.id)).toContain(band.id);
    // and it is a different pack on that ground, rolled from the era rather than from the old one
    expect(bandFor(1, stopsOf(structures), band.circuit[0], 1)).toEqual(arrived[0]);
  });

  it('holds the roster between calls, and lets go of it the moment a ground changes hands', () => {
    /*
     * Rolling the roster is not cheap — every stop in the country sorted by distance from every
     * band's home — and it was being rolled on every frame, because the frame loop asks for the
     * day's news, which asks `pressings`, which asks `abroad`, which asks this. Half a millisecond
     * a frame and thirty milliseconds a second for an answer that changes once in many days.
     *
     * Identity rather than equality, because equality is what the bug already satisfied: what is
     * under test is that the work was not done a second time.
     */
    const roaming = opened();
    const held = roaming.roster();
    expect(roaming.roster(), 'rolled again for nothing').toBe(held);
    expect(roaming.abroad().length).toBeGreaterThan(0);
    expect(roaming.roster(), 'and asking what is abroad rolled it again').toBe(held);

    // and the one thing that can make it wrong: a broken band's ground taken over by something else
    const band = roaming.abroad()[0];
    for (let member = 0; member < band.size - breaksAt(band); member++) roaming.felled(band, member, 10);
    expect(roaming.roster(), 'a kill is not a new pack').toBe(held);

    roaming.advance(10 + ROAM.BROKEN_FOR);
    const after = roaming.roster();
    expect(after, 'a ground changed hands and the old roster was handed back').not.toBe(held);
    expect(after.find((b) => b.id === band.id)!.era).toBe(band.era + 1);
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
    expect(reopened.isBroken(reopened.groundFor(band.id)!)).toBe(true);
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
      // The half that matters, and the reason the whole idea works: what one person is asked to
      // hold is what comes over their own neighbourhood, and that has to be a life rather than a
      // second job.
      expect(mostHere, `a neighbourhood of seed ${seed} has ${mostHere} bands over it, which nobody can hold`)
        .toBeLessThanOrEqual(ROAM.HOLD);
      // And the country beyond it has more, which is what makes holding a region a different job
      // from holding a world.
      //
      // This used to ask for three times as many, and that was really a measurement of how big a
      // bounded world is: a region is three villages, and in a world of six that is half the
      // country, so the ratio was only ever a statement about the size of the map. In a country
      // with no edge the true form of it is unbounded and untestable — what can be said is the
      // direction, and that a neighbourhood is a clear minority of what is out there.
      expect(mostAnywhere, 'the country beyond a neighbourhood is no worse than the neighbourhood')
        .toBeGreaterThan(mostHere);
      expect(mostAnywhere).toBeGreaterThanOrEqual(ROAM.HOLD * 2);
    }
  });

  it('leaves nowhere in the world permanently safe', () => {
    // Four worlds rather than one. With a single seed this passed for years while two of the four
    // had villages nothing ever came to — a band takes the next ground off a shuffled deck, and a
    // village at the bottom of the deck that was also outside everybody's circuit was never worked
    // by anything. Villages are dealt before landmarks now, and there are more bands than villages.
    for (const seed of [1, 2, 12, 33]) forEveryVillage(seed);
  });

  const forEveryVillage = (seed: number): void => {
    const structures = world(seed);
    const bands = planBands(seed, structures);
    // every village is worked by something over a season: a place nothing ever comes to is a
    // place nobody has any reason to defend
    for (const village of structures.villages) {
      let seen = 0;
      for (let day = 1; day <= 90; day++) seen += bandsOver(bands, [village], day).length;
      expect(seen, `${village.name} in seed ${seed} is never worked by anything`).toBeGreaterThan(0);
    }
  };
});

/**
 * "Wolves have been at Silverton for days" names a village the player may never have seen, with
 * no way to act on it. The quest system had already solved the same problem in the same words.
 */
describe('saying where the trouble is', () => {
  const place = { name: 'Silverton', x: 300, z: 0 };

  it('gives a direction and a rough distance', () => {
    const said = wayTo(place, { x: 0, z: 0 })!;
    expect(said).toContain('east');
    expect(said).toMatch(/\d+ paces/);
  });

  it('rounds the distance, because nobody says three hundred and seven', () => {
    expect(wayTo({ name: 'X', x: 307, z: 0 }, { x: 0, z: 0 })).toContain('310 paces');
  });

  it('says nothing to somebody already standing in it', () => {
    expect(wayTo(place, { x: 305, z: 4 })).toBeNull();
  });

  it('turns with the player rather than being fixed to the village', () => {
    expect(wayTo(place, { x: 600, z: 0 })).toContain('west');
  });
});

/**
 * A band belongs to the place it works out of, not to a number in a list.
 *
 * This is what lets bands exist in a country with no edge. A slot is a position among everything
 * there is, and there is no everything; a name is a fact about one place, and two people in
 * different corners of the world can agree about it without either of them knowing what else the
 * world contains.
 */
describe('bands named after their ground', () => {
  const structures = world(1);
  const stops = stopsOf(structures);

  it('names every band after the place it works out of', () => {
    for (const band of planBands(1, structures)) {
      expect(band.id).toBe(`band:${band.circuit[0].name}`);
    }
  });

  it('gives the same country the same grounds however it is asked', () => {
    const once = groundsOf(1, stops).map((s) => s.name);
    const again = groundsOf(1, [...stops].reverse()).map((s) => s.name);
    expect(once.length, 'a country with no bands in it').toBeGreaterThan(4);
    expect(again, 'the grounds depend on the order the country was listed in').toEqual(once);
  });

  it('decides each place on its own, so a patch of country is a patch of the whole', () => {
    // the grounds of half a country, worked out from that half alone, are the grounds the whole
    // country has there — which is the property an endless world is built on
    const west = stops.filter((s) => s.x < 0);
    expect(west.length, 'nothing in the western half').toBeGreaterThan(2);
    const whole = new Set(groundsOf(1, stops).map((s) => s.name));
    for (const stop of groundsOf(1, west)) {
      // a landmark may be beaten by a neighbour outside this half, so only the certain half is
      // asked: anything the half thinks is a ground, the whole country must at least know of
      if (!stop.lived) continue;
      expect(whole.has(stop.name), `${stop.name} holds a band in half a country and not in all of it`).toBe(true);
    }
  });

  it('forgets a band from a world that was numbered rather than named', () => {
    const roaming = Roaming.from(1, structures, { lost: [], broken: { 'band:7': 3 }, era: {} }, 3);
    // it does not throw, it does not resurrect somebody else's pack, and the record simply lapses
    expect(roaming.groundFor('band:7')).toBeNull();
    expect(roaming.advance(3 + ROAM.BROKEN_FOR)).toEqual([]);
  });
});

/**
 * The dragon, which is the roaming system asked for something it was not built for and doing it.
 *
 * Every other band works a quarter of a region: four stops inside `CIRCUIT`, a couple of days'
 * walk apart, and a village's bad fortnight is something a player can go and deal with. A dragon is
 * the thing you hear about three villages before you see it — so its round is drawn from the whole
 * country it can reach, and nothing else about it is new. Where it is still comes out of the seed
 * and the day, it still has a temper that ebbs, and killing it still travels.
 */
describe('a dragon', () => {
  it('works a country rather than a neighbourhood', () => {
    const stops = stopsOf(world(5));
    const reach = (kind: string) => {
      const homes = stops.filter((_, i) => i % 3 === 0).slice(0, 12);
      const spans: number[] = [];
      for (const home of homes) {
        // asked of the same home over many eras, taking the rounds that came out this kind: what
        // is being measured is how far a round of this sort reaches, not which sort a home rolls
        for (let era = 0; era < 60; era++) {
          const band = bandFor(5, stops, home, era);
          if (band.kind !== kind) continue;
          const far = Math.max(...band.circuit.map((s) => Math.hypot(s.x - home.x, s.z - home.z)));
          spans.push(far);
        }
      }
      return spans;
    };
    const dragons = reach('dragon');
    const wolves = reach('wolf');
    expect(dragons.length, 'no world rolled a dragon at all').toBeGreaterThan(0);
    expect(Math.max(...dragons), 'a dragon keeps to a wolf pack\'s valley')
      .toBeGreaterThan(Math.max(...wolves));
  });

  it('comes alone, and is the worst thing there is', () => {
    expect(ROAM.SORTS.dragon.least).toBe(1);
    expect(ROAM.SORTS.dragon.most).toBe(1);
    expect(ROAM.SORTS.dragon.menace).toBe(1);
  });

  it('keeps out of the country a player starts in', () => {
    /*
     * Asked for in as many words: the middle of the world is where somebody begins, and a dragon
     * over the village you started in is a game that kills you before you have a sword.
     *
     * A radius rather than a ring, and that is the load-bearing part. The endless country rests on
     * "a place's content is settled by a bounded neighbourhood, never by how you got there" — and a
     * ring counted outward from the middle is exactly the traversal that rule forbids. A distance
     * is the same answer asked from any direction.
     */
    const stops = stopsOf(world(5));
    const near = stops.filter((s) => Math.hypot(s.x, s.z) < DRAGON_COUNTRY);
    const far = stops.filter((s) => Math.hypot(s.x, s.z) >= DRAGON_COUNTRY);
    expect(near.length, 'this world has no near country to speak of').toBeGreaterThan(0);

    const rolled = (where: typeof stops) => {
      let dragons = 0;
      for (const home of where) for (let era = 0; era < 40; era++) {
        if (bandFor(5, stops, home, era).kind === 'dragon') dragons++;
      }
      return dragons;
    };
    expect(rolled(near), 'a dragon was put on the country a player starts in').toBe(0);
    if (far.length > 0) expect(rolled(far), 'and none in the far country either').toBeGreaterThan(0);
  });

  it('is rare: most of what a country holds is something a player can beat', () => {
    // one in twenty. Twice that and a world has a dragon over every second village, which is a
    // world where a dragon is weather rather than an event
    expect(ROAM.SORTS.dragon.share).toBeLessThanOrEqual(0.06);
    const beatable = ROAM.SORTS.wolf.share + ROAM.SORTS.bear.share + ROAM.SORTS.skeleton.share;
    expect(beatable).toBeGreaterThan(0.8);
  });

  it('is spoken of without ever being named', () => {
    // nobody who has seen one calls it anything: what a village says is what they saw
    const stops = stopsOf(world(5));
    const band = { ...bandFor(5, stops, stops[0], 0), kind: 'dragon' as const };
    expect(nameFor(band)).not.toContain('ragon');
    expect(warningFor(band)).toContain('dragon');
  });
});
