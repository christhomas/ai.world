import { describe, expect, it } from 'vitest';
import { aroundOf } from '../world/around';
import { Register } from '../world/register';
import { createTidings, type Telling } from './tidings';
import type { Band, Pressing, Roaming } from './roaming';
import type { Director } from './director';
import type { Mines } from './mines';
import type { Nemesis, Realm } from './nemesis';
import type { Online } from './online';
import type { Places } from './places';
import type { Player } from '../entities/player';
import type { Remains } from './remains';
import type { Sound } from './audio';
import type { GameState } from './state';
import type { Site, Structures } from '../world/structures';
import type { TerrainSampler } from '../world/terrain';

/**
 * The day's news, and the two ways of getting a memo wrong.
 *
 * This runs out of the frame loop, sixty times a second, over answers that change once a game day.
 * Both faults pinned here were found in a running game rather than read out of the code, and both
 * are the same mistake: something was remembered under a key narrower than the thing it described.
 *
 * The first put twenty-seven identical lines a second into the chat — measured, in the endless
 * world, standing still — because a village with two bands over it kept one memo between them and
 * the two bands overwrote each other for ever. The second gave the register the *lightest* of the
 * pressures on a village rather than the worst, so a place with two bands on it counted as safer
 * than a place with one. Neither shows up as a crash and neither shows up in a screenshot.
 */

const VILLAGE = 'Stonedale';
const TRADES = ['farmer', 'hunter', 'seller'];

/** A band with just enough of one to be told from another: a name, and a seed to roll a toll from. */
const bandNamed = (name: string): Band => ({ id: `band:${name}`, seed: 7 } as unknown as Band);

/** Everything a pressing carries, so a test can say exactly what is leaning on where, and how hard. */
function leaning(band: Band, pressure: number, said: string, toll = 0, cattle = 0): Pressing {
  return { band, village: VILLAGE, pressure, nights: 1, toll, cattle, said };
}

interface Around {
  pressings?: Pressing[];
  register?: Register;
  /** Whether the hero is out of doors, which is the one thing the proximity half asks about. */
  outdoors?: boolean;
  /** Which cave this village calls its mine, for the half of this that is about standing somewhere. */
  mine?: boolean;
  /** What the mine has to say when somebody walks into the square, if anything. */
  told?: () => string | null;
}

/**
 * The world around `theDaysNews`, stubbed down to what it actually touches.
 *
 * The register is real, because what the day's news does to a village is the half worth checking,
 * and it is watched rather than replaced so a test can see what it was told. `roaming` is not
 * real: the bug is in how the pressings are *consumed*, so they are handed over directly rather
 * than coaxed out of a seed that happens to put two bands on one place.
 */
function telling(around: Around = {}) {
  const theCountry = {
    villages: [{ name: VILLAGE, x: 0, z: 0, radius: 10 }], pois: [], caves: [], wrecks: [],
  } as unknown as Structures;
  const register = around.register ?? new Register(1);
  const said: string[] = [];
  const flashed: string[] = [];
  const leant: Array<{ village: string; pressure: number }> = [];
  const state = { day: 1, time: 0.5 } as unknown as GameState;

  // shadowing the method on the instance, so everything else about the register stays the register
  const wasLeanedOn = register.leanedOn.bind(register);
  register.leanedOn = (village: string, pressure: number): void => {
    leant.push({ village, pressure });
    wasLeanedOn(village, pressure);
  };

  const ctx: Telling = {
    seed: 1,
    state,
    player: { x: 0, z: 0 } as unknown as Player,
    places: { outdoors: around.outdoors ?? false } as unknown as Places,
    structures: theCountry,
    // the real seam over the same stub country: what is near a place is a filter over a list here,
    // exactly as it is in every bounded world, so nothing about this test has to know it exists
    around: aroundOf(theCountry),
    sampler: { storeys: new Map<string, number>() } as unknown as TerrainSampler,
    register,
    roaming: { advance: () => [], pressings: () => around.pressings ?? [] } as unknown as Roaming,
    nemesis: { advance: () => [] } as unknown as Nemesis,
    mines: { advance: () => [], told: around.told ?? (() => null) } as unknown as Mines,
    online: { report: () => {} } as unknown as Online,
    remains: { leave: () => {} } as unknown as Remains,
    sound: { chime: () => {} } as unknown as Sound,
    director: { saw: () => {} } as unknown as Director,
    claimed: around.mine
      ? new Map([[VILLAGE, { name: 'Deepshaft', x: 5, z: 5 } as unknown as Site]])
      : new Map<string, Site>(),
    villageLuxury: new Map(),
    discovered: new Set(),
    realm: () => ({} as Realm),
    builderDay: () => {},
    villageNights: () => [],
    say: (line) => { said.push(line); },
    flash: (message) => { flashed.push(message); },
    persist: () => {},
  };
  return { tidings: createTidings(ctx), said, flashed, leant, state, register };
}

describe('the news a day brings', () => {
  it('lets two bands leaning on one village say their piece once each, not once a frame', () => {
    /*
     * The measured bug, exactly. `pressings` comes back one entry per band *per village*, and the
     * memo was keyed by the village alone — so each band's sentence was forever unlike the one the
     * other band had just stored, both were "new" on every frame, and the chat filled up with the
     * same two lines at twenty-seven a second until the tab was closed.
     */
    const bears = leaning(bandNamed('Ashford'), 0.5, `Bears have been at ${VILLAGE} for days.`);
    const dead = leaning(bandNamed('Fernmoor'), 0.4, `The walking dead have been at ${VILLAGE} for days.`);
    const { tidings, said } = telling({ pressings: [bears, dead] });

    for (let frame = 0; frame < 60; frame++) tidings.theDaysNews();

    expect(said).toEqual([bears.said, dead.said]);
  });

  it('does not say it again tomorrow, because the same news is not news', () => {
    const bears = leaning(bandNamed('Ashford'), 0.5, `Bears have been at ${VILLAGE} for days.`);
    const dead = leaning(bandNamed('Fernmoor'), 0.4, `The walking dead have been at ${VILLAGE} for days.`);
    const { tidings, said, state } = telling({ pressings: [bears, dead] });

    for (let day = 1; day <= 5; day++) {
      state.day = day;
      for (let frame = 0; frame < 10; frame++) tidings.theDaysNews();
    }
    expect(said).toEqual([bears.said, dead.said]);
  });

  it('says a band\'s piece again when what it has to say has changed', () => {
    // the memo holds what was last heard, not whether anything was ever heard: a village that has
    // gone from bad to worse is news, and the band that made it worse is the one saying so
    const band = bandNamed('Ashford');
    const first = leaning(band, 0.5, `Bears have been at ${VILLAGE} for days.`);
    const worse = leaning(band, 0.9, `${VILLAGE} is being bled white.`);
    const pressings = [first];
    const { tidings, said, state } = telling({ pressings });

    tidings.theDaysNews();
    pressings[0] = worse;
    state.day = 2;
    tidings.theDaysNews();
    expect(said).toEqual([first.said, worse.said]);
  });

  it('tells the register the worst of what is leaning on a village, not the last of it', () => {
    /*
     * The same fault as the memo, one line further down. `pressings` comes back worst first and
     * `leanedOn` overwrites, so a village with two bands over it was recorded at whichever pressure
     * was iterated *last* — the lightest of them. Two bands made a place safer than one, and a
     * village being bled by a dragon went on trading and bearing children because a wolf pack
     * happened to be in the neighbourhood as well.
     */
    const dragon = leaning(bandNamed('Ashford'), 0.9, 'A dragon is over Stonedale.');
    const wolves = leaning(bandNamed('Fernmoor'), 0.3, 'Wolves are about.');
    const { tidings, leant } = telling({ pressings: [dragon, wolves] });

    tidings.theDaysNews();
    // twice, either side of the register living the day, and both with the worst of the two — see
    // the note in `tidings.ts` for why one telling can only answer one of the two questions asked
    expect(leant).toEqual([
      { village: VILLAGE, pressure: 0.9 },
      { village: VILLAGE, pressure: 0.9 },
    ]);
  });

  it('leaves a pressed village reading as pressed for the rest of the day', () => {
    /*
     * The consequence of telling the news once a day rather than sixty times a second, and the
     * reason it is told twice. A pressing carries the day it was said on, and the register answers
     * two questions from it: what to charge a village for the day it is about to live, and what is
     * standing over the place now — which the clerk's book and the domesday report both ask. The
     * first wants a telling from before the day was lived and the second wants one from after it.
     */
    const register = new Register(4);
    register.settle(VILLAGE, 6, TRADES);
    const { tidings, state } = telling({ register, pressings: [leaning(bandNamed('Ashford'), 0.9, 'A dragon.')] });

    // a day the register has yet to live, because that is the case the two tellings are about: one
    // of them has to be dated before it lives the day and the other after
    state.day = 2;
    tidings.theDaysNews();
    expect(register.pressureOn(VILLAGE), 'the books say nothing is standing over it').toBe(0.9);
  });

  it('takes a band\'s toll once for the day and not once for every frame of it', () => {
    /*
     * Not a performance question at all, though it was found while looking for one. `tollOf` is a
     * pure function of the band, the village and the day, so every frame took the same number of
     * people again off a village that was one shorter than it had been a sixtieth of a second
     * before. A village under real pressure emptied in about the time it takes to read this.
     */
    const register = new Register(2);
    register.settle(VILLAGE, 6, TRADES);
    const before = register.living(VILLAGE).length;
    expect(before).toBeGreaterThan(4);

    const { tidings } = telling({ register, pressings: [leaning(bandNamed('Ashford'), 0.5, 'Bears.', 1)] });
    for (let frame = 0; frame < 60; frame++) tidings.theDaysNews();

    expect(register.living(VILLAGE).length, 'a village buried somebody on every frame').toBe(before - 1);
  });

  it('goes on asking about the mine underfoot every frame, because that one is about where you stand', () => {
    /*
     * The day gate must not reach this. A mine the player has fought through stays a mine nobody
     * will go down until somebody walks into the village and says otherwise, and standing in the
     * square is that somebody — a player does not stand still for a whole game day to do it.
     */
    const register = new Register(3);
    register.settle(VILLAGE, 6, TRADES);
    let reassurances = 0;
    const { tidings, flashed } = telling({
      register, outdoors: true, mine: true,
      told: () => (reassurances++ === 0 ? 'They are going back down at Deepshaft.' : null),
    });

    // the same day throughout: nothing about the gate above can be what lets this through
    tidings.theDaysNews();
    tidings.theDaysNews();
    expect(flashed).toEqual(['They are going back down at Deepshaft.']);
    expect(reassurances, 'the mine was asked once and then never again').toBe(2);
  });
});
