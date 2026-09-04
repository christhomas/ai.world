import { Surface } from './surface';
import { textWidth } from './font';

/**
 * Putting versions of the same artwork beside each other.
 *
 * The comparison is the product here, not the pictures. So the panels are the same size whatever
 * they contain, they are separated by a rule rather than by empty space, and each is labelled
 * above rather than below, because when you glance at two things you want to know which is which
 * before you have finished looking.
 */

const SHEET = {
  BACKGROUND: '#171d3f',
  RULE: '#46538f',
  LABEL: '#ffd76a',
  QUIET: '#8f9ac8',
  PAD: 10,
  HEADER: 16,
  /** How big the labels are drawn. Two is legible at a glance without shouting. */
  LABEL_SCALE: 2,
} as const;

export interface Panel {
  label: string;
  /** A word under the label: what it is, or what changed. */
  note?: string;
  art: Surface;
}

/** Lay panels out in a row, labelled, with a rule between them. */
export function compare(panels: Panel[]): Surface {
  const width = Math.max(...panels.map((p) => p.art.width));
  const height = Math.max(...panels.map((p) => p.art.height));
  const noted = panels.some((p) => p.note);
  const header = SHEET.HEADER + (noted ? 8 : 0);

  const sheet = new Surface(
    panels.length * (width + SHEET.PAD * 2) + (panels.length - 1),
    height + header + SHEET.PAD,
    SHEET.BACKGROUND,
  );

  panels.forEach((panel, at) => {
    const left = at * (width + SHEET.PAD * 2 + 1);
    const middle = left + SHEET.PAD + width / 2;

    sheet.centredText(panel.label, middle, SHEET.PAD - 4, SHEET.LABEL, SHEET.LABEL_SCALE);
    if (panel.note) sheet.centredText(panel.note, middle, SHEET.PAD + 8, SHEET.QUIET, 1);
    sheet.blit(panel.art, left + SHEET.PAD + Math.round((width - panel.art.width) / 2), header);

    // a rule between panels, so the eye knows where one stops
    if (at > 0) sheet.fill(left - 1, 4, 1, sheet.height - 8, SHEET.RULE);
  });
  return sheet;
}

/** How wide the label would be, for callers that want to line terminal text up with a panel. */
export const labelWidth = (text: string): number => textWidth(text, SHEET.LABEL_SCALE);
