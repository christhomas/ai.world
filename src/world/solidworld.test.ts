import { describe, expect, it } from 'vitest';
import { generateWebGraph } from './roadweb';
import { TerrainSampler } from './terrain';
import { GroundWorld } from './groundworld';
import { boxesOf } from './solids';
import { propFootprints } from '../render/props';
import { PropKind } from './biomes';
import { WORLD } from '../core/config';

/**
 * Every box in a piece of a real world, against the world that walks heroes through it.
 *
 * The unit tests either side of this one prove the arithmetic; this proves the plumbing, which is
 * where both faults actually were. A box is built from a footprint, put down by a chunk, and
 * looked up by whoever is walking — and a house was reported walk-through twice while the
 * arithmetic was correct both times. First because the mover only asked about the far end of its
 * step, then because a chunk's boxes were clamped to that chunk's own tiles, so the quarter of a
 * cottage that lay over a boundary was solid to nobody.
 *
 * Neither would have survived this: it takes the boxes as the world builds them and asks the world
 * about points inside their own walls, which is a question that can only be answered wrongly if
 * something between the two has gone wrong.
 */
describe('every box in a piece of a real world', () => {
  it('is solid inside its own walls', () => {
    const sampler = new TerrainSampler(generateWebGraph(3));
    const ground = new GroundWorld(sampler, propFootprints());
    const CS = WORLD.CHUNK_SIZE;
    const LOW = 6, HIGH = 9;
    for (let cz = LOW; cz <= HIGH; cz++) for (let cx = LOW; cx <= HIGH; cx++) ground.reach(cx * CS + 8, cz * CS + 8, 0);
    const holes: string[] = [];
    let checked = 0;
    for (let cz = LOW + 1; cz < HIGH; cz++) for (let cx = LOW + 1; cx < HIGH; cx++) {
      for (const box of boxesOf(sampler.generateChunk(cx, cz), sampler.seed, propFootprints())) {
        checked++;
        const cos = Math.cos(box.rot), sin = Math.sin(box.rot);
        for (const [ax, az] of [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]]) {
          // the sample in the box's own frame, turned into the world's
          const lx = ax * box.hw, lz = az * box.hd;
          const x = box.x + lx * cos - lz * sin, z = box.z + lx * sin + lz * cos;
          if (!ground.blocked(x, z)) holes.push(`${x.toFixed(1)},${z.toFixed(1)} inside a box at ${box.x},${box.z} (${box.hw}x${box.hd} rot ${box.rot.toFixed(2)})`);
        }
      }
    }
    expect(holes, 'somewhere inside a drawn box that a hero can walk through').toEqual([]);
    // and that the slab had something in it at all, so this cannot pass by finding nothing
    expect(checked, 'no boxes in the slab: the audit tested nothing').toBeGreaterThan(20);
  });
});
