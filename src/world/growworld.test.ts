import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateRoadGraph, islandAnchors } from './graph';
import { countryStamp, growWorld } from './growworld';
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
    const calling = /(?<!function\s)\b(generateWebGraph|roadTreeWorld)\s*\(/;
    const callers = ['src', 'server', 'tools']
      .flatMap((dir) => sources(dir))
      .filter((path) => calling.test(readFileSync(path, 'utf8')));
    expect(callers, 'a second way of growing a world has appeared').toEqual(['src/world/growworld.ts']);
  });

  it('grows the kind of country it is asked for', () => {
    // the polygon world carries the mesh its ground is cut out of; the road tree has no such thing,
    // and that difference is the cheapest way to tell which country came back
    expect('mesh' in growWorld(1, 'mesh'), 'the mountains world came back without its mesh').toBe(true);
    expect('mesh' in growWorld(1, 'road'), 'the road world came back with a mesh it cannot have').toBe(false);
    expect(countryStamp(growWorld(1, 'mesh'))).not.toBe(countryStamp(growWorld(1, 'road')));
    expect(countryStamp(growWorld(1, 'road'))).not.toBe(countryStamp(growWorld(2, 'road')));
  });

  it('grows the same country twice, which is the whole of what a stamp is worth', () => {
    expect(countryStamp(growWorld(7, 'road'))).toBe(countryStamp(growWorld(7, 'road')));
    expect(countryStamp(growWorld(7, 'mesh'))).toBe(countryStamp(growWorld(7, 'mesh')));
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
