import type { FrameHost } from '../game/frame-host';
import { rememberAutoChoice } from '../render/autoquality';
import { QUALITY } from '../render/scene';

/** Browser storage, CSS and text stay at the edge of the shared frame. */
export function createBrowserFrameHost(
  canvas: HTMLCanvasElement, castbar: HTMLElement, flash: (message: string) => void,
): FrameHost {
  return {
    viewport: () => {
      const { left, top, width, height } = canvas.getBoundingClientRect();
      return { left, top, width, height };
    },
    qualityReduced: (level) => {
      rememberAutoChoice();
      flash(`Graphics turned down to keep up: ${QUALITY[level].label}`);
    },
    fishingChanged: (phase, raining) => {
      castbar.className = phase === 'bite' ? 'show bite' : phase === 'waiting' ? 'show' : '';
      if (phase !== 'idle') {
        castbar.textContent = phase === 'bite' ? 'A bite! Press Enter!'
          : raining ? 'Fishing in the rain… they are rising' : 'Fishing… wait for the bite';
      }
    },
  };
}
