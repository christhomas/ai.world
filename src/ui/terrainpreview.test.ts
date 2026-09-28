import { describe, expect, it } from 'vitest';
import { terrainPreview } from './terrainpreview';

describe('new-world terrain preview', () => {
  it('samples the same seed and ordered layers deterministically', () => {
    const land = { kind: 'land' as const, x: 256, z: 256, reach: 220, seed: 9 };
    const sea = { kind: 'sea' as const, x: 256, z: 256, reach: 220, seed: 9 };
    const first = terrainPreview(17, [land], 256, 256, 16);
    expect(terrainPreview(17, [land], 256, 256, 16)).toEqual(first);
    expect(terrainPreview(17, [land, sea], 256, 256, 16)).not.toEqual(first);
  });
});
