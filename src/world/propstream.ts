import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { WORLD } from '../core/config';
import { PropKind } from './biomes';
import type { ChunkData } from './terrain';

/**
 * Where every prop in a chunk stands, said once.
 *
 * This used to live inside the chunk worker, because the only thing that wanted it was drawing.
 * Then collision started wanting it too — a stall has to stop you where its counter is, not where
 * its tile is — and the worlds that walk things are not all the world that draws them. There are
 * three: the game's `ChunkManager`, which draws and walks; `GroundWorld`, which the server walks
 * heroes and creatures with and which has never seen a mesh; and the same again inside a worker.
 *
 * Two of those had no idea where a prop actually stood, so they fell back to "the tile it is on",
 * and things you could see went through things you could see. One function, used by all of them,
 * is the only way that stays true.
 */

/** A prop standing in the world: what it is, where, how big and which way round. */
export interface PropAt {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  stretch: number;
  lean: number;
  tint: number;
}

/**
 * Every prop of one chunk.
 *
 * A structure — a house, a well, a signpost — sits exactly on its tile centre, unscaled and facing
 * its door, and says so by carrying a rotation instead of `NaN`. Everything that grows is jittered
 * off the centre and varied in size, height, lean and shade, so that no two trees are the same tree.
 */
export function* propsOf(chunk: ChunkData, seed: number): Generator<PropAt> {
  const CS = WORLD.CHUNK_SIZE;
  const size = chunk.size;
  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const i = (lz + 1) * size + (lx + 1);
      const kind = chunk.prop[i] as PropKind;
      if (kind === PropKind.None) continue;
      const wx = chunk.cx * CS + lx, wz = chunk.cz * CS + lz;
      const y = kind === PropKind.Lily ? chunk.water[i] : chunk.height[i];
      const fixed = chunk.propRot[i];
      if (Number.isNaN(fixed)) {
        yield {
          kind,
          x: wx + 0.25 + rand2(seed, wx, wz, TILE_SALT.PROP_X) * 0.5,
          y,
          z: wz + 0.25 + rand2(seed, wx, wz, TILE_SALT.PROP_Z) * 0.5,
          rot: rand2(seed, wx, wz, TILE_SALT.PROP_ROT) * Math.PI * 2,
          scale: 0.8 + rand2(seed, wx, wz, TILE_SALT.PROP_SCALE) * 0.45,
          // no two of anything are quite the same height, upright, or shade
          stretch: 0.82 + rand2(seed, wx, wz, TILE_SALT.PROP_STRETCH) * 0.42,
          lean: rand2(seed, wx, wz, TILE_SALT.PROP_LEAN),
          tint: rand2(seed, wx, wz, TILE_SALT.PROP_TINT),
        };
      } else {
        yield { kind, x: wx + 0.5, y, z: wz + 0.5, rot: -fixed, scale: 1, stretch: 1, lean: 0.5, tint: 0.5 };
      }
    }
  }
}
