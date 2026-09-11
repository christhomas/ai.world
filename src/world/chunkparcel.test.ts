import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { packChunk, parcelKey, unpackChunk, worldStamp, type Parcel } from './chunkparcel';
import { propsOf } from './propstream';
import { generateWebGraph } from './roadweb';
import { TerrainSampler } from './terrain';

/**
 * The ground, as it travels and as it is kept.
 *
 * A chunk sent wrongly is not a crash, it is a country that differs from the one next door — which
 * is the fault this whole change exists to end, so the packing is held to the letter: what goes in
 * comes out, byte for byte, and anything unrecognisable comes back as nothing rather than as
 * something.
 */

/** A real chunk of a real world, since a made-up one would not have props in it. */
function realChunk(seed: number, cx: number, cz: number): Parcel {
  return new TerrainSampler(generateWebGraph(seed)).generateChunk(cx, cz);
}

describe('a chunk of country, packed', () => {
  it('comes back exactly as it went in, apron and all', () => {
    const parcel = realChunk(3, 8, 4);
    const back = unpackChunk(packChunk(parcel));
    expect(back, 'the parcel would not unpack at all').toBeTruthy();
    expect(back!.cx).toBe(parcel.cx);
    expect(back!.cz).toBe(parcel.cz);
    expect(back!.size, 'the margin a chunk is meshed with').toBe(parcel.size);
    for (const name of ['height', 'water', 'propRot', 'shore', 'corners'] as const) {
      expect([...back![name]], `${name} came back changed`).toEqual([...parcel[name]]);
    }
    for (const name of ['type', 'biome', 'prop', 'sloped'] as const) {
      expect([...back![name]], `${name} came back changed`).toEqual([...parcel[name]]);
    }
    // and what is derived from it derives the same, which is the point of sending the chunk itself
    const mine = [...propsOf(parcel, 3)].map((p) => `${p.kind}:${p.x.toFixed(4)},${p.z.toFixed(4)}`);
    const theirs = [...propsOf(back!, 3)].map((p) => `${p.kind}:${p.x.toFixed(4)},${p.z.toFixed(4)}`);
    expect(theirs).toEqual(mine);
    expect(mine.length, 'a chunk with nothing on it proves little').toBeGreaterThan(0);
  });

  it('weighs what a chunk should weigh', () => {
    const bytes = packChunk(realChunk(3, 8, 4)).byteLength;
    const tiles = (WORLD.CHUNK_SIZE + 2) ** 2;
    // five float arrays, one of them four to a tile, and four arrays of bytes
    expect(bytes).toBe(20 + (tiles * 4 + tiles * 4) * 4 + tiles * 4);
    expect(bytes, 'a chunk has grown into something a phone would notice').toBeLessThan(12_000);
  });

  it('refuses bytes it does not recognise, rather than believing them', () => {
    const good = packChunk(realChunk(3, 0, 0));
    expect(unpackChunk(new ArrayBuffer(8)), 'took a runt for a chunk').toBeNull();
    expect(unpackChunk(good.slice(0, good.byteLength - 8)), 'took a truncated chunk').toBeNull();
    // a version it has never heard of: an older page reading a newer world, or the other way about
    const wrongVersion = good.slice(0);
    new Int32Array(wrongVersion, 0, 1)[0] = 99;
    expect(unpackChunk(wrongVersion), 'read a chunk written by a version it does not know').toBeNull();
  });
});

describe('the stamp that keeps stale ground out', () => {
  it('is the same for the same country and different for a different one', () => {
    const here = realChunk(3, 0, 0), also = realChunk(3, 0, 0), elsewhere = realChunk(4, 0, 0);
    expect(worldStamp(also)).toBe(worldStamp(here));
    expect(worldStamp(elsewhere)).not.toBe(worldStamp(here));
  });

  it('moves when the ground moves, which is what makes kept chunks safe', () => {
    const parcel = realChunk(3, 0, 0);
    const was = worldStamp(parcel);
    // the smallest change generation could make: one tile a hair higher
    const moved = { ...parcel, height: Float32Array.from(parcel.height) };
    moved.height[0] += 0.01;
    expect(worldStamp(moved), 'the ground changed and the stamp did not').not.toBe(was);
  });

  it('moves when what is drawn moves, even where what you stand on has not', () => {
    /*
     * The hole this fell through. A tile says two things about its height — `height` is what you
     * are standing on, `corners` are what is drawn — and only the first was hashed. So every fault
     * of the shape "walkable, but drawn somewhere else" was invisible to the one mechanism meant to
     * keep stale ground out: a jetty could be redrawn and a page would go on showing the old one.
     */
    const parcel = realChunk(3, 0, 0);
    const was = worldStamp(parcel);
    const moved = { ...parcel, corners: Float32Array.from(parcel.corners) };
    moved.corners[0] += 0.01;
    expect(worldStamp(moved), 'the picture changed and the stamp did not').not.toBe(was);
  });

  it('names a kept chunk by the world, what made it, and where it is', () => {
    expect(parcelKey(3, 'mesh', 'abcd1234', 2, -1)).toBe('3:mesh:abcd1234:2,-1');
    // the same chunk of the same seed in the other kind of world is a different chunk
    expect(parcelKey(3, 'road', 'abcd1234', 2, -1)).not.toBe(parcelKey(3, 'mesh', 'abcd1234', 2, -1));
  });
});
