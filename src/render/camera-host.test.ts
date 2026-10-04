import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameInput } from '../core/game-input';
import { IsoCamera, nativeCamera, zoomBand } from './camera';

afterEach(() => vi.unstubAllGlobals());

describe('camera host viewport', () => {
  it('uses the phone viewport for zoom and both projections without window or document', () => {
    vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined);
    let size = { width: 750, height: 342 };
    const iso = new IsoCamera(() => size), input = new GameInput();
    expect(iso.zoom).toBe(zoomBand(342).start);
    const projection = [...iso.frameCamera().projection];
    input.hold('e'); input.wheelDelta = -100;
    iso.update(input, 0.1);
    expect(iso.rotation).toBeGreaterThan(Math.PI / 4);
    expect(iso.zoom).toBeLessThan(zoomBand(342).start);
    expect(iso.frameCamera().projection).not.toEqual(projection);
    size = { width: 1100, height: 500 };
    iso.resize();
    iso.frameCamera().projection.forEach((n, i) => expect(n).toBeCloseTo(nativeCamera(iso).projectionMatrix.elements[i], 10));
    const ready = [...iso.frameCamera().projection];
    size = { width: 0, height: NaN };
    iso.resize();
    expect(iso.frameCamera().projection).toEqual(ready);
  });
});
