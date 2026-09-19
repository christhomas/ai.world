import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * That a shot is taken in a world containing the thing it photographs.
 *
 * `chore shots mountain` never took a picture. Not once, in the whole life of the shot: there is no
 * `docs/screenshots/mountain.png` in this repository's history. Every run said the same thing —
 *
 *     missed mountain     nothing to photograph in this world today
 *
 * — because every shot in `shots.cjs` falls back to `world: 'road'` and this one had no world of
 * its own. A road-tree world is not `shaped`, so its high ground is `massifs`, and `planMassifs`
 * puts none on seed 3; `ranges` is null there by construction. Both of the things the shot's search
 * reads are therefore empty in the world it was being taken in.
 *
 * Nothing caught it because a shot that finds nothing is not a failure. `missed` is the honest
 * answer for a world that happens not to have a mountain in it today, so a shot that can *never*
 * find one reads exactly like one that is merely unlucky.
 *
 * Read off the source, because a shot is a browser and a world and is not a thing a unit test can
 * run. What can be held is the pairing, and the pairing is the bug.
 */
describe('the mountain shot', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'shots.cjs'), 'utf8');
  /** The shot's own entry: from its name to the end of its setup. */
  const entry = (): string => {
    const at = source.indexOf("name: 'mountain'");
    expect(at, 'the mountain shot has gone').toBeGreaterThan(0);
    return source.slice(at, source.indexOf("name: 'health'", at));
  };

  it('is taken in the country that has mountains in it', () => {
    /*
     * The endless country is where `ranges` comes from, and `ranges.peaks` is the first thing the
     * shot's search asks for. The road tree answers neither question with anything.
     */
    expect(entry()).toContain("world: 'endless'");
  });

  it('still asks for the peaks that world answers with', () => {
    const body = entry();
    expect(body).toContain('ranges.peaks');
    expect(body, 'and gives up rather than photographing nothing').toContain('if (!peak) return null;');
  });
});

/**
 * And that the run can be given more time than the machine it was written on needed.
 *
 * Playwright's thirty seconds and the hard-coded minute for a world to raise itself are properties
 * of a fast desk rather than of the game. On a small ARM box with no GPU the page takes half a
 * minute to load and the world two and a half more, and every one of those numbers is passed before
 * anything has gone wrong — so the run fails with a timeout that reads like a broken game.
 */
describe('how long a shot is allowed to take', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'shots.cjs'), 'utf8');

  it('is one number, and it can be raised', () => {
    expect(source).toContain('const PATIENCE = patienceFrom(process.env.PATIENCE);');
  });

  it('never lowers what was there before', () => {
    // `Math.max(60000, …)` rather than the env outright: an unset or silly PATIENCE cannot make the
    // wait shorter than the minute this always allowed.
    expect(source).toContain("{ timeout: Math.max(60000, PATIENCE) }");
    expect(source, 'and the default leaves playwright its own').toContain('if (PATIENCE) page.setDefaultTimeout(PATIENCE);');
  });
});

/**
 * And that a mistyped budget is refused rather than passed on.
 *
 * `Number()` takes any word at all. `PATIENCE=oops` is `NaN`, and `Math.max(60000, NaN)` is `NaN`
 * rather than 60000 — so the guard written to stop this ever making a wait *shorter* would hand
 * playwright a timeout that is not a number. Negative and infinite values get past a truthy check
 * and reach `setDefaultTimeout` on their own. The way that fails is the worst kind: a mistyped flag
 * comes back as a browser error about timeouts, which reads as the game being broken rather than as
 * the flag being wrong.
 *
 * `shots.cjs` cannot be imported here — it requires playwright at its first line, which this
 * project deliberately does not depend on and which the `check` job does not install. So the
 * function is lifted out of the source and run. It is pure, it takes a string and returns a number,
 * and testing the real one beats asserting that a regex still matches.
 */
describe('the patience a run is given', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'shots.cjs'), 'utf8');
  const patienceFrom: (asked: string | undefined) => number = (() => {
    const at = source.indexOf('function patienceFrom(asked) {');
    expect(at, 'patienceFrom has moved or gone').toBeGreaterThan(0);
    const body = source.slice(at, source.indexOf('\n}', at) + 2);
    return new Function(`${body}; return patienceFrom;`)() as (asked: string | undefined) => number;
  })();

  it('is nought when nobody asked, which means everything waits as it always did', () => {
    expect(patienceFrom(undefined)).toBe(0);
    expect(patienceFrom('')).toBe(0);
  });

  it('is the number when the number is a number', () => {
    expect(patienceFrom('500000')).toBe(500000);
    expect(patienceFrom('0')).toBe(0);
  });

  it('refuses a word, rather than handing playwright a NaN', () => {
    expect(() => patienceFrom('oops')).toThrow(/PATIENCE is milliseconds/);
  });

  it('refuses a wait that runs backwards', () => {
    expect(() => patienceFrom('-5')).toThrow(/PATIENCE is milliseconds/);
  });

  it('refuses for ever, which is not a budget', () => {
    expect(() => patienceFrom('Infinity')).toThrow(/PATIENCE is milliseconds/);
  });

  it('says what it wanted instead, because the flag is the thing that is wrong', () => {
    expect(() => patienceFrom('oops')).toThrow(/try PATIENCE=500000/);
  });
});

/**
 * Which village a shot means by "the village".
 *
 * `village()` has always said *"the nearest village to the middle of the world"* and has always
 * taken `__villages[0]`, which is the order the generator built them in. In the road tree the two
 * agree by luck: the first village built is the hub, on the crossroads the country was grown
 * outward from, which is the middle of the world — measured on seeds 3, 4, 5, 7 and 11, Crossroads
 * Town stands at 0,0 in every one.
 *
 * In the endless country they do not agree at all. There is no hub; the villages are founded from
 * the patch's own list, in the order the places came off it. Measured on the patch a fresh world
 * opens in: seed 5's first village is Blackreach at 37,406 — 408 tiles out — while Hartcross stands
 * at 119,90, and seed 11's is Whitemoor at 109,480 with Kirkstead at 301,198. So the shot walked
 * past the near village to photograph a far one, and the picture moves whenever the list order
 * does, which is not a thing a reference picture can survive.
 *
 * So the helper does what it says. Seed 3 is unmoved by this — Blackby at 32,85 is both the first
 * and the nearest — which is why the pictures on #299 still compare.
 */
describe('the village a shot is taken in', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'shots.cjs'), 'utf8');

  /** The comparator itself, lifted out of the shot spec and run. */
  const byDistanceFromTheMiddle = (() => {
    const at = source.indexOf('const byDistanceFromTheMiddle =');
    expect(at, 'the village helper no longer sorts by distance').toBeGreaterThan(0);
    const line = source.slice(at, source.indexOf('\n', at));
    return new Function(`${line}; return byDistanceFromTheMiddle;`)() as
      (a: { x: number; z: number }, b: { x: number; z: number }) => number;
  })();

  it('is the one nearest the middle, whatever order the country built them in', () => {
    const villages = [
      { name: 'Blackreach', x: 37, z: 406 },
      { name: 'Hartcross', x: 119, z: 90 },
      { name: 'Kirkstead', x: 301, z: 198 },
    ];
    expect([...villages].sort(byDistanceFromTheMiddle).map((v) => v.name))
      .toEqual(['Hartcross', 'Kirkstead', 'Blackreach']);
  });

  it('and the helper sorts with it rather than taking the list as it comes', () => {
    const at = source.indexOf('village: async (n = 0)');
    const helper = source.slice(at, source.indexOf('\n  },', at));
    expect(helper).toContain('.sort(byDistanceFromTheMiddle)[n]');
    expect(helper, 'the generator\'s own order is what this exists to stop using')
      .not.toContain('__villages[n]');
  });
});
