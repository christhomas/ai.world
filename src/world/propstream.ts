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
/**
 * Where one tile's prop stands, if it has one.
 *
 * Split out of `propsOf` because the ground wants the answer for tiles that are not the chunk's
 * own. A contact shade has to reach across a chunk edge or there is a seam down the join where
 * the trees on one side stop casting anything, so `world/contactshade.ts` asks this of the apron
 * as well — tiles from `-1` to `CHUNK_SIZE` inclusive, which is every tile the chunk carries.
 *
 * `planted` is the same distinction `propRot` already draws and is worth a name. Anything that
 * grew — a tree, a rock, a reed — is jittered off its tile centre and rolled for size. Anything
 * somebody built sits exactly on the centre, unscaled, facing its door, and is a great deal wider
 * across the ground than a trunk is.
 */
export interface PropSpot {
  kind: PropKind;
  x: number;
  z: number;
  scale: number;
  planted: boolean;
}

export function propSpot(chunk: ChunkData, seed: number, lx: number, lz: number): PropSpot | null {
  const CS = WORLD.CHUNK_SIZE;
  const i = (lz + 1) * chunk.size + (lx + 1);
  const kind = chunk.prop[i] as PropKind;
  if (kind === PropKind.None) return null;
  const wx = chunk.cx * CS + lx, wz = chunk.cz * CS + lz;
  if (!Number.isNaN(chunk.propRot[i])) return { kind, x: wx + 0.5, z: wz + 0.5, scale: 1, planted: true };
  return {
    kind,
    x: wx + 0.25 + rand2(seed, wx, wz, TILE_SALT.PROP_X) * 0.5,
    z: wz + 0.25 + rand2(seed, wx, wz, TILE_SALT.PROP_Z) * 0.5,
    scale: 0.8 + rand2(seed, wx, wz, TILE_SALT.PROP_SCALE) * 0.45,
    planted: false,
  };
}

export function* propsOf(chunk: ChunkData, seed: number): Generator<PropAt> {
  const CS = WORLD.CHUNK_SIZE;
  const size = chunk.size;
  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const spot = propSpot(chunk, seed, lx, lz);
      if (!spot) continue;
      const i = (lz + 1) * size + (lx + 1);
      const { kind, x, z, scale } = spot;
      const wx = chunk.cx * CS + lx, wz = chunk.cz * CS + lz;
      const y = kind === PropKind.Lily ? chunk.water[i] : chunk.height[i];
      const fixed = chunk.propRot[i];
      if (Number.isNaN(fixed)) {
        yield {
          kind, x, y, z, scale,
          rot: rand2(seed, wx, wz, TILE_SALT.PROP_ROT) * Math.PI * 2,
          // no two of anything are quite the same height, upright, or shade
          stretch: 0.82 + rand2(seed, wx, wz, TILE_SALT.PROP_STRETCH) * 0.42,
          lean: rand2(seed, wx, wz, TILE_SALT.PROP_LEAN),
          tint: rand2(seed, wx, wz, TILE_SALT.PROP_TINT),
        };
      } else {
        yield { kind, x, y, z, scale, rot: -fixed, stretch: 1, lean: 0.5, tint: 0.5 };
      }
    }
  }
}
