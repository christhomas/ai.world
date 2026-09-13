import { describe, expect, it } from 'vitest';
import { AWAKE } from '../entities/entity';
import { generateRoadGraph } from '../world/graph';
import { StructureKind } from '../world/structures';
import { TerrainSampler } from '../world/terrain';
import { DAY_LENGTH } from './state';
import {
  HAUNT, abroad, gone, hauntNear, hauntOf, hauntsOf, placesOf, pursues, reachOf, toRaise,
  untilDawn, warningFor, type Haunt,
} from './haunts';

const world = (seed: number) => new TerrainSampler(generateRoadGraph(seed)).structures;

/** Two made-up places, for the questions that are about the clock rather than about the map. */
const barrow: Haunt = { id: 'poi:0,0', name: 'Fallen Keep', x: 0, z: 0, ground: 'ruin', kind: 'wight' };
const wood: Haunt = { id: 'poi:200,0', name: 'The Great Oak', x: 200, z: 0, ground: 'wood', kind: 'ogre' };

const NOON = (AWAKE[0] + AWAKE[1]) / 2;
const MIDNIGHT = 0.98;

describe('which places are kept', () => {
  it('are the same places in the same world however many times you ask', () => {
    const structures = world(1);
    const kept = hauntsOf(1, structures);
    expect(kept.length).toBeGreaterThan(0);
    expect(hauntsOf(1, structures)).toEqual(kept);

    // and one place, asked on its own with nothing else in hand, gives the same answer: this is
    // what lets two people in one world agree about a barrow without a byte crossing between them
    const byId = new Map(kept.map((h) => [h.id, h]));
    for (const place of placesOf(structures)) {
      expect(hauntOf(1, place)).toEqual(byId.get(place.id) ?? null);
    }
  });

  it('are different places in a world grown from a different seed', () => {
    // the same map, so the seed is the only thing that has changed
    const structures = world(1);
    const ids = (seed: number) => hauntsOf(seed, structures).map((h) => h.id).join('|');
    expect(ids(2)).not.toEqual(ids(1));
    expect(ids(3)).not.toEqual(ids(1));
  });

  it('leave most of the country alone, and never touch a shrine or a watchtower', () => {
    const structures = world(4);
    const places = placesOf(structures);
    const kept = hauntsOf(4, structures);
    expect(kept.length).toBeLessThan(places.length);

    const untouched = structures.pois
      .filter((p) => p.kind === StructureKind.Shrine || p.kind === StructureKind.Tower)
      .map((p) => p.name);
    expect(untouched.length).toBeGreaterThan(0);
    for (const haunt of kept) expect(untouched).not.toContain(haunt.name);
  });

  it('put what is buried in a ruin and what is large in a wood', () => {
    for (const haunt of hauntsOf(5, world(5))) {
      expect(haunt.kind).toBe(HAUNT.KEEPER[haunt.ground]);
    }
  });

  it('are found by standing on them, and by nothing else', () => {
    const kept = hauntsOf(6, world(6));
    const first = kept[0];
    expect(hauntNear(kept, first.x, first.z)).toBe(first);
    expect(hauntNear(kept, first.x + HAUNT.GROUND + 1, first.z)).not.toBe(first);
    expect(hauntNear(kept, 1e6, 1e6)).toBeNull();
  });
});

describe('a wight', () => {
  it('is abroad at night and is not there at all by day', () => {
    expect(abroad(barrow, MIDNIGHT)).toBe(true);
    expect(abroad(barrow, AWAKE[1] + 0.01)).toBe(true);      // just after the doors shut
    expect(abroad(barrow, NOON)).toBe(false);
    expect(abroad(barrow, AWAKE[0] + 0.01)).toBe(false);     // just after first light
  });

  it('comes for anybody on its ground, and lets them go the moment they are off it', () => {
    expect(pursues(barrow, 0, 0, MIDNIGHT)).toBe(true);
    expect(pursues(barrow, HAUNT.GROUND - 1, 0, MIDNIGHT)).toBe(true);
    expect(pursues(barrow, HAUNT.GROUND + 1, 0, MIDNIGHT)).toBe(false);
    // and by daylight it does not come for somebody standing on the grave itself
    expect(pursues(barrow, 0, 0, NOON)).toBe(false);
  });

  it('is put away by first light, whether or not you have moved', () => {
    expect(gone(barrow, 0, 0, MIDNIGHT)).toBe(false);
    expect(gone(barrow, 0, 0, NOON)).toBe(true);
    expect(gone(barrow, reachOf(barrow) + HAUNT.SLACK + 1, 0, MIDNIGHT)).toBe(true);
  });

  it('is not blinked in and out beside somebody walking the edge of its ground', () => {
    // just past the line it has stopped coming, and it is still standing there while you go
    const edge = HAUNT.GROUND + 1;
    expect(pursues(barrow, edge, 0, MIDNIGHT)).toBe(false);
    expect(gone(barrow, edge, 0, MIDNIGHT)).toBe(false);
  });
});

describe('an ogre', () => {
  it('keeps no hours: it is awake at noon and at midnight alike', () => {
    expect(abroad(wood, NOON)).toBe(true);
    expect(abroad(wood, MIDNIGHT)).toBe(true);
  });

  it('follows you off its own ground, which is why you have to actually run', () => {
    expect(reachOf(wood)).toBeGreaterThan(reachOf(barrow));
    expect(pursues(wood, wood.x + HAUNT.GROUND + 1, 0, NOON)).toBe(true);
    expect(pursues(wood, wood.x + HAUNT.ROAM + 1, 0, NOON)).toBe(false);
  });
});

describe('the hours before dawn', () => {
  it('are nothing at all while it is still day', () => {
    expect(untilDawn(NOON)).toBe(0);
    expect(untilDawn(AWAKE[0])).toBe(0);
  });

  it('are counted in real seconds, and are longest just after the doors shut', () => {
    const dusk = untilDawn(AWAKE[1] + 0.001);
    const nearlyMorning = untilDawn(AWAKE[0] - 0.001);
    expect(dusk).toBeGreaterThan(nearlyMorning);
    expect(nearlyMorning).toBeGreaterThan(0);
    expect(dusk).toBeCloseTo((1 - AWAKE[1] - 0.001 + AWAKE[0]) * DAY_LENGTH, 3);
    // long enough that waiting one out is a decision and not a pause
    expect(dusk).toBeGreaterThan(60);
  });
});

describe('standing what keeps a place up in the world', () => {
  const kept = [barrow, wood];

  it('raises nothing at all for somebody halfway across the country', () => {
    expect(toRaise(kept, 1e5, 1e5, MIDNIGHT)).toBeNull();
  });

  it('raises the nearest one you have walked up to', () => {
    expect(toRaise(kept, HAUNT.GROUND - 1, 0, MIDNIGHT)).toBe(barrow);
    expect(toRaise(kept, wood.x, 0, MIDNIGHT)).toBe(wood);
  });

  it('raises a wight only once you are on its ground, and an ogre from further off', () => {
    expect(toRaise(kept, HAUNT.GROUND + 1, 0, MIDNIGHT)).toBeNull();
    expect(toRaise([wood], wood.x - (HAUNT.ROAM - 1), 0, MIDNIGHT)).toBe(wood);
  });

  it('raises a wight only after dark, and an ogre whenever you come', () => {
    expect(toRaise(kept, 0, 0, NOON)).toBeNull();
    expect(toRaise(kept, wood.x, 0, NOON)).toBe(wood);
  });
});

describe('the word you get for walking onto kept ground', () => {
  it('tells you the thing that works, in words you can act on', () => {
    const spirit = warningFor(barrow);
    expect(spirit).toContain(barrow.name);
    expect(spirit).toMatch(/blade/);
    expect(spirit).toMatch(/ground/);

    const hulk = warningFor(wood);
    expect(hulk).toContain(wood.name);
    expect(hulk).toMatch(/outrun/);
  });
});

/*
 * Telling somebody the one thing they need to decide.
 *
 * A wight keeps to its ground and is quicker than you, so the question it poses is not "can I win"
 * — nothing can — it is *"can I wait this out, or do I have to leave?"* `untilDawn` has answered
 * that since the day it was written and nothing ever asked it: the warning named the danger and
 * left out the only number that makes it a decision. Found by `chore reachable`, which counts work
 * that exists and nothing calls.
 *
 * Only for a wight. An ogre is abroad at any hour, so how long until morning is no use to anybody
 * standing in front of one — and saying it anyway would teach the player that dawn matters when it
 * does not.
 */
describe('what a warning tells you to do about it', () => {
  const wight: Haunt = { id: 'r', name: 'Barrow', x: 0, z: 0, ground: 'ruin', kind: 'wight' };
  const ogre: Haunt = { id: 'w', name: 'Deepwood', x: 0, z: 0, ground: 'wood', kind: 'ogre' };

  /** How long it says you have, or nothing where it says nothing. Asked of the sentence, not of a word. */
  const minutes = (said: string): number | null => {
    const m = said.match(/(\d+) minutes/);
    return m ? Number(m[1]) : null;
  };

  it('tells you how long a wight has left, because waiting is the only other move', () => {
    const said = warningFor(wight, AWAKE[1] + 0.01);
    expect(said).toMatch(/no blade will touch/);
    expect(minutes(said), 'the player is deciding whether to wait, and cannot without this')
      .toBeGreaterThan(0);
  });

  it('counts down as the night goes on, so waiting gets easier to judge', () => {
    const early = minutes(warningFor(wight, AWAKE[1] + 0.01))!;
    const late = minutes(warningFor(wight, AWAKE[0] - 0.01))!;
    expect(late).toBeLessThan(early);
  });

  it('says nothing about the hour for an ogre, which is abroad at any of them', () => {
    expect(minutes(warningFor(ogre, AWAKE[1] + 0.01))).toBeNull();
  });

  it('still reads as a sentence when nobody says what time it is', () => {
    expect(warningFor(wight)).toMatch(/no blade will touch/);
    expect(minutes(warningFor(wight))).toBeNull();
  });
});
