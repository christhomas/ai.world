import { BIOMES } from '../world/biomes';
import { Patchwork } from '../world/patchwork';
import type { TerrainLayer } from '../world/terrainlayers';

export const PREVIEW_SIZE = 96;
export const PREVIEW_SPAN = 512;

/** Sample the actual patch generator used by the page and server. No saved world is changed. */
export function terrainPreview(
  seed: number, layers: readonly TerrainLayer[], centreX: number, centreZ: number,
  size = PREVIEW_SIZE,
): Uint8ClampedArray {
  const patches = new Patchwork(seed, undefined, undefined, [], layers);
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = centreX + (x + 0.5 - size / 2) * PREVIEW_SPAN / size;
    const wz = centreZ + (y + 0.5 - size / 2) * PREVIEW_SPAN / size;
    const ground = patches.at(wx, wz).probe(wx, wz);
    const colour = ground.land ? BIOMES[ground.biome].ground : 0x1b4466;
    const at = (y * size + x) * 4;
    pixels[at] = colour >> 16 & 255;
    pixels[at + 1] = colour >> 8 & 255;
    pixels[at + 2] = colour & 255;
    pixels[at + 3] = 255;
  }
  return pixels;
}
