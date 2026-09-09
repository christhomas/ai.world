import { describe, expect, it } from 'vitest';
import { ChunkStore, type Keep } from './chunkstore';
import { packChunk, type Parcel } from '../world/chunkparcel';
import { WORLD } from '../core/config';

/**
 * Keeping country is what makes streaming it affordable, and keeping it wrongly is worse than not
 * keeping it at all: ground saved by an older generator, drawn beside ground the world grew today,
 * is the two halves in different countries again. So the tests are as much about what the store
 * refuses to hand back as about what it keeps.
 */

/** A store in memory, which is all the real one is from here. */
function keep(): Keep & { held: Map<string, ArrayBuffer> } {
  const held = new Map<string, ArrayBuffer>();
  return {
    held,
    async get(key) { return held.get(key); },
    async set(key, value) { held.set(key, value); },
    async delete(key) { held.delete(key); },
    async keys() { return [...held.keys()]; },
  };
}

/** A chunk with something recognisable in it. */
function parcel(cx: number, cz: number, mark = 7): Parcel {
  const n = WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE;
  const heights = new Float32Array(n).fill(mark);
  const waters = new Float32Array(n);
  const types = new Uint8Array(n).fill(2);
  const biomes = new Uint8Array(n).fill(1);
  return { cx, cz, props: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), tiles: { cx, cz, heights, waters, types, biomes } };
}

describe('country a page has already been sent', () => {
  it('comes back exactly, and only for the chunk that was asked for', () => {
    const store = new ChunkStore(keep(), 3, 'mesh', 'aaaa1111');
    return (async () => {
      await store.put(parcel(2, -1));
      const back = await store.get(2, -1);
      expect(back, 'the chunk was not kept at all').toBeTruthy();
      expect(back!.cx).toBe(2);
      expect(back!.tiles.heights[0]).toBe(7);
      expect(await store.get(2, 0), 'a chunk nobody kept came back anyway').toBeNull();
    })();
  });

  it('is not handed back when the country it came from has changed', async () => {
    const shared = keep();
    const before = new ChunkStore(shared, 3, 'mesh', 'aaaa1111');
    await before.put(parcel(0, 0));
    // generation moves; the stamp moves with it
    const after = new ChunkStore(shared, 3, 'mesh', 'bbbb2222');
    expect(await after.get(0, 0), 'ground from an older country was handed back as new').toBeNull();
  });

  it('is kept apart from the same chunk of another world', async () => {
    const shared = keep();
    await new ChunkStore(shared, 3, 'mesh', 'aaaa1111').put(parcel(0, 0, 7));
    await new ChunkStore(shared, 3, 'road', 'aaaa1111').put(parcel(0, 0, 9));
    await new ChunkStore(shared, 4, 'mesh', 'aaaa1111').put(parcel(0, 0, 11));
    expect((await new ChunkStore(shared, 3, 'mesh', 'aaaa1111').get(0, 0))!.tiles.heights[0]).toBe(7);
    expect((await new ChunkStore(shared, 3, 'road', 'aaaa1111').get(0, 0))!.tiles.heights[0]).toBe(9);
    expect((await new ChunkStore(shared, 4, 'mesh', 'aaaa1111').get(0, 0))!.tiles.heights[0]).toBe(11);
  });
});

describe('sweeping up', () => {
  it('throws out ground from a country that no longer exists', async () => {
    const shared = keep();
    await new ChunkStore(shared, 3, 'mesh', 'old00000').put(parcel(0, 0));
    await new ChunkStore(shared, 3, 'mesh', 'old00000').put(parcel(1, 0));
    const now = new ChunkStore(shared, 3, 'mesh', 'new11111');
    await now.put(parcel(0, 0));
    expect(await now.sweep()).toBe(2);
    expect([...shared.held.keys()].every((key) => key.includes('new11111'))).toBe(true);
  });

  it('leaves other worlds alone, because somebody with three saves wanted three countries', async () => {
    const shared = keep();
    await new ChunkStore(shared, 7, 'mesh', 'seven000').put(parcel(0, 0));
    const other = new ChunkStore(shared, 3, 'mesh', 'three000');
    await other.put(parcel(0, 0));
    expect(await other.sweep()).toBe(0);
    expect(shared.held.size).toBe(2);
  });

  it('says nothing and breaks nothing when there is nowhere to keep anything', async () => {
    // a private window, a full disk, a browser with storage turned off
    const refuses: Keep = {
      async get() { throw new Error('no'); },
      async set() { throw new Error('no'); },
      async delete() { throw new Error('no'); },
      async keys() { throw new Error('no'); },
    };
    const store = new ChunkStore(refuses, 3, 'mesh', 'aaaa1111');
    await expect(store.put(parcel(0, 0))).resolves.toBeUndefined();
    expect(await store.get(0, 0), 'a store that throws handed something back').toBeNull();
    expect(await store.sweep()).toBe(0);
  });

  it('keeps a chunk small enough to be worth keeping thousands of', () => {
    // the whole scheme rests on a country costing tens of megabytes rather than hundreds
    expect(packChunk(parcel(0, 0)).byteLength).toBeLessThan(4_000);
  });
});
