import { describe, expect, it } from 'vitest';
import { BIOMES } from './biomes';
import { WORLD } from '../core/config';
import { buildChunkMesh, hexToLinear } from './mesher';
import type { ChunkData } from './ground';

/**
 * What colour a vertical face is, which is the whole of what makes a terrace read as rock.
 *
 * Item #252 asked for cliff faces tinted by the fact that they are cliffs rather than taking the
 * colour of the ground on top of them, and asked for this file to cover the wall case directly.
 * The tint was already there — `BIOMES` has carried a `cliff` colour per biome for a while — and
 * this file is the half that was missing: nothing pinned it, so nothing would have noticed a cliff
 * quietly going back to being dimmer grass.
 *
 * Read off the buffer rather than off a uniform, because that is the other half of what the item
 * asked for: the colour is in the mesh and costs nothing per frame, and is therefore identical on
 * both rig implementations without either of them knowing about cliffs.
 */

/** A real chunk: `CHUNK_SIZE` tiles with a one-tile apron each side, which is what the mesher walks. */
const SIZE = 18;

/** A chunk of flat ground at one height, with a lower shelf cut into the far half. */
function terraced(drop: number, biome = 0): ChunkData {
  const n = SIZE * SIZE;
  const height = new Float32Array(n);
  const corners = new Float32Array(n * 4);
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const at = z * SIZE + x;
      const y = z < SIZE / 2 ? drop : 0;      // a shelf across the middle: one terrace, one drop
      height[at] = y;
      corners.fill(y, at * 4, at * 4 + 4);
    }
  }
  return {
    cx: 0, cz: 0, size: SIZE, height, corners,
    // TileType.Ground — a const enum, so the number rather than an import that erases
    type: new Uint8Array(n).fill(2),
    biome: new Uint8Array(n).fill(biome),
    prop: new Uint8Array(n),
    propRot: new Float32Array(n).fill(NaN),
    shore: new Float32Array(n),
    sloped: new Uint8Array(n),
    water: new Float32Array(n),
    empty: false,
  } as unknown as ChunkData;
}

/** Every distinct colour in a mesh, rounded so float noise does not make two of one. */
function coloursIn(colors: Float32Array): string[] {
  const seen = new Set<string>();
  for (let at = 0; at < colors.length; at += 3) {
    seen.add([0, 1, 2].map((k) => colors[at + k].toFixed(3)).join(','));
  }
  return [...seen];
}

const near = (rgb: readonly number[], to: readonly number[], within = 0.08): boolean =>
  rgb.every((v, k) => Math.abs(v - to[k]) <= within);

describe('what colour a cliff face is', () => {
  // `Biome` is a const enum and erases under the test runner, so the table is read directly.
  const plains = BIOMES[0];

  it('draws a real drop in the biome cliff colour, not in the ground colour', () => {
    const { land } = buildChunkMesh(terraced(WORLD.STEP * 2), 1);
    expect(land, 'a terraced chunk makes a land mesh').not.toBeNull();

    const cliff = hexToLinear(plains.cliff);
    const found = coloursIn(land!.colors).map((c) => c.split(',').map(Number));
    expect(found.some((c) => near(c, cliff)), 'no quad is the cliff colour').toBe(true);
  });

  it('keeps the top of the terrace a different colour from its face', () => {
    const { land } = buildChunkMesh(terraced(WORLD.STEP * 2), 1);
    const ground = hexToLinear(plains.ground);
    const cliff = hexToLinear(plains.cliff);

    // the two are not the same decision, which is the whole of item #252
    expect(near(ground, cliff, 0.02), 'ground and cliff are the same colour').toBe(false);

    const found = coloursIn(land!.colors).map((c) => c.split(',').map(Number));
    expect(found.some((c) => near(c, cliff)), 'the face is rock').toBe(true);
    expect(found.length, 'a terraced chunk is more than one flat colour').toBeGreaterThan(1);
  });

  it('draws a ramp lip in the ground colour instead, because a lip is not a wall', () => {
    // a drop under `LIP_FRACTION` of a terrace is a hand's breadth of ground, deliberately
    const { land } = buildChunkMesh(terraced(WORLD.STEP * 0.2), 1);
    const cliff = hexToLinear(plains.cliff);
    const found = coloursIn(land!.colors).map((c) => c.split(',').map(Number));
    expect(found.some((c) => near(c, cliff, 0.03)), 'a lip was drawn as rock').toBe(false);
  });

  it('gives every biome a cliff that is not its ground', () => {
    for (const def of BIOMES) {
      expect(near(hexToLinear(def.ground), hexToLinear(def.cliff), 0.02), def.name).toBe(false);
    }
  });
});
