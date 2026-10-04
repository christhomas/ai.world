import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserFrameHost } from './browser-frame';

afterEach(() => vi.unstubAllGlobals());

describe('browser frame presentation', () => {
  it('uses CSS surface bounds and preserves quality and fishing presentation', () => {
    const setItem = vi.fn(); vi.stubGlobal('localStorage', { setItem });
    let rect = { left: 10, top: 20, width: 800, height: 400 };
    const canvas = { getBoundingClientRect: () => rect } as HTMLCanvasElement;
    const castbar = { className: '', textContent: '' } as HTMLElement;
    const flash = vi.fn(), host = createBrowserFrameHost(canvas, castbar, flash);
    expect(host.viewport()).toEqual(rect);
    rect = { left: 40, top: 60, width: 400, height: 200 };
    expect(host.viewport()).toEqual(rect);
    host.qualityReduced('medium');
    expect(setItem).toHaveBeenCalledWith('ai.world/quality-auto', '1');
    expect(flash).toHaveBeenCalledWith('Graphics turned down to keep up: Medium — shadows, some sharpening');
    host.fishingChanged('waiting', true);
    expect(castbar.className).toBe('show');
    expect(castbar.textContent).toContain('rain');
    host.fishingChanged('bite', false);
    expect(castbar.className).toBe('show bite');
    expect(castbar.textContent).toBe('A bite! Press Enter!');
    host.fishingChanged('idle', false);
    expect(castbar.className).toBe('');
  });
});
