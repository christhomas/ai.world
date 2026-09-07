/**
 * The drawn controls.
 *
 * The buttons a thumb can always see used to be typed characters: 🗺 🎒 📖 and 🏹 arrived as full
 * colour pictures from the system's emoji font, while ⚙ ↺ ↻ ⋯ ✕ ⚔ 🛡 arrived as thin white
 * strokes, because those codepoints have no colour form. Two families of picture, at two weights,
 * in two colours, sitting in one row — which is why the row never read as one set of controls
 * however carefully it was laid out. No filter fixes that: the difference is weight and detail,
 * not hue.
 *
 * So they are drawn here instead. One grid, one stroke, one colour, taken from whatever the button
 * is set in — which means they light up with the button, and they are as crisp on a 4K screen as
 * on a phone, which a font's emoji bitmap is not.
 *
 * The extra-controls shelf keeps its emoji. Every row there carries its own words beside the
 * picture, so the picture is decoration rather than the label, and twelve more drawings would be
 * twelve more things to keep in step for no gain.
 */

/** Everything is drawn on this grid, stroked, never filled unless the shape is a dot. */
const BOX = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const svg = (body: string): string => `<svg ${BOX}>${body}</svg>`;

export const ICONS = {
  /** A folded map, seen from above: three panels, two creases. */
  map: svg('<path d="M3 6.5 9 3.5l6 3 6-3v14l-6 3-6-3-6 3z"/><path d="M9 3.5v14M15 6.5v14"/>'),
  /**
   * A pack: body, grab handle, the flap across it and its buckle. The handle is narrow on purpose —
   * drawn as a wide arc across the whole top it came out as the shackle of a padlock.
   */
  pack: svg('<rect x="4.5" y="7" width="15" height="14" rx="3.5"/><path d="M10 7V5.6a2 2 0 0 1 4 0V7"/><path d="M4.5 13h15"/><path d="M10.5 17h3"/>'),
  /** A book held open, with the spine down the middle. */
  book: svg('<path d="M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-13c-3.5 0-6 .5-8 2z"/><path d="M12 6.5v13"/>'),
  /**
   * Three sliders rather than a cog. What is behind this button is a panel of sliders, so a picture
   * of sliders says where it goes; a cog only says "settings", which is a word for everything.
   */
  sliders: svg('<path d="M3 6h11M18 6h3M3 12h4M11 12h10M3 18h13M20 18h1"/><circle cx="16" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="18" cy="18" r="2" fill="currentColor" stroke="none"/>'),
  /**
   * The camera swinging: an arc over the top with the head on the end it is travelling toward. It
   * was a near-complete circle with a tick beside it, and the tick was not where the circle ended,
   * so it read as a letter C that something had happened to.
   */
  turnLeft: svg('<path d="M20 14A8 8 0 0 0 4 14"/><path d="M1.5 11.5 4 14l2.5-2.5"/>'),
  turnRight: svg('<path d="M4 14A8 8 0 0 1 20 14"/><path d="M17.5 11.5 20 14l2.5-2.5"/>'),
  /** The rest of the keyboard, behind one button. */
  more: svg('<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"/>'),
  /** The way out of whatever is open. */
  close: svg('<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>'),
  /**
   * A sword, point up and to the right. The blade is filled rather than stroked: at this size a
   * one-line blade and a one-line grip are the same mark, and the thing read as a diagonal scratch
   * with a bead on the end of it.
   */
  sword: svg('<path d="M20.8 3.2 13.1 14.1 9.9 10.9z" fill="currentColor" stroke="none"/><path d="M8.5 10.7 13.4 15.5"/><path d="M10.9 13.1 8.8 15.2"/><circle cx="7.7" cy="16.3" r="1.4"/>'),
  /** A shield, raised. */
  shield: svg('<path d="M12 3.2 19.5 6v6c0 4.6-3.2 7.9-7.5 8.9C7.7 19.9 4.5 16.6 4.5 12V6z"/>'),
  /**
   * A bow drawn: the limb bent hard, the string straight down the back of it, the arrow nocked on
   * it. Two things had to be true before it read as a bow rather than as an arrow inside a bracket:
   * the limb needs a small radius, or it lies along its own string; and the string has to be drawn
   * thinner than the limb, or the two are the same mark and the pair is a leaf shape.
   */
  bow: svg('<path d="M8 3a9.5 9.5 0 0 1 0 18"/><path d="M8 3v18" stroke-width="1"/><path d="M6.5 12h12"/><path d="m14.5 8.5 4 3.5-4 3.5"/>'),
} as const;

export type IconName = keyof typeof ICONS;
