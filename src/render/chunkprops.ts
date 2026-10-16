import type { PropKind } from '../world/biomes';
import type { PropInstance } from './instancing';

/** The production worker's nine scalars per prop, decoded without changing their placement. */
export function* readPropStream(data: Float32Array): Generator<PropInstance> {
  for (let i = 0; i < data.length; i += 9) {
    yield {
      kind: data[i] as PropKind, x: data[i + 1], y: data[i + 2], z: data[i + 3],
      rot: data[i + 4], scale: data[i + 5], stretch: data[i + 6], lean: data[i + 7], tint: data[i + 8],
    };
  }
}
