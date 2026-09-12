import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { samplerIn } from './endless';
import { PATCH, Patchwork, boundsOf, patchOf, patchOfChunk } from './patchwork';
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
