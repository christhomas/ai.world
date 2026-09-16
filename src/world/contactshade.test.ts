import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { contactField, contactShade } from './contactshade';
import { buildChunkMesh } from './mesher';
import type { ChunkData } from './ground';

/**
 * That something darkens where two surfaces meet.
 *
 * Item #251: in a world with no textures, light is the only channel detail can arrive through, and
 * until this landed nothing in the game went darker where a wall met a floor or a cottage met the
 * grass. A prop stood on ground exactly as bright as the ground a hundred tiles away, which is why
 * props read as stickers laid on the map rather than as blocks sitting on it.
 *
 * What is checked here is the *data*, not the picture. The mesher hands out plain typed arrays and
 * the darkening is baked into the colours in them, so "is the foot of that wall darker than its
 * top" is a question about a `Float32Array` and can be asked without a renderer in the room — which
 * is the same reason `world/mesher.ts` has no `THREE` import in it.
 */

/** A real chunk: `CHUNK_SIZE` tiles with a one-tile apron each side, which is what the mesher walks. */
const SIZE = WORLD.CHUNK_SIZE + 2;

/** `TileType.Ground` — a const enum, so the number rather than an import that erases. */
const GROUND = 2;
/** `PropKind.Oak`, for the same reason. */
const OAK = 1;

/**
 * A chunk of flat ground at one height, with a lower shelf cut into the near half.
 *
 * Tiles with `z < SIZE / 2` stand `drop` above the rest, so there is one step running across the
 * middle of the chunk with a foot on one side of it and a lip on the other.
 */
function terraced(drop: number): ChunkData {
  const n = SIZE * SIZE;
  const height = new Float32Array(n);
  const corners = new Float32Array(n * 4);
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const at = z * SIZE + x;
      const y = z < SIZE / 2 ? drop : 0;
      height[at] = y;
      corners.fill(y, at * 4, at * 4 + 4);
    }
  }
  return {
    cx: 0, cz: 0, size: SIZE, height, corners,
    type: new Uint8Array(n).fill(GROUND),
    biome: new Uint8Array(n),
    prop: new Uint8Array(n),
    propRot: new Float32Array(n).fill(NaN),
    shore: new Float32Array(n),
    sloped: new Uint8Array(n),
    water: new Float32Array(n),
    empty: false,
  } as unknown as ChunkData;
}

/** The same chunk with one prop growing on local tile (lx, lz). */
function planted(chunk: ChunkData, lx: number, lz: number, kind = OAK): ChunkData {
  chunk.prop[(lz + 1) * chunk.size + (lx + 1)] = kind;
  return chunk;
}

/** How much light a colour carries, which is all these tests compare. */
const lit = (colors: Float32Array, v: number): number =>
  colors[v * 3] + colors[v * 3 + 1] + colors[v * 3 + 2];

describe('what the field says about a contact', () => {
  it('leaves flat, empty country alone: nothing meets, so nothing darkens', () => {
    const chunk = terraced(0);
    const field = contactField(chunk, 1);
    for (let cz = 0; cz <= WORLD.CHUNK_SIZE; cz++) {
      for (let cx = 0; cx <= WORLD.CHUNK_SIZE; cx++) {
        expect(contactShade(field, cx, cz, 0), `corner ${cx},${cz}`).toBe(1);
      }
    }
  });

  it('darkens the foot of a step and leaves the top of it alone', () => {
    const drop = WORLD.STEP;
    const chunk = terraced(drop);
    const field = contactField(chunk, 1);
    // the step runs along the corner row at z = SIZE / 2 - 1, in local tile coordinates
    const crease = SIZE / 2 - 1;

    // the lower ground at that corner is standing in the crease and goes darker
    expect(contactShade(field, 8, crease, 0)).toBeLessThan(1);
    // the upper ground meets the very same corner, and a lip is a convex edge: nothing occludes it
    expect(contactShade(field, 8, crease, drop)).toBe(1);
    // and out in the open, two tiles away from anything, the ground is the ground
    expect(contactShade(field, 8, crease + 3, 0)).toBe(1);
  });

  it('darkens deeper for a taller step, up to a terrace and no further', () => {
    const one = contactField(terraced(WORLD.STEP), 1);
    const four = contactField(terraced(WORLD.STEP * 4), 1);
    const crease = SIZE / 2 - 1;
    const half = contactField(terraced(WORLD.STEP * 0.5), 1);

    expect(contactShade(half, 8, crease, 0)).toBeGreaterThan(contactShade(one, 8, crease, 0));
    expect(contactShade(four, 8, crease, 0)).toBe(contactShade(one, 8, crease, 0));
  });

  it('darkens the ground a prop stands on, and only near it', () => {
    const bare = contactField(terraced(0), 1);
    const grown = contactField(planted(terraced(0), 8, 8), 1);

    expect(contactShade(bare, 8, 8, 0)).toBe(1);
    expect(contactShade(grown, 8, 8, 0)).toBeLessThan(1);
    expect(contactShade(grown, 2, 2, 0), 'a tree darkened ground four tiles away').toBe(1);
  });

  it('takes more light from under a thing somebody built than from under a thing that grew', () => {
    const tree = planted(terraced(0), 8, 8);
    const house = planted(terraced(0), 8, 8, 20);      // PropKind.HousePlains
    // a structure faces its door rather than rolling for a direction, which is how the chunk says
    // that this one was built rather than grown
    house.propRot[9 * SIZE + 9] = 0;

    const under = (chunk: ChunkData): number => contactShade(contactField(chunk, 1), 8, 8, 0);
    expect(under(tree)).toBeLessThan(1);
    expect(under(house)).toBeLessThan(under(tree));
  });
});

describe('what the mesher bakes into the colours', () => {
  it('draws every cliff face darker at its foot than at its top', () => {
    const { land } = buildChunkMesh(terraced(WORLD.STEP * 2), 1);
    expect(land).not.toBeNull();
    const { positions, colors } = land!;

    let walls = 0;
    // the builder pushes four vertices per quad in order, so a quad is four consecutive vertices
    for (let q = 0; q * 4 + 3 < positions.length / 3; q++) {
      const vs = [0, 1, 2, 3].map((k) => q * 4 + k);
      const ys = vs.map((v) => positions[v * 3 + 1]);
      const tall = Math.max(...ys) - Math.min(...ys);
      if (tall < WORLD.STEP) continue;      // not a standing face
      walls++;
      const foot = vs.filter((v) => positions[v * 3 + 1] === Math.min(...ys));
      const top = vs.filter((v) => positions[v * 3 + 1] === Math.max(...ys));
      const darkest = Math.max(...foot.map((v) => lit(colors, v)));
      const brightest = Math.min(...top.map((v) => lit(colors, v)));
      expect(darkest, `wall quad ${q} is no darker at its foot`).toBeLessThan(brightest);
    }
    expect(walls, 'a terraced chunk drew no walls at all').toBeGreaterThan(0);
  });

  it('lays a darker patch of ground under a prop and leaves the rest of the field alone', () => {
    const CS = WORLD.CHUNK_SIZE;
    const bare = buildChunkMesh(terraced(0), 1).land!;
    const grown = buildChunkMesh(planted(terraced(0), 8, 8), 1).land!;

    // flat country draws one quad per tile and no walls at all, so the two meshes are the same
    // mesh with one difference in them and the tiles can be compared vertex for vertex
    expect(grown.positions.length).toBe(bare.positions.length);
    const quad = (lx: number, lz: number): number[] => [0, 1, 2, 3].map((k) => (lz * CS + lx) * 4 + k);

    for (const v of quad(8, 8)) {
      expect(lit(grown.colors, v), `the ground under the tree at vertex ${v}`)
        .toBeLessThan(lit(bare.colors, v) * 0.9);
    }
    for (const v of quad(2, 2)) {
      expect(lit(grown.colors, v), `a tree six tiles off moved vertex ${v}`)
        .toBeCloseTo(lit(bare.colors, v), 10);
    }
  });

  it('leaves flat, empty ground exactly as bright as it was', () => {
    // the whole of this change is contacts: country with none of them must not move a hair, and
    // the only thing left varying across it is the per-tile shade jitter
    const flat = buildChunkMesh(terraced(0), 7).land!;
    let brightest = 0, darkest = Infinity;
    for (let v = 0; v * 3 < flat.colors.length; v++) {
      brightest = Math.max(brightest, lit(flat.colors, v));
      darkest = Math.min(darkest, lit(flat.colors, v));
    }
    // SHADE_MIN .. SHADE_MIN + SHADE_RANGE, and nothing else
    expect(brightest / darkest).toBeLessThanOrEqual(1.06 / 0.94);
  });
});
