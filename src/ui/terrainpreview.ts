import { BIOMES } from '../world/biomes';
import { Patchwork } from '../world/patchwork';
import type { TerrainLayer } from '../world/terrainlayers';
import type { Highland } from '../world/highland';

export const PREVIEW_SIZE = 96;
export const PREVIEW_SPAN = 512;

/** Sample the actual patch generator used by the page and server. No saved world is changed. */
export function terrainPreview(
  seed: number, layers: readonly TerrainLayer[], centreX: number, centreZ: number,
  size = PREVIEW_SIZE, highlands: readonly Highland[] = [],
): Uint8ClampedArray {
  const patches = new Patchwork(seed, undefined, undefined, highlands, layers);
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = centreX + (x + 0.5 - size / 2) * PREVIEW_SPAN / size;
    const wz = centreZ + (y + 0.5 - size / 2) * PREVIEW_SPAN / size;
    const patch = patches.at(wx, wz);
    const ground = patch.probe(wx, wz);
    const colour = ground.land ? BIOMES[ground.biome].ground : 0x1b4466;
    const sample = patch.newSample();
    patch.sampleTile(Math.floor(wx), Math.floor(wz), sample);
    const shade = ground.land ? Math.max(0.55, Math.min(1.55, 0.8 + sample.height / 42)) : 1;
    const at = (y * size + x) * 4;
    pixels[at] = Math.min(255, (colour >> 16 & 255) * shade);
    pixels[at + 1] = Math.min(255, (colour >> 8 & 255) * shade);
    pixels[at + 2] = Math.min(255, (colour & 255) * shade);
    pixels[at + 3] = 255;
  }
  return pixels;
}
