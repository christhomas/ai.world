import { describe, expect, it } from 'vitest';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { GroundWorld } from '../world/groundworld';
import { tilesOf } from '../world/tiles';
import { propFootprints } from './props';
import { openGround } from './spawns';
import { sortTiles } from './chunkspots';
import { mulberry32 } from '../core/rng';
import { WORLD } from '../core/config';

/**
 * Nothing wild is put down where people live.
 *
 * Wolves were spawning in the middle of towns, night after night, and the reason was that nothing in
 * the spawning ever asked. A village's streets and gardens are ordinary ground — the tiles do not
 * say "village", the structures do — so every yard inside a settlement went into the same pool of
 * open country a pack picks its den out of. The pack then behaves exactly as a pack should, which
 * is what made it look like an attack rather than a bug.
 *
 * Measured before the guard went in: of the 27,571 land tiles within two chunks of six villages of
 * seed 3, people live on 20,324 of them — **73.7%** — and every one was on offer as a den. That is
 * the number behind "they almost constantly spawn from places inside towns".
 *
 * This walks the ground round every village of a real world and counts what would be offered.
 */

/** One sampler per seed, because a world is expensive and this asks it a great many questions. */
const samplers = new Map<number, TerrainSampler>();
function sampler(seed: number): TerrainSampler {
  let s = samplers.get(seed);
  if (!s) { s = new TerrainSampler(generateWebGraph(seed)); samplers.set(seed, s); }
  return s;
}
const world = (seed: number): GroundWorld => new GroundWorld(sampler(seed), propFootprints());

describe('where a wild thing may be put down', () => {
  it('offers no den inside a village, over the whole country round one', () => {
    const ground = world(3);
    const villages = ground.villages;
    expect(villages.length, 'a world with no villages proves nothing').toBeGreaterThan(2);

    let offered = 0, inside = 0, refused = 0;
    // two chunks out from each village, which is village at the middle and country at the edges
    for (const village of villages.slice(0, 6)) {
      const cx = Math.floor(village.x / WORLD.CHUNK_SIZE), cz = Math.floor(village.z / WORLD.CHUNK_SIZE);
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const tiles = tilesOf(sampler(3).generateChunk(cx + dx, cz + dz));
          const land = sortTiles(tiles).land;
          if (land.length === 0) continue;
          const rng = mulberry32(1234 + dx * 7 + dz * 13);
          for (let n = 0; n < 40; n++) {
            const spot = openGround(ground, tiles, land, rng);
            if (!spot) { refused++; continue; }
            offered++;
            if (ground.peopled(spot[0], spot[1])) inside++;
          }
        }
      }
    }
    expect(offered, 'no ground was offered at all, so nothing was tested').toBeGreaterThan(200);
    expect(inside, `${inside} of ${offered} dens were offered inside a village`).toBe(0);
    // and the refusals are the point: without them every one of these was a pack in somebody's street
    expect(refused, 'nothing was ever refused, so the guard is not doing anything').toBeGreaterThan(0);
  });

  it('still offers ground out in the country, or nothing could live anywhere', () => {
    const ground = world(3);
    const far = ground.villages[0];
    // a long way from that village, where a pack belongs
    const cx = Math.floor((far.x + 400) / WORLD.CHUNK_SIZE), cz = Math.floor((far.z + 400) / WORLD.CHUNK_SIZE);
    const tiles = tilesOf(sampler(3).generateChunk(cx, cz));
    const land = sortTiles(tiles).land;
    if (land.length === 0) return;
    const rng = mulberry32(99);
    let found = 0;
    for (let n = 0; n < 40; n++) if (openGround(ground, tiles, land, rng)) found++;
    expect(found, 'open country offers nowhere for anything to live').toBeGreaterThan(0);
  });
});
