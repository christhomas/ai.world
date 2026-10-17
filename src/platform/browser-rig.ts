import type { RigHost } from '../render/scene';
import { presenterFor } from '../render/secondrig';

/** The page: the game container, the window, and the quality kept in local storage. */
export function pageRigHost(container: HTMLElement): RigHost {
  return {
    container,
    canvas: () => document.createElement('canvas'),
    // the page's address does not change under a running game, so it is read once and not per draw
    recordOnly: new URLSearchParams(location.search).has('record-only'),
    size: () => ({ width: window.innerWidth, height: window.innerHeight }),
    pixelRatio: () => window.devicePixelRatio,
    remembered() {
      try {
        const saved = localStorage.getItem('ai.world/quality');
        if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
      } catch { /* private browsing: the default will do */ }
      return null;
    },
    remember(level) {
      try { localStorage.setItem('ai.world/quality', level); } catch { /* nothing to do */ }
    },
    presenter: presenterFor,
  };
}
