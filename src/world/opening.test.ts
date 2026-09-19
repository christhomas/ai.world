import { describe, expect, it } from 'vitest';
import { Biome } from './biomes';
import { growPatch, growWorld } from './growworld';
import { whereAWorldOpens } from './opening';
import { boundsOf } from './patchwork';
import { HOME_PATCH } from './seedscore';
import type { Village } from './structures';
import { TerrainSampler } from './terrain';

/**
 * Where a fresh world puts the hero on its first frame. See `opening.ts` for the argument and
 * #394 for the measurements behind it.
 *
 * One endless patch is grown here and no more. A patch is about six hundred milliseconds on a desk
 * and eleven to fifteen seconds on the four-core ARM box this was written on — `tools/clock.ts`
 * says so at length — and a guard that costs half a minute is a guard somebody turns off. Seed 3
 * because every picture on #299 is taken on it.
 */

/** A village as this file needs one: a name and a place. Everything else is the generator's. */
const town = (name: string, x: number, z: number): Village =>
  ({ name, x, z, radius: 20, level: 2, biome: Biome.Plains, houses: [], spare: [], shops: [],
    board: null, pub: null, station: null, stable: null, church: null, churchDoor: null,
    hall: null, watchHouse: null, stalls: [] });

describe('where a world opens', () => {
  it('opens an endless world in a village, where it used to open in an empty field', () => {
    const villages = growPatch(3, boundsOf(HOME_PATCH)).structures.villages;
    // The precondition, and the whole of what was wrong: nothing stands at the origin, which is
    // where `main.ts` has put a fresh hero since the first commit. Measured by scanning seeds 3,
    // 4, 5, 7, 11, 13, 17, 19, 23 and 29 — the nearest village to the origin runs 36 to 514 tiles
    // out and on seed 3 it is Blackby, at 32.45,85.05, ninety-one tiles away.
    expect(villages.length, 'seed 3 plants villages in its home patch').toBeGreaterThan(0);
    for (const v of villages) {
      expect(Math.hypot(v.x, v.z), `${v.name} already stands on the origin`).toBeGreaterThan(v.radius);
    }

    const opening = whereAWorldOpens(villages);
    expect(opening, 'a patch with villages in it has somewhere to open').not.toBeNull();
    // in it rather than near it: the hero stands where the village stands, the way a road world's
    // hero stands in Crossroads Town
    expect(opening!.houses.length, `${opening!.name} has nobody in it`).toBeGreaterThan(0);
    for (const v of villages) {
      expect(Math.hypot(v.x, v.z), `${v.name} is nearer than ${opening!.name}`)
        .toBeGreaterThanOrEqual(Math.hypot(opening!.x, opening!.z));
    }
  });

  it('leaves a road world exactly where it opened, because the hub already wins this', () => {
    const villages = new TerrainSampler(growWorld(3)).structures.villages;
    // The precondition. One rule is run for both countries rather than a branch on the kind, and
    // it is only safe because the road tree already does by construction what this asks for:
    // `seedHub` plants node nought at 0,0, `structures.ts` builds Crossroads Town on it, and
    // `sectorMix` holds plains for 39 tiles around it. Checked on seeds 3, 4, 5, 7, 11, 13, 17,
    // 19, 23 and 29 by scanning — the hub is at 0,0 in Plains on every one of them.
    const hub = villages.find((v) => v.name === 'Crossroads Town');
    expect(hub, 'the road tree still plants its hub').toBeDefined();
    expect([hub!.x, hub!.z], 'the hub still stands on the origin').toEqual([0, 0]);
    expect(hub!.biome, 'and still in the clearing').toBe(Biome.Plains);

    expect(whereAWorldOpens(villages), 'a road world opens where it always opened').toBe(hub);
  });

  it('takes the nearest village and not the first one the patch listed', () => {
    // An endless patch lists its towns in junction-id order — `junctionsIn` sorts by `id` — so the
    // first is not the nearest. These two are seed 5's, found by scanning: Blackreach is the
    // patch's first town and Hartcross is 259 tiles closer to the origin.
    const listed = [town('Blackreach', 37.49, 405.88), town('Hartcross', 118.82, 90)];
    expect(listed[0].name, 'the far one is the one the patch lists first').toBe('Blackreach');
    expect(Math.hypot(listed[0].x, listed[0].z)).toBeGreaterThan(Math.hypot(listed[1].x, listed[1].z));

    expect(whereAWorldOpens(listed)?.name).toBe('Hartcross');
  });

  it('answers the same on every machine and whatever order the list arrives in', () => {
    // 30,40 and 40,30 are both exactly fifty tiles out, and a tie is the only place the rest of
    // the ordering is ever consulted. A world that opened in a different village on a different
    // browser is the one thing #394 asks this never to be.
    const [ashgate, windcross] = [town('Ashgate', 30, 40), town('Windcross', 40, 30)];
    expect(Math.hypot(ashgate.x, ashgate.z), 'a real tie').toBe(Math.hypot(windcross.x, windcross.z));

    expect(whereAWorldOpens([ashgate, windcross])?.name).toBe('Ashgate');
    expect(whereAWorldOpens([windcross, ashgate])?.name).toBe('Ashgate');
  });

  it('and opens at the origin when the patch planted nobody, which is where it always opened', () => {
    // `goodseed.ts` refuses to hand out a drawn seed whose home patch has fewer than two villages,
    // but a seed typed into the address bar goes past it. Nothing to open in is not a failure, it
    // is the world this game has always grown, so it answers nothing and `main.ts` uses 0,0.
    expect(whereAWorldOpens([])).toBeNull();
  });
});
