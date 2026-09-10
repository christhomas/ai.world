import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The page can be installed to a home screen, and still be an ordinary web page.
 *
 * There is one platform this is for. Every desktop browser and Android Chrome will hand the page
 * the whole screen when it asks — `ui/sideways.ts` asks, there is a Full screen button in the
 * settings panel, and F11 does the same thing without any of our code. iPhone Safari refuses the
 * Fullscreen API to anything that is not a video, so on an iPhone the only way to play without an
 * address bar over the sky is to add the page to the home screen.
 *
 * A manifest is exactly the kind of thing that breaks without saying so: it is read by the browser
 * rather than by the game, a wrong path in it fails silently, and nobody finds out until somebody
 * installs it and gets a white page. The two things that would break it here are both checked
 * below and both are about the same fact — this game is served from a subdirectory, `/ai.world/`,
 * and everything inside the manifest has to be relative or it will point at the root of the host
 * instead. Vite rewrites the `href`s in `index.html` and does *not* rewrite anything inside a file
 * copied from `public/`, which is the trap.
 */

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
  start_url: string; scope: string; display: string; orientation: string;
  icons: Array<{ src: string; sizes: string; type: string }>;
};
const html = readFileSync('index.html', 'utf8');

describe('the manifest', () => {
  it('points at everything with a relative path, because the game is served from a subdirectory', () => {
    for (const path of [manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)]) {
      expect(path.startsWith('./'), `${path} is not relative, so under /ai.world/ it points at the wrong host root`).toBe(true);
    }
  });

  it('names icons that are actually there', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(`public/${icon.src.slice(2)}`), `${icon.src} is in the manifest and not in public/`).toBe(true);
    }
  });

  it('asks for the screen and for landscape, which is the whole point of installing it', () => {
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('landscape');
  });
});

describe('the page that offers it', () => {
  it('links the manifest and the icon iOS actually reads', () => {
    expect(html).toContain('rel="manifest"');
    // iOS ignores the manifest's icons and reads this one, and will not take an SVG
    expect(html).toMatch(/rel="apple-touch-icon" href="[^"]+\.png"/);
    expect(existsSync('public/apple-touch-icon.png')).toBe(true);
  });

  it('tells iOS to launch it without browser furniture', () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    // black-translucent is what lets the sky run up behind the clock instead of under a white bar,
    // and it only works because the viewport carries viewport-fit=cover
    expect(html).toContain('content="black-translucent"');
    expect(html).toContain('viewport-fit=cover');
  });
});
