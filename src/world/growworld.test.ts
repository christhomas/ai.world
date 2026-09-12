import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateRoadGraph, islandAnchors } from './graph';
import { countryStamp, growPatch, growWorld, patchStamp, whyCountriesDiffer } from './growworld';
import { PATCH, boundsOf } from './patchwork';
import { partsOf, rebuildPatch } from './endless';
import { TerrainSampler } from './terrain';

/**
 * The generator has one caller, and this is what says so.
 *
 * Everything else in this repository about the two halves of the game agreeing is a test of an
 * *outcome*: ask both sides the same four thousand questions and see whether the answers match.
 * That is a fine thing to have and it is the wrong shape for this particular fault, because the
 * fault was never in the answers. Twice now a player has been walked about a country he could not
 * see, and both times the generator was perfectly correct and the *calling* of it was not — once by
 * choosing the wrong kind of world, once by growing the right kind without its islands. An outcome
 * test can only find that after somebody has written the second way of calling it.
 *
 * So this is a test of the shape instead. There is one expression in the game that grows a country,
 * everything it is a function of is an argument to it, and every one of those arguments travels
 * with the join. A world grown in one place then cannot be grown differently in another — not
 * because the two callers were careful, but because there are not two callers.
 */

/** Every source file of the game and the server, tests aside: they are allowed to grow anything. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') && !path.includes('.test.') ? [path] : [];
  });
}

describe('the one place a world is grown', () => {
  it('is the only place that calls a generator', () => {
    /*
     * Calls rather than mentions. `graph.ts` and `roadweb.ts` each define one of these and would
     * otherwise report themselves, and half a dozen comments name them in prose — which is a good
     * thing that should not fail a build. So: the name, an open bracket, and not the word `function`
     * in front of it.
     */
    const calling = /(?<!function\s)\b(generateWebGraph|roadTreeWorld|samplerIn)\s*\(/;
    const callers = ['src', 'server', 'tools']
      .flatMap((dir) => sources(dir))
      .filter((path) => calling.test(readFileSync(path, 'utf8')));
    expect(callers, 'a second way of growing a world has appeared').toEqual(['src/world/growworld.ts']);
    /*
     * `samplerIn` is in that list as of the 12th, and it is the endless country's version of the
     * same fault. A bounded world is grown once, whole; an endless one is grown a patch at a time by
     * whoever walks into it — the page to draw it, the worker to have it ready before the page needs
     * it, and eventually the server to walk heroes across it. Three callers of one generator is
     * precisely the shape that has twice put somebody in a country nobody else could see, so the
     * patch goes through `growPatch` and this is what says it always will.
     */
  });

  it('grows the same patch of endless country however it is asked for', () => {
    const within = { x0: 0, z0: 0, x1: PATCH, z1: PATCH };
    const once = growPatch(5, within);
    const again = growPatch(5, within);
    expect(countryStamp(again.graph)).toBe(countryStamp(once.graph));
    // and somewhere else is somewhere else, which is the whole of what makes a country endless
    const next = growPatch(5, { x0: PATCH, z0: 0, x1: PATCH * 2, z1: PATCH });
    expect(countryStamp(next.graph)).not.toBe(countryStamp(once.graph));
  });

  it('grows one country per seed, and a different one for the next seed', () => {
    // there is one kind of world now — see `WorldKind` — so what is left to check is that the seed
    // is what decides a country, which is the promise everything else in this file rests on
    expect(countryStamp(growWorld(1, 'road'))).not.toBe(countryStamp(growWorld(2, 'road')));
    expect('mesh' in growWorld(1, 'road'), 'the road world came back with a mesh it cannot have').toBe(false);
  });

  it('grows the same country twice, which is the whole of what a stamp is worth', () => {
    expect(countryStamp(growWorld(7, 'road'))).toBe(countryStamp(growWorld(7, 'road')));
  });

  it('grows a different country when the islands are somewhere else', () => {
    /*
     * The reason the islands travel with the join.
     *
     * Where they hang is planned from the seed for any world made by this code, so leaving them out
     * gives the right answer today — but a world saved before that code existed has them written
     * into its own manifest, and the seed cannot tell you where they went. A page playing such a
     * save and a world grown from the seed alone are two different countries, and this is what that
     * looks like: the same seed, the same kind, different villages.
     */
    const seed = 3;
    const own = islandAnchors(generateRoadGraph(seed), seed);
    expect(own.length, 'this seed has no islands, so it cannot show what moving one does').toBeGreaterThan(0);
    const moved = own.map((a, i) => (i === 0 ? { ...a, x: a.x + 40, z: a.z - 40 } : a));

    expect(countryStamp(growWorld(seed, 'road', own)), 'the seed\'s own islands are not what the seed grows')
      .toBe(countryStamp(growWorld(seed, 'road')));
    expect(countryStamp(growWorld(seed, 'road', moved)), 'moving an island did not move the country')
      .not.toBe(countryStamp(growWorld(seed, 'road')));

    // and the same thing said in villages, which is how a player would have found it out: standing
    // in a named square with somebody else's field under his feet
    const names = (islands: typeof own): string =>
      new TerrainSampler(growWorld(seed, 'road', islands)).structures.villages
        .map((v) => `${v.name}@${v.x.toFixed(0)},${v.z.toFixed(0)}`).join(' ');
    expect(names(moved)).not.toBe(names(own));
  });
});

/**
 * The fingerprint of a square, for a country that has no whole to fingerprint.
 *
 * The whole-country stamp is asked once, at the handshake, because a bounded country exists all at
 * once and joining is the moment there is something to compare. An endless one has no such moment —
 * at the handshake each half has grown the square it is standing in and nothing else, and those
 * need not even be the same square. So the unit of agreement becomes the unit of growth, and what
 * is checked is "are we on the same ground" each time somebody walks into new country rather than
 * "are we in the same world" once and never again.
 *
 * The last of these is the one that earns the rest. A patch grown by the worker and rebuilt by the
 * page out of its parts has to be the same country or the whole arrangement in `world/grower.ts` is
 * a hole in the ground nobody can see into; the stamp is what would say so in one number.
 */
describe('the fingerprint of one square of endless country', () => {
  const square = '0,0';
  const within = boundsOf(square);

  it('is the same square however many times it is grown', () => {
    expect(patchStamp(square, growPatch(11, within).graph))
      .toBe(patchStamp(square, growPatch(11, within).graph));
  });

  it('is a different square of the same country, and the same square of another', () => {
    const next = '1,0';
    expect(patchStamp(next, growPatch(11, boundsOf(next)).graph))
      .not.toBe(patchStamp(square, growPatch(11, within).graph));
    expect(patchStamp(square, growPatch(12, within).graph))
      .not.toBe(patchStamp(square, growPatch(11, within).graph));
  });

  it('does not read as agreement when the two halves are talking about different squares', () => {
    // the name is folded in for exactly this: two stamps that match are two halves standing on one
    // piece of ground, and never two halves that happened to hash alike about different ones
    const graph = growPatch(11, within).graph;
    expect(patchStamp('0,0', graph)).not.toBe(patchStamp('7,-3', graph));
  });

  it('says a patch rebuilt from its parts is the same country it was grown as', () => {
    /*
     * What the country worker's whole arrangement rests on. A square is grown off the main thread
     * and put back together here out of what came over — five seconds there against a tenth of a
     * second here — and if the rebuild were a different country it would be a hole in the world that
     * nothing would report. `patchwork.test.ts` proves it tile by tile; this proves it in the one
     * number the two halves would actually exchange.
     */
    const grown = growPatch(4242, within);
    const rebuilt = rebuildPatch(4242, within, partsOf(grown));
    expect(patchStamp(square, rebuilt.graph)).toBe(patchStamp(square, grown.graph));
  });
});

/**
 * And what a page is told when the two halves are not in the same country.
 *
 * The version this replaced said the only thing it could: two hex numbers and the news that they
 * differ. That is true and nearly useless — it reports the symptom of every possible cause. The
 * commonest cause by a long way is not a generator that drifted but two halves that grew different
 * *kinds* of country from the same seed, which the hashes cannot say and the kinds say outright.
 */
describe('why two halves are not in the same country', () => {
  it('says nothing at all when they agree', () => {
    expect(whyCountriesDiffer('abcd1234', 'abcd1234', 'road', 'road')).toBeNull();
  });

  it('says nothing when the world said nothing, rather than guessing at a quarrel', () => {
    // a world that grows no ground sends an empty stamp, and one older than the kind field sends no
    // kind. Silence is not disagreement
    expect(whyCountriesDiffer('abcd1234', '', 'road')).toBeNull();
    expect(whyCountriesDiffer('abcd1234', 'abcd1234', 'endless')).toBeNull();
  });

  it('names the two kinds when they differ, and does not mention the hashes at all', () => {
    const said = whyCountriesDiffer('3b564cc4', '1d825025', 'endless', 'road');
    expect(said).toContain('endless');
    expect(said).toContain('road');
    expect(said, 'a player was shown two hex numbers again').not.toContain('3b564cc4');
  });

  it('and falls back to the hashes when the kinds match and the countries do not', () => {
    const said = whyCountriesDiffer('3b564cc4', '1d825025', 'road', 'road');
    expect(said).toContain('3b564cc4');
    expect(said).toContain('1d825025');
  });

  it('still catches a drift when the world is too old to say what kind it grew', () => {
    // the case the field being optional has to keep working: no kind, two stamps, a real difference
    expect(whyCountriesDiffer('aaaa', 'bbbb', 'road')).toContain('bbbb');
  });
});
