import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, themeChosen, wearTheme } from './themes';

/**
 * Four themes over one unchanged layout.
 *
 * The claim worth testing is not that the colours are right — nobody can test that — but the
 * property that makes a theme cheap: a theme may change only surface, rule, ink, accent and face, so
 * position, size, spacing and every hit target are identical across all four. **A new theme cannot
 * break a screen and needs no re-test.** The moment one is allowed to move something, four themes
 * become four interfaces to check, and this is the test that says so out loud.
 */
const CSS = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const THEME_TOKENS = ['--accent', '--face', '--ink', '--rule', '--surface'];

/** Everything a theme block declares, by theme. */
function tokensOf(theme: string): string[] {
  const block = CSS.match(new RegExp(`\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`, 's'));
  expect(block, `there is no ${theme} theme`).not.toBeNull();
  return [...block![1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort();
}

describe('what a theme is allowed to change', () => {
  it('sets only surface, rule, ink, accent and face', () => {
    for (const { id } of THEMES) {
      expect(tokensOf(id), `${id} changes more than the five parts of a theme`).toEqual(THEME_TOKENS);
    }
  });


  it('has all four of them, named the way the picker will name them', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(['stone', 'vellum', 'steel', 'hairline']);
  });

  it('dresses the interface through one attribute, so everything changes at once', () => {
    const root = { setAttribute: (k: string, v: string) => { seen[k] = v; } } as unknown as HTMLElement;
    const seen: Record<string, string> = {};
    wearTheme('steel', root);
    expect(seen['data-theme']).toBe('steel');
  });

  it('opens in the default for anybody whose choice this build has never heard of', () => {
    // a theme name left in storage by a build that offered one this one does not is a person whose
    // interface should still open
    expect(themeChosen()).toBe(DEFAULT_THEME);
  });
});

describe('the interface underneath', () => {
  it('routes every colour through the five theme variables', () => {
    const interfaceCss = THEMES.reduce(
      (css, { id }) => css.replace(new RegExp(`(?:\\:root)?\\[data-theme='${id}'\\]\\s*\\{[^}]*\\}`, 's'), ''),
      CSS,
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(interfaceCss).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\s*\(/i);
    expect(interfaceCss).not.toMatch(/var\(--theme-/);
  });
});
