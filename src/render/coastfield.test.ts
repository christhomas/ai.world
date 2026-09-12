import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { TileType } from '../world/terrain';
import type { ChunkSource, ChunkTiles } from '../world/tiles';
import { COAST, CoastField, spreadFromLand } from './coastfield';

/**
 * The waves are contour lines of this field, so anything wrong in it is wrong in the water in a way
 * that is very hard to see and impossible to debug by looking: a shore measured half a chunk off
 * puts the line of surf out at sea, and a field that shifts as the camera moves makes the whole sea
 * crawl. Both are cheap to pin here and expensive to find in a screenshot.
 */

/** A world that is dry east of a line and wet west of it. */
function coastAt(east: number): ChunkSource {
  const CS = WORLD.CHUNK_SIZE;
  return {
    getTiles(cx: number, cz: number): ChunkTiles | null {
      const types = new Uint8Array(CS * CS);
      for (let lz = 0; lz < CS; lz++) {
        for (let lx = 0; lx < CS; lx++) {
          const wx = cx * CS + lx;
          types[lz * CS + lx] = wx >= east ? TileType.Ground : TileType.Seabed;
        }
      }
      return {
        cx, cz, types,
        heights: new Float32Array(CS * CS),
        waters: new Float32Array(CS * CS),
        biomes: new Uint8Array(CS * CS),
      };
    },
  };
}

/** The same world, but streamed: nothing has been generated until somebody says it has. */
function arrivingCoastAt(east: number): ChunkSource & { arrive(): void } {
  const made = coastAt(east);
  let here = false;
  return {
    arrive: () => { here = true; },
    getTiles: (cx: number, cz: number) => (here ? made.getTiles(cx, cz) : null),
  };
}

describe('how far the water is from land', () => {
  it('measures nought on the land and one cell off it', () => {
    const size = 5;
    const land = new Uint8Array(size * size);
    land[2 * size + 2] = 1;
    const out = spreadFromLand(land, size, new Float32Array(size * size));
    expect(out[2 * size + 2]).toBe(0);
    expect(out[2 * size + 3]).toBe(1);
    expect(out[1 * size + 2]).toBe(1);
    expect(out[1 * size + 1]).toBeCloseTo(Math.SQRT2, 5);
  });

  it('reaches the far corner of the grid, forwards and backwards', () => {
    const size = 9;
    const land = new Uint8Array(size * size);
    land[0] = 1;
    const out = spreadFromLand(land, size, new Float32Array(size * size));
    // a chamfer sweep runs a diagonal about two per cent long, and no further
    const corner = out[size * size - 1];
    expect(corner).toBeGreaterThan((size - 1) * Math.SQRT2 - 0.01);
    expect(corner).toBeLessThan((size - 1) * Math.SQRT2 * 1.03);
    // and the sweep that goes the other way is just as good
    expect(out[size - 1]).toBeCloseTo(size - 1, 5);
  });

  it('says open sea where there is no land at all', () => {
    const size = 6;
    const out = spreadFromLand(new Uint8Array(size * size), size, new Float32Array(size * size));
    expect(Math.min(...out)).toBeGreaterThanOrEqual(size * 2);
  });
});

describe('the coast around the camera', () => {
  const read = (field: CoastField, x: number, z: number): number => {
    const gx = Math.floor((x - field.x0) / COAST.CELL);
    const gz = Math.floor((z - field.z0) / COAST.CELL);
    const byte = (field.texture.image.data as Uint8Array)[gz * COAST.SIZE + gx];
    return (byte / 255) * COAST.RANGE;
  };

  it('reads the distance to a straight coastline off the ground', () => {
    const field = new CoastField();
    field.update(0, 0, coastAt(40), 0, true);
    // on the sand it is nought, and out to sea it grows a unit per unit
    expect(read(field, 42, 0)).toBe(0);
    expect(read(field, 30, 0)).toBeCloseTo(10, 0);
    expect(read(field, 0, 0)).toBeCloseTo(40, 0);
    // and stops growing where the field stops caring
    expect(read(field, -40, 0)).toBe(COAST.RANGE);
  });

  it('does not measure the same water twice for one step of the camera', () => {
    const field = new CoastField();
    const world = coastAt(40);
    expect(field.update(0, 0, world, 0)).toBe(true);
    expect(field.update(1, 0, world, 10)).toBe(false);
    expect(field.update(COAST.RESTEP + 1, 0, world, 20)).toBe(true);
    /*
     * And once it has stopped it stays stopped, however long anybody stands there.
     *
     * The refresh timer used to make this line true, which meant a hero standing on a beach paid
     * for a full chamfer sweep and a texture upload two and a half times a second, for ever, over
     * ground that had finished arriving minutes ago. The timer still decides how often the ground
     * is asked; what it no longer does is assume the answer is yes.
     */
    expect(field.update(COAST.RESTEP + 1, 0, world, 30)).toBe(false);
    expect(field.update(COAST.RESTEP + 1, 0, world, 30 + COAST.REFRESH)).toBe(false);
    expect(field.update(COAST.RESTEP + 1, 0, world, 30 + COAST.REFRESH * 20)).toBe(false);
  });

  it('measures again where it stood still while the ground arrived underneath it', () => {
    /*
     * The other half of the same rule, and the job the timer was really doing. The sea around
     * somebody who has just teleported is measured against a world that has not been generated
     * yet, so it comes out as flat open ocean — and it would stay that way for exactly as long as
     * they stood on the beach looking at it. Standing still is not the same as nothing changing.
     */
    const field = new CoastField();
    const streaming = arrivingCoastAt(40);
    expect(field.update(0, 0, streaming, 0)).toBe(true);
    expect(read(field, 42, 0), 'a beach that has not been generated is open sea').toBe(COAST.RANGE);

    streaming.arrive();
    expect(field.update(0, 0, streaming, COAST.REFRESH)).toBe(true);
    expect(read(field, 42, 0), 'and once the chunks are there, it is a beach').toBe(0);
  });

  it('stands still in the world as the camera moves over it', () => {
    const field = new CoastField();
    const world = coastAt(40);
    field.update(0, 0, world, 0, true);
    field.update(7.3, -3.1, world, 0, true);
    // the grid is snapped to whole cells, so a point keeps its answer rather than crawling
    expect(Math.abs(field.x0 % COAST.CELL)).toBe(0);
    expect(Math.abs(field.z0 % COAST.CELL)).toBe(0);
    expect(read(field, 30, 0)).toBeCloseTo(10, 0);
  });

  it('treats ground nobody has generated as open water', () => {
    const field = new CoastField();
    field.update(0, 0, { getTiles: () => null }, 0, true);
    expect(read(field, 0, 0)).toBe(COAST.RANGE);
  });
});
