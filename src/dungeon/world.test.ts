import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { buildChunkMesh, type WallCut } from '../world/mesher';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { CASTLE, generateCastle } from './castle';
import { generateDungeon, type DungeonStyle } from './generate';
import { BASE_LEVEL, DTile, levelAt } from './map';
import { DungeonWorld } from './world';

/**
 * The floor underground, as something you can see and something you can stand on.
 *
 * The first of those is here because it was silently gone. `buildChunkMesh` cuts every quad from a
 * chunk's `corners`; `DungeonWorld.chunkData` filled in `height` and left `corners` at nought, so
 * every vertex of every dungeon sat at y = 0. The rock was still solid to walk into and the map in
 * the corner still drew it, so nothing failed — there was simply no wall standing up anywhere
 * underground, in any hole in the game. It is exactly the shape of bug that only a test notices,
 * so here is the test.
 */

/** The highest and lowest point of the land actually cut for a floor. */
function heightSpan(world: DungeonWorld): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let cz = 0; cz < world.chunksPerSide; cz++) {
    for (let cx = 0; cx < world.chunksPerSide; cx++) {
      const chunk = world.chunkData(cx, cz);
      if (chunk.empty) continue;
      const mesh = buildChunkMesh(chunk, 1);
      if (!mesh.land) continue;
      for (let i = 1; i < mesh.land.positions.length; i += 3) {
        lo = Math.min(lo, mesh.land.positions[i]);
        hi = Math.max(hi, mesh.land.positions[i]);
      }
    }
  }
  return [lo, hi];
}

describe('a dungeon floor is drawn as well as walked', () => {
  it('stands its rock up, in every kind of place underground', () => {
    for (const style of ['vault', 'cave', 'thicket', 'castle'] as DungeonStyle[]) {
      const world = new DungeonWorld(generateDungeon(4242, style, 1), 'test', style);
      const [lo, hi] = heightSpan(world);
      expect(lo, `a ${style} is cut below the seabed`).toBe(0);
      expect(
        hi,
        `a ${style} comes out flat: its walls have no height, so it is a coloured floor plan and not a place`,
      ).toBeGreaterThan(WORLD.STEP * 2);
    }
  });

  it('puts a castle gallery in the air over the hall it looks down on', () => {
    const map = generateCastle(4242, 1);
    const world = new DungeonWorld(map, 'test', 'castle');
    const high = BASE_LEVEL + CASTLE.GALLERY_RISE;
    let found = 0;
    for (let i = 0; i < map.tiles.length; i++) {
      const x = i % map.size, z = (i - x) / map.size;
      if (map.tiles[i] !== DTile.Floor || levelAt(map, x, z) !== high) continue;
      found++;
      expect(world.heightAt(x + 0.5, z + 0.5), 'the gallery is not standing where the plan says').toBe(high * WORLD.STEP);
    }
    expect(found, 'the great hall has no gallery over it at all').toBeGreaterThan(6);
    // and the ordinary floor of the same castle is still one terrace up, as every floor down here is
    const [ex, ez] = map.entrance;
    expect(world.heightAt(ex + 0.5, ez + 0.5)).toBe(BASE_LEVEL * WORLD.STEP);
  });

  it('leaves a hole in the ground at exactly one height, as it always was', () => {
    for (const style of ['vault', 'cave', 'thicket'] as DungeonStyle[]) {
      const map = generateDungeon(77, style, 1);
      expect(map.levels, `a ${style} has grown levels it has no use for`).toBeNull();
      const world = new DungeonWorld(map, 'test', style);
      for (let i = 0; i < map.tiles.length; i++) {
        if (map.tiles[i] !== DTile.Floor) continue;
        const x = i % map.size, z = (i - x) / map.size;
        expect(world.heightAt(x + 0.5, z + 0.5)).toBe(BASE_LEVEL * WORLD.STEP);
      }
    }
  });
});

/**
 * A wall you can see what it is made of.
 *
 * Every wall in this world was one flat quad however tall it was, which above ground is honest — a
 * hillside is not made of anything, so a hillside of one colour is the truth — and underground is
 * not. A castle is *built*, and a curtain four courses high drawn as a single grey polygon reads
 * as a cardboard model of a castle. A mine is *dug*, and its rock has tool marks on it.
 *
 * There are no textures in this world and there should not be: the whole look is flat colour on
 * honest geometry. So the blocks are geometry, the same way the miner's hard hat has a moulded rib
 * rather than a picture of one — which means the thing to test is that the faces are actually
 * there, and that nothing above ground has grown any.
 */
describe('the walls of a place you are inside', () => {
  const faces = (style: DungeonStyle, cut?: WallCut): number => {
    const world = new DungeonWorld(generateDungeon(4242, style, 1), 'test', style);
    let tris = 0;
    for (let cz = 0; cz < world.chunksPerSide; cz++) {
      for (let cx = 0; cx < world.chunksPerSide; cx++) {
        const chunk = world.chunkData(cx, cz);
        if (chunk.empty) continue;
        tris += buildChunkMesh(chunk, 1, cut).land?.indices.length ?? 0;
      }
    }
    return tris;
  };

  it('is laid up in blocks rather than drawn as one slab', () => {
    for (const style of ['castle', 'cave'] as DungeonStyle[]) {
      const flat = faces(style);
      const laid = faces(style, style === 'castle' ? 'stone' : 'hewn');
      expect(flat, `a ${style} has no walls to cut at all`).toBeGreaterThan(0);
      // a five-terrace wall becomes five courses of two blocks, so the wall faces multiply while
      // the floor does not: anything less than half again is a cut that did not happen
      expect(laid, `a ${style}'s walls came out the same size cut as uncut`).toBeGreaterThan(flat * 1.5);
    }
  });

  it('costs nothing at all to the country above ground, which is not masonry', () => {
    const sampler = new TerrainSampler(generateWebGraph(3));
    const chunk = sampler.generateChunk(0, 0);
    const plain = buildChunkMesh(chunk, 3);
    const asked = buildChunkMesh(chunk, 3, undefined);
    expect(asked.land?.indices.length).toBe(plain.land?.indices.length);
  });
});
