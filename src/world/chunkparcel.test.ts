import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { packChunk, parcelKey, unpackChunk, worldStamp, type Parcel } from './chunkparcel';
import { propsOf } from './propstream';
import { generateWebGraph } from './roadweb';
import { TerrainSampler } from './terrain';
import { tilesOf } from './tiles';

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
  const sampler = new TerrainSampler(generateWebGraph(seed));
  const chunk = sampler.generateChunk(cx, cz);
  const props: number[] = [];
  for (const p of propsOf(chunk, sampler.seed)) {
    props.push(p.kind, p.x, p.y, p.z, p.rot, p.scale, p.stretch, p.lean, p.tint);
  }
  return { cx, cz, props: Float32Array.from(props), tiles: tilesOf(chunk) };
}

describe('a chunk of country, packed', () => {
  it('comes back exactly as it went in', () => {
    const parcel = realChunk(3, 8, 4);
    expect(parcel.props.length, 'a chunk with nothing on it proves little').toBeGreaterThan(0);
    const back = unpackChunk(packChunk(parcel));
    expect(back, 'the parcel would not unpack at all').toBeTruthy();
    expect(back!.cx).toBe(parcel.cx);
    expect(back!.cz).toBe(parcel.cz);
    expect([...back!.props]).toEqual([...parcel.props]);
    expect([...back!.tiles.heights]).toEqual([...parcel.tiles.heights]);
    expect([...back!.tiles.waters]).toEqual([...parcel.tiles.waters]);
    expect([...back!.tiles.types]).toEqual([...parcel.tiles.types]);
    expect([...back!.tiles.biomes]).toEqual([...parcel.tiles.biomes]);
  });

  it('weighs what a chunk should weigh', () => {
    const parcel = realChunk(3, 8, 4);
    const bytes = packChunk(parcel).byteLength;
    const tiles = WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE;
    // the tiles are fixed, the props are what vary
    expect(bytes).toBe(16 + tiles * 10 + parcel.props.length * 4);
    expect(bytes, 'a chunk has grown into something a phone would notice').toBeLessThan(8_000);
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
    expect(worldStamp(also.tiles, also.props)).toBe(worldStamp(here.tiles, here.props));
    expect(worldStamp(elsewhere.tiles, elsewhere.props)).not.toBe(worldStamp(here.tiles, here.props));
  });

  it('moves when the ground moves, which is what makes kept chunks safe', () => {
    const parcel = realChunk(3, 0, 0);
    const was = worldStamp(parcel.tiles, parcel.props);
    // the smallest change generation could make: one tile a hair higher
    const moved = { ...parcel.tiles, heights: Float32Array.from(parcel.tiles.heights) };
    moved.heights[0] += 0.01;
    expect(worldStamp(moved, parcel.props), 'the ground changed and the stamp did not').not.toBe(was);
  });

  it('names a kept chunk by the world, what made it, and where it is', () => {
    expect(parcelKey(3, 'mesh', 'abcd1234', 2, -1)).toBe('3:mesh:abcd1234:2,-1');
    // the same chunk of the same seed in the other kind of world is a different chunk
    expect(parcelKey(3, 'road', 'abcd1234', 2, -1)).not.toBe(parcelKey(3, 'mesh', 'abcd1234', 2, -1));
  });
});
