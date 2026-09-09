import { WORLD } from '../core/config';

/**
 * The world cut into provinces: the unit of keeping, loading and forgetting.
 *
 * A world with an edge can be one file and one simulation. A world without one cannot: the state a
 * player leaves behind — a field sown, a chest opened, a village that remembers being robbed — grows
 * with every place anybody has ever been, and no machine holds all of it at once. So the world is
 * cut into squares, and a square is what gets loaded when somebody walks into it and written down
 * when the last of them leaves.
 *
 * It is deliberately *not* the unit the country is generated in. Generation is settled by a bounded
 * neighbourhood and cares nothing for these lines — a face, a road or a town may lie across one, and
 * both provinces work out the same face because neither is asked to. Provinces are for the state
 * that cannot be derived: what has been changed, what has been remembered, who has died. Confusing
 * the two is how a world grows seams, so they are separate here by construction and the tests below
 * say so.
 *
 * The size is a compromise with only two ends. Small provinces mean more files, more loading and
 * more flushing as somebody walks; large ones mean carrying country nobody is near. Five hundred and
 * twelve tiles is thirty-two chunks square — about a minute and a half of walking end to end, which
 * is long enough that arriving somewhere new is rare and short enough that a province is a few
 * kilobytes of anybody's leavings.
 */

/** How wide a province is, in tiles. A power of two, so the arithmetic is a shift and never a rounding. */
export const PROVINCE = 512;

/** A province's name: the two numbers it is made of, which is all anybody needs to find it again. */
export type ProvinceId = string;

/** Which province a place is in. Negative country included, which `Math.floor` gets right and `|0` does not. */
export function provinceOf(x: number, z: number): ProvinceId {
  return `${Math.floor(x / PROVINCE)}:${Math.floor(z / PROVINCE)}`;
}

/** The two numbers back out of the name. */
export function provinceAt(id: ProvinceId): { px: number; pz: number } {
  const [px, pz] = id.split(':').map(Number);
  return { px, pz };
}

/** The corner a province begins at, in tiles. */
export function provinceCorner(id: ProvinceId): { x: number; z: number } {
  const { px, pz } = provinceAt(id);
  return { x: px * PROVINCE, z: pz * PROVINCE };
}

/**
 * Every province within reach of a place, including the one it is in.
 *
 * `reach` is in tiles, and it is what decides how far in front of a player state is made ready. A
 * province is loaded before it is needed rather than as it is entered, because loading a file is a
 * thing that can be waited for and walking over a line is not.
 */
export function provincesNear(x: number, z: number, reach: number): ProvinceId[] {
  const lowX = Math.floor((x - reach) / PROVINCE), highX = Math.floor((x + reach) / PROVINCE);
  const lowZ = Math.floor((z - reach) / PROVINCE), highZ = Math.floor((z + reach) / PROVINCE);
  const out: ProvinceId[] = [];
  for (let pz = lowZ; pz <= highZ; pz++) {
    for (let px = lowX; px <= highX; px++) out.push(`${px}:${pz}`);
  }
  return out;
}

/**
 * How far ahead of somebody the state is kept ready, in tiles.
 *
 * A chunk's worth beyond the ground they can see. The ground is streamed at a radius of its own and
 * this is deliberately wider: arriving in a province whose leavings have not been read yet would
 * mean a field that is sown looking bare for a moment, which is the kind of flicker a player
 * remembers.
 */
export const KEEP_READY = WORLD.CHUNK_SIZE * (WORLD.UNLOAD_RADIUS + 2);

/** Where a province's leavings are written. One file each, named as the province is. */
export function provincePath(dataDir: string, seed: number, id: ProvinceId): string {
  const { px, pz } = provinceAt(id);
  const stem = `${seed}/${px}_${pz}.json`;
  return dataDir ? `${dataDir}/${stem}` : stem;
}
