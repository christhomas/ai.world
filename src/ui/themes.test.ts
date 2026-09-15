import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, installThemePicker, themeChosen, wearTheme } from './themes';

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

  it('offers every theme, wears the remembered one at boot, and remembers a later choice', () => {
    const remembered = new Map<string, string>([['ai.world/theme', 'steel']]);
    const before = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => remembered.get(key) ?? null,
        setItem: (key: string, value: string) => { remembered.set(key, value); },
      },
    });

    const options: Array<{ value: string; textContent: string }> = [];
    let changed = (): void => {};
    const picker = {
      value: '',
      ownerDocument: { createElement: () => ({ value: '', textContent: '' }) },
      replaceChildren: (...offered: Array<{ value: string; textContent: string }>) => {
        options.push(...offered);
      },
      addEventListener: (_event: string, listener: () => void) => { changed = listener; },
    } as unknown as HTMLSelectElement;
    const note = { textContent: '' } as HTMLElement;
    const worn: Record<string, string> = {};
    const root = {
      setAttribute: (key: string, value: string) => { worn[key] = value; },
    } as unknown as HTMLElement;

    try {
      installThemePicker(picker, note, root);
      expect(options).toEqual(THEMES.map(({ id, name }) => ({ value: id, textContent: name })));
      expect(picker.value).toBe('steel');
      expect(note.textContent).toBe(THEMES.find(({ id }) => id === 'steel')!.note);
      expect(worn['data-theme']).toBe('steel');

      picker.value = 'vellum';
      changed();
      expect(note.textContent).toBe(THEMES.find(({ id }) => id === 'vellum')!.note);
      expect(worn['data-theme']).toBe('vellum');
      expect(remembered.get('ai.world/theme')).toBe('vellum');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: before });
    }
  });
});

/**
 * Every colour name CSS knows, which is the half the first guard could not see.
 *
 * It looked for `#abc`, `rgb(` and their relatives — every way of *writing* a colour and no way of
 * *naming* one. So `color: white` walked straight past it, and so did `color-mix(in srgb, red 50%,
 * transparent)`, which is the one that matters: a named colour nested in a function is exactly how
 * somebody adds one without thinking they have.
 *
 * Listed rather than pattern-matched, because there is no pattern — they are a hundred and forty
 * words in a specification. `transparent` and `currentColor` are deliberately absent: the first is
 * the absence of a colour rather than one, and the second is whatever the theme already decided.
 */
const NAMED_COLOURS = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen',
] as const;

describe('the interface underneath', () => {
  /** The stylesheet with the four theme blocks and every comment taken out of it. */
  const interfaceOnly = (): string => THEMES.reduce(
    (css, { id }) => css.replace(new RegExp(`(?:\\:root)?\\[data-theme='${id}'\\]\\s*\\{[^}]*\\}`, 's'), ''),
    CSS,
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('routes every written colour through the five theme variables', () => {
    expect(interfaceOnly()).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\s*\(/i);
    expect(interfaceOnly()).not.toMatch(/var\(--theme-/);
  });

  /*
   * And every *named* one, wherever it is written — including inside a colour function, which is
   * where one would actually end up.
   */
  /**
   * Whether this name appears as a colour rather than as part of a longer word.
   *
   * `\\b` is not enough and the guard said so on its first run: a hyphen is a word boundary, so
   * `white-space: nowrap` reads as the colour white. A CSS identifier runs through hyphens, so the
   * name has to have neither a letter, a digit nor a hyphen on either side of it.
   */
  const namesAColour = (colour: string, css: string): boolean =>
    new RegExp(`(?<![\\w-])${colour}(?![\\w-])`, 'i').test(css);

  it('routes every named colour through them too', () => {
    const css = interfaceOnly();
    const named = NAMED_COLOURS.filter((colour) => namesAColour(colour, css));
    expect(named, 'a named colour is a colour the theme cannot change').toEqual([]);
  });

  /*
   * The guard catching what it is for, checked against itself. A guard nobody has watched fail is
   * a guard nobody knows the shape of.
   */
  it('catches a named colour nested in a colour function, which is how one gets in', () => {
    const sneaked = '.x { color: color-mix(in srgb, white 50%, transparent); }';
    expect(NAMED_COLOURS.filter((colour) => namesAColour(colour, sneaked))).toContain('white');
  });

  it('lets the two that are not colours through', () => {
    const fine = '.x { color: currentColor; background: transparent; }';
    expect(NAMED_COLOURS.filter((c) => namesAColour(c, fine))).toEqual([]);
  });

  /* And the word that caught the guard out on its first run. */
  it('does not read a property name as a colour', () => {
    const fine = '.x { white-space: nowrap; overflow: hidden; }';
    expect(NAMED_COLOURS.filter((c) => namesAColour(c, fine)),
      'a hyphen is a word boundary, so white-space read as white').toEqual([]);
  });
});
