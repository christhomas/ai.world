import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { samplerIn, townsIn, countryFor } from './endless';
import { TileType, type ChunkData } from './ground';
import type { Within } from './window';

/**
 * A patch of the endless country, drawn.
 *
 * Everything under this was proved on its own and none of it was a world. What is checked here is
 * that the pieces make one: that a sampler handed a country instead of a mesh paints ground, sea,
 * roads and villages, and — the property the whole of B7 exists for — that two patches side by side
 * paint the ground they share identically.
 *
 * The chunk comparison is the strong form of that. A tile's colour depends on the road nearest it,
 * the river crossing it, the village standing on it, the mountain behind it and the sea in front of
 * it, so two patches agreeing about a chunk of tiles is two patches agreeing about all of it.
 */

const SEED = 4242;
const TILES = WORLD.CHUNK_SIZE;

/** Two patches with a good deal of ground in common, neither a corner of the other. */
const WEST: Within = { x0: 0, z0: 0, x1: 512, z1: 512 };
const EAST: Within = { x0: 256, z0: 0, x1: 768, z1: 512 };

/**
 * The chunks whose tiles all lie inside both patches, thinned.
 *
 * Every third one in each direction rather than all of them: a patch is a quarter of a million
 * tiles and painting it twice is most of a minute, while the fault this is looking for — a road, a
 * river or a village that one patch has and the other does not — is tens of tiles across and cannot
 * hide between two chunks three apart.
 */
const SHARED: Array<[number, number]> = [];
for (let cz = 1; cz < 512 / TILES - 1; cz += 3) {
  for (let cx = Math.ceil(256 / TILES) + 1; cx < 512 / TILES - 1; cx += 3) SHARED.push([cx, cz]);
}

function differences(a: ChunkData, b: ChunkData): string[] {
  const out: string[] = [];
  for (const field of ['type', 'biome', 'prop', 'sloped', 'height', 'shore', 'water'] as const) {
    const one = a[field] as ArrayLike<number>, two = b[field] as ArrayLike<number>;
    for (let i = 0; i < one.length; i++) {
      if (!Object.is(one[i], two[i])) { out.push(`${field}[${i}] ${one[i]} vs ${two[i]}`); break; }
    }
  }
  return out;
}

describe('a patch of the endless country', () => {
  const west = samplerIn(SEED, WEST);

  it('has roads, water and villages in it', () => {
    expect(west.graph.edges.length, 'no roads').toBeGreaterThan(20);
    expect(west.hydro.rivers.length + west.hydro.lakes.length, 'no water').toBeGreaterThan(0);
    expect(west.structures.villages.length, 'nowhere to live').toBeGreaterThan(0);
    expect(west.structures.all.length, 'nothing was built').toBeGreaterThan(10);
  });

  it('paints ground rather than an empty sea', () => {
    const seen = new Map<TileType, number>();
    let tiles = 0;
    for (const [cx, cz] of SHARED.slice(0, 6)) {
      const chunk = west.generateChunk(cx, cz);
      for (const t of chunk.type) { seen.set(t as TileType, (seen.get(t as TileType) ?? 0) + 1); tiles++; }
    }
    expect(tiles, 'no tiles were painted').toBeGreaterThan(1000);
    const ground = (seen.get(TileType.Ground) ?? 0) + (seen.get(TileType.GroundAlt) ?? 0);
    expect(ground / tiles, 'a patch that is nearly all sea').toBeGreaterThan(0.1);
    expect(seen.get(TileType.Road) ?? 0, 'roads that are drawn nowhere').toBeGreaterThan(0);
  });

  it('stands rock on its high country', () => {
    const rock = west.ranges;
    expect(rock, 'no mountains at all').toBeTruthy();
    expect(rock!.peaks.length, 'high country with nothing standing on it').toBeGreaterThan(0);
    expect(rock!.tris.length, 'peaks with no rock under them').toBeGreaterThan(900);
    // a summit stands above the ground it is on, which is the whole difference between a mountain
    // and a hill drawn in the heightfield
    for (const peak of rock!.peaks) expect(peak.y).toBeGreaterThan(peak.lift);
  });

  it('cuts the same rock in the ground two patches share', () => {
    const east = samplerIn(SEED, EAST);
    const summits = (s: typeof west): string[] => (s.ranges?.peaks ?? [])
      .filter((p) => p.x >= 300 && p.x <= 460)
      .map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)} ${p.lift.toFixed(3)}`)
      .sort();
    const mine = summits(west);
    expect(mine.length, 'no summits in the ground they share').toBeGreaterThan(0);
    expect(summits(east)).toEqual(mine);
  });

  it('paints the ground two patches share exactly the same way', () => {
    const east = samplerIn(SEED, EAST);
    expect(SHARED.length, 'no shared chunks to compare').toBeGreaterThan(3);
    for (const [cx, cz] of SHARED) {
      const found = differences(west.generateChunk(cx, cz), east.generateChunk(cx, cz));
      expect(found, `chunk ${cx},${cz} differs between two patches: ${found.join(', ')}`).toEqual([]);
    }
  });

  it('founds the same towns in the ground two patches share', () => {
    const world = countryFor(SEED);
    const named = (within: Within): string[] => townsIn(world, within)
      .filter((t) => t.x >= 256 && t.x <= 512)
      .map((t) => `${t.id} ${t.name} ${t.size} ${t.level}`)
      .sort();
    expect(named(WEST).length, 'no towns in the overlap').toBeGreaterThan(0);
    expect(named(EAST)).toEqual(named(WEST));
  });
});
