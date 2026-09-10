import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { growWorld } from './growworld';
import { TerrainSampler, TileType } from './terrain';

/**
 * The jetty a ferry ties up at.
 *
 * A tile in this world says two things about its height and they are not the same thing. `height`
 * is what anybody standing there is standing on; `corners` are what is *drawn* — that separation is
 * the whole reason a terrace is a terrace and a ramp is a ramp. A pier set the first and not the
 * second, so it was three units of walkable deck whose picture lay flat on the seabed: you walked
 * out over open water on nothing at all, and the boat you were boarding sat at the end of an
 * invisible jetty.
 *
 * Nothing in the suite would have noticed. Everything that asks about a pier asks `heightAt`, which
 * was right — so this checks the two against each other, which is the only way that class of fault
 * is ever caught.
 */
describe('every plank of every pier', () => {
  it('is drawn where it is walked on, and stands above the water', () => {
    const sampler = new TerrainSampler(growWorld(1, 'road'));
    const piers = sampler.structures.piers;
    expect(piers.length, 'a world with no ferries in it proves nothing').toBeGreaterThan(0);

    let planks = 0;
    for (const pier of piers) {
      for (const [x, z] of pier.tiles) {
        const cx = Math.floor(x / WORLD.CHUNK_SIZE), cz = Math.floor(z / WORLD.CHUNK_SIZE);
        const chunk = sampler.generateChunk(cx, cz);
        const lx = x - cx * WORLD.CHUNK_SIZE + 1, lz = z - cz * WORLD.CHUNK_SIZE + 1;
        const at = lz * chunk.size + lx;
        // a plank that another structure won — a road, a bridge — is not this test's business
        if (chunk.type[at] !== TileType.Pier) continue;
        planks++;
        const height = chunk.height[at];
        expect(height, `the deck at ${x},${z} is under the sea`).toBeGreaterThan(WORLD.WATER_Y);
        for (let corner = 0; corner < 4; corner++) {
          expect(chunk.corners[at * 4 + corner], `the deck at ${x},${z} is drawn at a different height from the one you stand on`)
            .toBeCloseTo(height, 5);
        }
      }
    }
    expect(planks, 'no pier tiles were laid at all').toBeGreaterThan(10);
  });
});
