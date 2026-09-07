import type { ChunkManager } from '../world/chunkManager';

/** How far a river carries. Beyond this the world is quiet whatever is running through it. */
const WATER_EARSHOT = 22;

/**
 * How much water is within earshot, and how far the loudest of it is falling.
 *
 * Felt outward in a ring rather than kept as a field: what matters is only whether there is
 * water near enough to hear and whether it is dropping, and a couple of dozen lookups a frame
 * is cheaper than maintaining anything. The drop is measured between neighbouring surfaces,
 * which is the same thing the mesher uses to decide it is drawing a waterfall.
 */
export function listenForWater(chunks: ChunkManager, x: number, z: number): { nearness: number; drop: number } {
  let nearest = Infinity;
  let loudest = 0;
  for (let r = 2; r <= WATER_EARSHOT; r += 4) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const here = chunks.waterAt(px, pz);
      if (here === null) continue;
      if (r < nearest) nearest = r;
      // the fall beside it, if any: how far this surface stands above the next one along
      const there = chunks.waterAt(px + Math.cos(a) * 2, pz + Math.sin(a) * 2);
      if (there !== null) loudest = Math.max(loudest, Math.abs(here - there));
    }
  }
  return { nearness: nearest === Infinity ? 0 : 1 - Math.min(1, nearest / WATER_EARSHOT), drop: loudest };
}
