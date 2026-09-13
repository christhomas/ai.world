import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { generateWebGraph } from './roadweb';
import { TerrainSampler, type ChunkData } from './terrain';
import type { Within } from './window';

/**
 * A sampler asked about one patch of country paints that patch as the whole world does.
 *
 * This is the contract an endless world stands on. The ground is grown today by one sampler
 * holding every road, every river and every village there is, which is affordable exactly once —
 * in a world with an edge. Take the edge off and the only thing that can be built is a sampler for
 * the patch somebody is standing in, and then there are many of them, side by side, each ignorant
 * of most of the world.
 *
 * Two windows that overlap must agree about the overlap, or the seam between them is a seam in the
 * ground: a road that stops at a line, a river that changes width across it, a village with half
 * its houses. The strongest way to say that is against the whole world, since the whole world is
 * what every window is a piece of — so what is checked here is that windowing changes nothing
 * inside the window at all.
 *
 * It does not yet check that a window is *cheap*. The rivers are still routed and the villages
 * still founded across the whole map before the window throws most of them away, which is why the
 * last test below is the one that would notice: if a window ever stopped pruning, the two samplers
 * would agree everywhere and this file would be testing nothing.
 */

const SEED = 7;
const TILES = WORLD.CHUNK_SIZE;

/** A patch a few chunks across, near the middle, where there is country worth comparing. */
const WINDOW: Within = { x0: -64, z0: -64, x1: 192, z1: 192 };

const whole = new TerrainSampler(generateWebGraph(SEED));
const windowed = new TerrainSampler(generateWebGraph(SEED), { within: WINDOW });

/** Every array a chunk is painted into, named, so a mismatch says which one moved. */
function differences(a: ChunkData, b: ChunkData): string[] {
  const out: string[] = [];
  const fields = ['type', 'biome', 'prop', 'sloped', 'height', 'propRot', 'shore', 'water', 'corners'] as const;
  for (const field of fields) {
    const one = a[field] as ArrayLike<number>, two = b[field] as ArrayLike<number>;
    for (let i = 0; i < one.length; i++) {
      // `Object.is`, because an unset rotation is NaN and NaN is not equal to itself
      if (!Object.is(one[i], two[i])) { out.push(`${field}[${i}] ${one[i]} vs ${two[i]}`); break; }
    }
  }
  return out;
}

/**
 * The chunks whose tiles all lie inside the window, which are the ones it promises anything about.
 *
 * The apron counts. A chunk carries a one-tile ring outside itself so the mesher can look at its
 * neighbours, `differences` below compares whole arrays, and a chunk sitting hard against the edge
 * of the window has that ring *outside* it — which is ground the window promised nothing about and
 * where the two samplers may legitimately disagree, because the windowed one has thrown away the
 * roads out there. It was found when the country stopped being flat: the two agreed to the tile
 * everywhere inside and differed by eleven terraces at one apron tile a tile past the boundary,
 * where the nearer road had been pruned and the further one stood in different country.
 */
function chunksInside(within: Within): [number, number][] {
  const out: [number, number][] = [];
  const first = (edge: number) => Math.ceil((edge + 1) / TILES);
  const last = (edge: number) => Math.floor((edge - TILES) / TILES);
  for (let cz = first(within.z0); cz <= last(within.z1); cz++) {
    for (let cx = first(within.x0); cx <= last(within.x1); cx++) out.push([cx, cz]);
  }
  return out;
}

describe('a sampler built for a window', () => {
  it('paints every chunk inside it exactly as a sampler of the whole world does', () => {
    const inside = chunksInside(WINDOW);
    expect(inside.length, 'the window holds no whole chunks').toBeGreaterThan(4);
    for (const [cx, cz] of inside) {
      const found = differences(whole.generateChunk(cx, cz), windowed.generateChunk(cx, cz));
      expect(found, `chunk ${cx},${cz} is painted differently inside the window: ${found.join(', ')}`).toEqual([]);
    }
  });

  it('answers about the ground inside it as the whole world does', () => {
    let compared = 0;
    for (let z = WINDOW.z0 + 8; z < WINDOW.z1 - 8; z += 7) {
      for (let x = WINDOW.x0 + 8; x < WINDOW.x1 - 8; x += 7) {
        const one = whole.probe(x, z), two = windowed.probe(x, z);
        expect(`${two.land} ${two.biome} ${two.roadDist.toFixed(4)}`,
          `the ground at ${x},${z} is not what the whole world says it is`)
          .toBe(`${one.land} ${one.biome} ${one.roadDist.toFixed(4)}`);
        compared++;
      }
    }
    expect(compared, 'nothing was compared').toBeGreaterThan(500);
  });

  it('has genuinely let go of the country outside it', () => {
    // if it had not, everything above would pass against a sampler that had pruned nothing
    let differing = 0;
    for (let cz = -12; cz <= 12; cz += 3) {
      for (let cx = -12; cx <= 12; cx += 3) {
        const tileX = cx * TILES, tileZ = cz * TILES;
        if (tileX >= WINDOW.x0 - TILES && tileX <= WINDOW.x1 && tileZ >= WINDOW.z0 - TILES && tileZ <= WINDOW.z1) continue;
        if (differences(whole.generateChunk(cx, cz), windowed.generateChunk(cx, cz)).length > 0) differing++;
      }
    }
    expect(differing, 'a windowed sampler still paints the whole world').toBeGreaterThan(0);
  });
});
