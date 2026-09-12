import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { samplerIn } from './endless';
import { PATCH, Patchwork, Tellings, boundsOf, patchOf, patchOfChunk } from './patchwork';
import { PatchCountry } from './patchcountry';
import { TileType } from './ground';
import type { TerrainSampler } from './terrain';
import type { Within } from './window';

/**
 * The endless country, held one patch at a time.
 *
 * `endless.ts` answers for a patch and the game wants a world, and this is the join. What has to be
 * true of it is short and all of it is here: a question is answered by the patch it falls in, the
 * ground does not change depending on which patch happened to be asked, and the number of patches
 * held at once is bounded however far anybody walks.
 *
 * The last one is the whole reason this exists rather than a `Map` in the game layer. A world with
 * no edge cannot keep what it has grown — a hero walking east for an hour would otherwise hold every
 * square he has crossed, and the machine would go down long before the country ran out.
 */

const SEED = 4242;

/** A stand-in for the real thing, so the bookkeeping can be tested without growing real country. */
function counted() {
  const built: Within[] = [];
  const grow = (_seed: number, within: Within): TerrainSampler => {
    built.push(within);
    return { seed: _seed, within } as unknown as TerrainSampler;
  };
  return { built, grow };
}

describe('which patch a place is in', () => {
  it('cuts the country into squares of a known size', () => {
    expect(patchOf(0, 0)).toBe('0,0');
    expect(patchOf(PATCH - 1, PATCH - 1)).toBe('0,0');
    expect(patchOf(PATCH, 0)).toBe('1,0');
  });

  it('gets the negative country right, which is half the world', () => {
    // `|0` truncates toward zero and would put x = -1 in patch 0 along with x = +1
    expect(patchOf(-1, -1)).toBe('-1,-1');
    expect(patchOf(-PATCH, 0)).toBe('-1,0');
    expect(patchOf(-PATCH - 1, 0)).toBe('-2,0');
  });

  it('never lets a chunk straddle two patches', () => {
    /*
     * The property `PATCH` is chosen for. A chunk painted half by one sampler and half by another
     * is a seam down the middle of a square of ground, and it would be intermittent — most chunks
     * are nowhere near a boundary — which is the worst kind of fault to be handed a report of.
     */
    expect(PATCH % WORLD.CHUNK_SIZE, 'a patch is not a whole number of chunks').toBe(0);
    for (const [cx, cz] of [[0, 0], [15, 15], [16, 0], [-1, -1], [-16, 31]]) {
      const first = patchOf(cx * WORLD.CHUNK_SIZE, cz * WORLD.CHUNK_SIZE);
      const last = patchOf(cx * WORLD.CHUNK_SIZE + WORLD.CHUNK_SIZE - 1, cz * WORLD.CHUNK_SIZE + WORLD.CHUNK_SIZE - 1);
      expect(last, `chunk ${cx},${cz} is painted by two patches`).toBe(first);
      expect(patchOfChunk(cx, cz)).toBe(first);
    }
  });

  it('describes a patch as the square of country it is', () => {
    expect(boundsOf('0,0')).toEqual({ x0: 0, z0: 0, x1: PATCH, z1: PATCH });
    expect(boundsOf('-1,2')).toEqual({ x0: -PATCH, z0: 2 * PATCH, x1: 0, z1: 3 * PATCH });
  });
});

describe('holding the country around somebody', () => {
  it('grows a patch the first time it is asked for and not again', () => {
    const { built, grow } = counted();
    const world = new Patchwork(SEED, grow);
    world.at(10, 10);
    world.at(20, 20);
    world.at(PATCH - 1, 0);
    expect(built.length, 'the same square was grown more than once').toBe(1);
    expect(world.grown).toBe(1);
  });

  it('grows the one you are in and the eight around it, so an edge is never a stall', () => {
    const { grow } = counted();
    const world = new Patchwork(SEED, grow);
    world.around(10, 10);
    expect(world.holding().length).toBe(9);
    expect(world.holding()).toContain('-1,-1');
    expect(world.holding()).toContain('1,1');
  });

  it('holds no more than it is allowed to, however far anybody walks', () => {
    const { grow } = counted();
    const world = new Patchwork(SEED, grow, 4);
    for (let step = 0; step < 40; step++) world.at(step * PATCH, 0);
    expect(world.holding().length).toBe(4);
    expect(world.grown, 'it grew fewer patches than it visited').toBe(40);
  });

  it('drops the one nobody has asked about for longest', () => {
    const { grow } = counted();
    const world = new Patchwork(SEED, grow, 2);
    world.at(0, 0);                              // 0,0
    world.at(PATCH, 0);                          // 1,0
    world.at(0, 0);                              // 0,0 again: now the newer of the two
    world.at(2 * PATCH, 0);                      // 2,0 pushes one out
    expect(world.holding()).toEqual(['0,0', '2,0']);
  });
});

describe('the ground a patchwork paints', () => {
  it('is the ground that patch would paint on its own', () => {
    /*
     * The one that matters, and the reason this is worth a test rather than an assertion. The
     * patchwork is only trustworthy if routing a question through it changes no answer — so a chunk
     * fetched through the patchwork has to be tile-for-tile what the patch's own sampler paints.
     */
    const world = new Patchwork(SEED);
    const cx = 4, cz = 3;
    const through = world.forChunk(cx, cz).generateChunk(cx, cz);
    const straight = samplerIn(SEED, boundsOf(patchOfChunk(cx, cz))).generateChunk(cx, cz);
    expect([...through.type]).toEqual([...straight.type]);
    expect([...through.height]).toEqual([...straight.height]);
  });

  it('paints real country rather than an empty sea', () => {
    // a patchwork that answered every question with sea would pass every test above it
    const world = new Patchwork(SEED);
    const chunk = world.forChunk(4, 3).generateChunk(4, 3);
    const ground = [...chunk.type].filter((t) => t === TileType.Ground || t === TileType.GroundAlt).length;
    expect(ground, 'the patch under the hero is all water').toBeGreaterThan(0);
  });

  it('answers about a place in the next patch along with that patch, not this one', () => {
    const world = new Patchwork(SEED);
    const here = world.at(10, 10);
    const over = world.at(PATCH + 10, 10);
    expect(over, 'one sampler answered for two patches').not.toBe(here);
    expect(world.holding()).toEqual(['0,0', '1,0']);
  });
});

describe('telling a painter about a patch', () => {
  /*
   * The two ends of one rule. A worker keeps a bounded few patches and drops the oldest; this is
   * the main thread's copy of that, and if the two ever disagree the result is a chunk request
   * painted from a patch the worker has quietly dropped — which paints nothing and never answers.
   */
  it('says a patch has to be sent the first time and not the second', () => {
    const told = new Tellings<number>(4);
    expect(told.needs(1, '0,0')).toBe(true);
    expect(told.needs(1, '0,0')).toBe(false);
  });

  it('keeps each painter apart, because a patch is sent to one at a time', () => {
    const told = new Tellings<number>(4);
    told.needs(1, '0,0');
    expect(told.needs(2, '0,0'), 'the second worker was never sent the patch it is painting from').toBe(true);
  });

  it('forgets in the same order the painter does', () => {
    const told = new Tellings<number>(2);
    told.needs(1, 'a');
    told.needs(1, 'b');
    told.needs(1, 'c');                          // pushes 'a' out at both ends
    expect(told.holding(1)).toEqual(['b', 'c']);
    expect(told.needs(1, 'a'), 'it still thinks the painter holds a patch it dropped').toBe(true);
  });

  it('counts using a patch as using it, so the one you are working in is not dropped', () => {
    const told = new Tellings<number>(2);
    told.needs(1, 'a');
    told.needs(1, 'b');
    told.needs(1, 'a');                          // 'a' is the most recent now, so 'b' is the old one
    told.needs(1, 'c');
    expect(told.holding(1)).toEqual(['a', 'c']);
  });
});

describe('the country around whoever is walking', () => {
  /*
   * `PatchCountry` is what the game holds instead of a sampler. It matters that a crossing is
   * *announced*: the mountains in the scene belong to the patch that was left, the eyries were
   * planned from it, and the workers have been told about it. Something has to rebuild those, once,
   * at the moment it happens — rather than every frame, or never.
   */
  it('answers with the patch whoever it is following is standing in', () => {
    const { grow } = counted();
    const country = new PatchCountry(SEED, 10, 10, grow);
    expect(country.patch).toBe('0,0');
    const first = country.sampler;
    expect(country.moveTo(20, 20), 'a step across a field was called a new patch').toBeNull();
    expect(country.sampler).toBe(first);
  });

  it('says so when somebody walks into another one', () => {
    const { grow } = counted();
    const country = new PatchCountry(SEED, 10, 10, grow);
    const before = country.sampler;
    expect(country.moveTo(PATCH + 10, 10)).toBe('1,0');
    expect(country.patch).toBe('1,0');
    expect(country.sampler, 'the same sampler answered for two patches').not.toBe(before);
  });

  it('grows the neighbours on the way past, so an edge is never a stall', () => {
    const { grow } = counted();
    const country = new PatchCountry(SEED, 10, 10, grow);
    country.moveTo(20, 20);
    expect(country.store.holding().length, 'only the square underfoot was grown').toBe(9);
  });

  it('knows how close somebody is to leaving the square they are in', () => {
    expect(PatchCountry.toEdge(0, 250)).toBe(0);
    expect(PatchCountry.toEdge(10, 250)).toBe(10);
    expect(PatchCountry.toEdge(PATCH - 3, 250)).toBe(3);
    // and in the negative country, where a remainder is negative and would otherwise read as huge
    expect(PatchCountry.toEdge(-3, -250)).toBe(3);
  });
});
