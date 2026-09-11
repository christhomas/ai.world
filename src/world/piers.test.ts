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

/**
 * And that it comes down to the boat it exists for.
 *
 * A jetty was laid flat at the height of the land it left, which on a headland is three or four
 * terraces above the sea — so the ferry floated a couple of units below the planks and read as a
 * sunken boat, and stepping aboard was a drop off a wall. Reported from the other end: "the pier is
 * under the water, even though you can walk on it."
 *
 * Two rules together, and neither is enough alone. The seaward end has to meet the water, or there
 * is nothing to step onto; and no board may be more than a terrace below the one before it, or the
 * jetty is a staircase a hero cannot climb back up.
 */
describe('the walk out to the end of a jetty', () => {
  it('steps down to where a boat ties up, and is walkable both ways', () => {
    const sampler = new TerrainSampler(growWorld(1, 'road'));
    const deckAt = (x: number, z: number): number | null => {
      const cx = Math.floor(x / WORLD.CHUNK_SIZE), cz = Math.floor(z / WORLD.CHUNK_SIZE);
      const chunk = sampler.generateChunk(cx, cz);
      const lx = x - cx * WORLD.CHUNK_SIZE + 1, lz = z - cz * WORLD.CHUNK_SIZE + 1;
      const at = lz * chunk.size + lx;
      return chunk.type[at] === TileType.Pier ? chunk.height[at] : null;
    };

    let checked = 0;
    for (const pier of sampler.structures.piers) {
      const decks = pier.tiles.map(([x, z]) => deckAt(x, z)).filter((h): h is number => h !== null);
      if (decks.length < 2) continue;
      checked++;
      for (let i = 1; i < decks.length; i++) {
        const drop = decks[i - 1] - decks[i];
        expect(drop, 'a jetty that climbs as it leaves the shore').toBeGreaterThanOrEqual(-0.001);
        expect(drop, 'a step down no hero could climb back up').toBeLessThanOrEqual(WORLD.STEP + 0.001);
      }
      const end = decks[decks.length - 1];
      // it only has six boards, so a pier off a cliff gets as far down as six steps take it; what
      // is asked of every one of them is that it never dips to the water it is standing over
      expect(end, 'the last plank is awash')
        .toBeGreaterThanOrEqual(WORLD.WATER_Y + WORLD.PIER_FREEBOARD - 0.001);
    }
    expect(checked, 'no jetty was long enough to walk down').toBeGreaterThan(0);
  });

  it('brings an ordinary jetty down to a quay\'s height above the water', () => {
    /*
     * Not level with the boat, which was the first attempt and was still reported as a jetty lying
     * in the water: from an isometric view the sea in front of a deck that low is drawn across it.
     * A quay stands clear and you step down into a boat — which is what a jetty is, and leaves the
     * drop aboard within one terrace, the most a hero can climb back up.
     */
    const sampler = new TerrainSampler(growWorld(1, 'road'));
    const ends = sampler.structures.piers
      .filter((p) => p.level * WORLD.STEP <= WORLD.WATER_Y + WORLD.PIER_FREEBOARD + p.tiles.length * WORLD.STEP)
      .map((p) => {
        const [x, z] = p.tiles[p.tiles.length - 1];
        const cx = Math.floor(x / WORLD.CHUNK_SIZE), cz = Math.floor(z / WORLD.CHUNK_SIZE);
        const chunk = sampler.generateChunk(cx, cz);
        const at = (z - cz * WORLD.CHUNK_SIZE + 1) * chunk.size + (x - cx * WORLD.CHUNK_SIZE + 1);
        return chunk.type[at] === TileType.Pier ? chunk.height[at] : null;
      })
      .filter((h): h is number => h !== null);
    expect(ends.length, 'this world has no ordinary jetties in it').toBeGreaterThan(0);
    for (const end of ends) expect(end).toBeCloseTo(WORLD.WATER_Y + WORLD.PIER_FREEBOARD, 5);
  });

  it('leaves a step down into the boat rather than a drop', () => {
    // the jetty stands proud of the water and the ferry floats in it, so there is a difference
    // between the two by design. It has to stay inside what a hero can climb back up
    const drop = (WORLD.WATER_Y + WORLD.PIER_FREEBOARD) - WORLD.BOAT_DECK;
    expect(drop, 'the quay is below the boat it serves').toBeGreaterThan(0);
    expect(drop, 'boarding a ferry is a fall off a wall').toBeLessThanOrEqual(WORLD.STEP);
  });
});
