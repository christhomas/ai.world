import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { buildChunkMesh } from '../world/mesher';
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
