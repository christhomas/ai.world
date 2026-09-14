/**
 * Which of the four the interface is dressed in.
 *
 * A theme may change only five things — surface, rule, ink, accent and face. Position, size, spacing
 * and every hit target are identical across all four, and
 * that is the property rather than a preference: *a new theme cannot break a screen and needs no
 * re-test.* The moment a theme is allowed to move something, four themes become four interfaces.
 *
 * The tokens themselves live in `style.css`, because that is what a browser reads. What lives here
 * is only the remembering: which one was chosen, and putting it on the root element so the tokens
 * change under everything at once.
 */

export type Theme = 'stone' | 'vellum' | 'steel' | 'hairline';

/** The four, in the order the picker lists them, with what each is for. */
export const THEMES: ReadonlyArray<{ id: Theme; name: string; note: string }> = [
  {
    id: 'stone',
    name: 'Stone',
    note: 'Dark glass. The one that reads over a sunlit field and a cave floor, which is why it is the default.',
  },
  { id: 'vellum', name: 'Vellum', note: 'Paper and ink, for reading in daylight rather than playing in the dark.' },
  { id: 'steel', name: 'Steel', note: 'Cold and instrumental: the readings first and the country second.' },
  { id: 'hairline', name: 'Hairline', note: 'Almost nothing — a hairline and white ink, for somebody who wants the picture.' },
];

export const DEFAULT_THEME: Theme = 'stone';

/** Where the choice is remembered between visits. A theme is a preference, not part of a save. */
const KEY = 'ai.world/theme';

const known = (asked: string | null): Theme | null =>
  THEMES.some((theme) => theme.id === asked) ? asked as Theme : null;

/**
 * The theme this browser is set to.
 *
 * Anything unrecognised reads as the default rather than as an error: a theme name in storage from
 * a build that offered one this one does not is a person whose interface should still open.
 */
export function themeChosen(): Theme {
  try {
    return known(localStorage.getItem(KEY)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;                       // private browsing: the default will do
  }
}

/**
 * Dress the interface, and remember it.
 *
 * The default is written as an attribute like any other rather than by removing it, so that what
 * the root says and what the person chose are the same thing — a picker that has to special-case
 * its own default is a picker with two ways of saying one thing.
 */
export function wearTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
  try { localStorage.setItem(KEY, theme); } catch { /* nothing to do */ }
}

/**
 * Put the themes this build actually has into its picker, and make the picker the one way to wear
 * one. The caller does this during boot, before the title screen is shown, so a remembered choice
 * dresses the first frame rather than arriving only after a world has been opened.
 */
export function installThemePicker(
  picker: HTMLSelectElement,
  note: HTMLElement,
  root: HTMLElement = document.documentElement,
): void {
  const choose = (theme: Theme): void => {
    picker.value = theme;
    note.textContent = THEMES.find(({ id }) => id === theme)!.note;
    wearTheme(theme, root);
  };
  const options = THEMES.map(({ id, name }) => {
    const option = picker.ownerDocument.createElement('option');
    option.value = id;
    option.textContent = name;
    return option;
  });
  picker.replaceChildren(...options);
  choose(themeChosen());
  picker.addEventListener('change', () => choose(known(picker.value) ?? DEFAULT_THEME));
}
