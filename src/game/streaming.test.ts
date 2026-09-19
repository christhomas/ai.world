import { describe, expect, it, vi } from 'vitest';
import { streamTheCountry } from './streaming';
import { packChunk, type Parcel } from '../world/chunkparcel';
import type { ChunkManager } from '../world/chunkManager';
import type { TerrainSampler } from '../world/terrain';
import { WORLD } from '../core/config';

/**
 * What a page does with ground the world sends when the world is growing a different country.
 *
 * It took it and drew it, which is how `chore shots -- town` came to photograph bare rock where
 * Crossroads Town stands. A page opened with `?world=road` grows the road tree; the simulation it
 * joins at boot — the one in the worker beside it, which is what playing alone *is* — grows the
 * endless country and nothing else (`server/sim.ts` has one generator in it). Chunks come down the
 * wire and the wire wins, so the ground was the endless country's and the villages, the plaza and
 * the people were the road tree's. Measured in the browser on 0.101.0, seed 3, `?world=road`:
 * `__stream` said `asked 121, arrived 121, grown 0` — every tile of the view came from a country
 * the page was not in — and the game said so itself in the console, *"This world grew differently
 * here (99242a3f) and in the world you joined (7f491107)"*, and went on drawing it anyway.
 *
 * Saying it is not enough. A page that knows the ground is from somewhere else has its own
 * generator, which is right for the world the player chose, and the sentence is the moment to use
 * it. Nothing changes for a page whose world agrees with it, which is every endless world and every
 * shared one — `boot.ts` makes a named world endless on purpose.
 */

/** A chunk with something recognisable in it, apron and all. Borrowed from `chunkstore.test.ts`. */
function parcel(cx: number, cz: number): Parcel {
  const size = WORLD.CHUNK_SIZE + 2;
  const n = size * size;
  return {
    cx, cz, size, empty: false,
    height: new Float32Array(n).fill(7),
    water: new Float32Array(n),
    propRot: new Float32Array(n).fill(Number.NaN),
    shore: new Float32Array(n),
    corners: new Float32Array(n * 4).fill(7),
    type: new Uint8Array(n).fill(2),
    biome: new Uint8Array(n).fill(1),
    prop: new Uint8Array(n),
    sloped: new Uint8Array(n),
  };
}

/** A page waiting on one chunk, and a note of what it was handed. */
function page() {
  const drawn: string[] = [];
  const asked: string[] = [];
  const chunks = {
    wanted: () => [[0, 0] as [number, number]],
    deliver: (cx: number, cz: number) => { drawn.push(`${cx},${cz}`); },
  } as unknown as ChunkManager;
  // the stamp of what this page kept is hashed off one chunk; nothing here reads the ground itself
  const sampler = { generateChunk: () => parcel(0, 0) } as unknown as TerrainSampler;
  const streaming = streamTheCountry({
    chunks, sampler, seed: 3, want: (want) => { for (const [cx, cz] of want) asked.push(`${cx},${cz}`); return true; },
  });
  return { streaming, drawn, asked };
}

describe('a world growing a different country from the page', () => {
  it('has its ground drawn while the two are in one country', async () => {
    const { streaming, drawn, asked } = page();
    streaming.streamCountry();
    // the store is asked first and answers on a promise; the ask for the world follows it
    await vi.waitFor(() => expect(asked).toEqual(['0,0']));
    streaming.onParcel(packChunk(parcel(0, 0)));
    expect(drawn, 'the world sent a chunk and the page did not draw it').toEqual(['0,0']);
  });

  it('is told, and the page grows the ground itself instead', async () => {
    const { streaming, drawn, asked } = page();
    streaming.growItHere();
    streaming.streamCountry();
    streaming.onParcel(packChunk(parcel(0, 0)));
    await vi.waitFor(() => expect(streaming.tally.wanted).toBe(0));
    expect(asked, 'a page that will not use the answer should not ask the question').toEqual([]);
    expect(drawn, 'ground from another country was drawn over the page\'s own').toEqual([]);
  });
});
