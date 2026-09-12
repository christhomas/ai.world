import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Reserved geometry: the named bands that own each edge of the glass.
 *
 * The part of the Ledger II handoff worth having before any of the drawing, and it says why in one
 * line: *"this is the part today's UI lacks, and the reason its panels overlap."* That is not a
 * guess about this interface. It is a description of two bugs found by looking at a screenshot —
 * a status slab capped at the width of a ten-block meter when the meter had grown to twenty, and a
 * pack pinned a fixed distance below a corner map that had grown.
 *
 * Both are one fault: a panel sized or placed against *another panel*. A panel placed against a
 * band cannot have it, because a band is a fact about the screen rather than about whatever is
 * drawn in the corner this week.
 *
 * These tests read the stylesheet as text, which is a blunt instrument and the right one here:
 * what is being protected is that the bands exist, are in HUD units, and that the two rules the
 * bugs were in do not go back to measuring themselves against their neighbours.
 */
const CSS = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

const band = (name: string): string => {
  const found = CSS.match(new RegExp(`--band-${name}:\\s*([^;]+);`));
  expect(found, `there is no --band-${name}`).not.toBeNull();
  return found![1].trim();
};

describe('the bands that own the edges', () => {
  it('names one for each edge the handoff reserves', () => {
    for (const edge of ['tabs', 'left', 'action', 'book', 'thumb']) {
      expect(band(edge).length).toBeGreaterThan(0);
    }
  });

  it('measures every one of them in HUD units, so they keep their share of the picture', () => {
    // a band in CSS pixels is a band that is right on one window and a postage stamp on another,
    // which is the whole reason `--ui-scale` exists
    for (const edge of ['tabs', 'left', 'action', 'book', 'thumb']) {
      expect(band(edge), `--band-${edge} is in pixels`).toContain('var(--ui-scale)');
    }
  });

  it('keeps the book wider than the tab spine it arrives behind', () => {
    // 44 of spine and 328 of page: a book narrower than its own spine would be a page nobody can
    // read, and the two numbers are related rather than independent
    const width = (edge: string) => Number(band(edge).match(/calc\((\d+)/)![1]);
    expect(width('book')).toBeGreaterThan(width('tabs'));
    expect(width('book') - width('tabs')).toBe(328);
  });

  it('lets the thumb into the tab gutter, because the tabs stop above it', () => {
    // the one deliberate overlap in the whole scheme, and it is deliberate: a walk ring that
    // cleared the tabs would sit where no thumb reaches, which is worse than an overlap nobody
    // can trigger
    expect(band('thumb')).toContain('124');
  });
});

describe('the two rules the bugs were in', () => {
  it('does not cap the status slab at the width of whatever is drawn in it', () => {
    // it was 96 for a ten-block meter, then 176 for a twenty-block one. Both are the same fault
    const rule = CSS.match(/#status \{[^}]*\}/s)?.[0] ?? '';
    expect(rule, 'the status slab is capped at a fixed width again').not.toMatch(/max-width:\s*\d+px/);
  });

  it('adds the safe-area insets outside the bands rather than folding them in', () => {
    // a gap kept for taste is waste; a gap kept for an obstruction is a gap. Folding the notch into
    // a band would make every phone's layout a different layout
    for (const inset of ['top', 'left', 'right', 'bottom']) {
      expect(CSS).toContain(`--safe-${inset}: env(safe-area-inset-${inset}`);
    }
  });
});
