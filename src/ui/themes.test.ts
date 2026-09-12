import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, themeChosen, wearTheme } from './themes';

/**
 * Four themes over one unchanged layout.
 *
 * The claim worth testing is not that the colours are right — nobody can test that — but the
 * property that makes a theme cheap: a theme may change only five things and a pair of faces, so
 * position, size, spacing and every hit target are identical across all four. **A new theme cannot
 * break a screen and needs no re-test.** The moment one is allowed to move something, four themes
 * become four interfaces to check, and this is the test that says so out loud.
 */
const CSS = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

/** Everything a theme block declares, by theme. */
function tokensOf(theme: string): string[] {
  const block = CSS.match(new RegExp(`\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`, 's'));
  expect(block, `there is no ${theme} theme`).not.toBeNull();
  return [...block![1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort();
}

describe('what a theme is allowed to change', () => {
  it('declares the same tokens in every theme, and nothing else', () => {
    const stone = tokensOf('stone');
    for (const { id } of THEMES.slice(1)) {
      expect(tokensOf(id), `${id} declares a different set of tokens from stone`).toEqual(stone);
    }
  });

  it('changes only colour and face — never a position, a size or a hit target', () => {
    // the property in one assertion: if a theme block ever declares a length, a theme has become a
    // layout and every screen needs testing four times
    for (const { id } of THEMES) {
      const block = CSS.match(new RegExp(`\\[data-theme='${id}'\\]\\s*\\{([^}]*)\\}`, 's'))![1];
      expect(block, `${id} sets a length, so it is a layout rather than a theme`)
        .not.toMatch(/:\s*[^;]*\b\d+(px|rem|em|vh|vw)\b/);
    }
  });

  it('has all four of them, named the way the picker will name them', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(['stone', 'vellum', 'steel', 'hairline']);
    for (const theme of THEMES) expect(theme.note.length).toBeGreaterThan(20);
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
  it('reads its controls off the theme rather than off four copies of a colour', () => {
    for (const token of ['--ui-glass', '--ui-rim', '--ui-ink']) {
      const rule = CSS.match(new RegExp(`${token}:\\s*([^;]+);`))![1];
      expect(rule, `${token} is a colour of its own rather than the theme's`).toContain('var(--theme-');
    }
  });
});
