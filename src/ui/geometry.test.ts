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

/** What a selector declares, or nothing at all where it has no rule. See the row guard. */
const sizing = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
};

const declarations = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  expect(found, `there is no ${selector} rule`).not.toBeNull();
  return found![1];
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

describe('the row shared by every decision list', () => {
  it('is exactly 44 HUD units and cannot be squeezed shorter in a flex list', () => {
    const size = CSS.match(/--list-row:\s*([^;]+);/)?.[1].trim();
    expect(size, 'there is no shared list row size').toBe('calc(44 * var(--ui-scale))');
    expect(declarations('.list-row')).toContain('height: var(--list-row)');
    expect(declarations('.list-row')).toContain('flex: 0 0 var(--list-row)');
  });

  it('keeps list-specific rules from sizing their own rows', () => {
    /*
     * Every way of setting the height of a row, including the logical spellings.
     *
     * `min-block-size` is `min-height` written the other way round and does exactly the same thing,
     * so a guard that knows one and not the other is a guard somebody walks past without meaning
     * to. Same for the block-axis padding, which adds to a row's height as surely as the physical
     * kind does.
     */
    const verticalSize = new RegExp('(?:^|;)\\s*(?:'
      + 'block-size|min-block-size|max-block-size'
      + '|height|min-height|max-height'
      + '|padding|padding-block|padding-block-start|padding-block-end|padding-top|padding-bottom'
      + '|flex|flex-basis'
      + ')\\s*:');
    const rows = [
      /*
       * `.ro-table tr` and not `td`: `roster.ts` puts `list-row` on the row itself, so a height set
       * on the `tr` would have sized the row and walked straight past a guard watching the cell.
       */
      '#dialogue .dlg-choice', '#journal li', '#players li', '.ro-table tr', '.ro-table td',
      '#rucksack .r-item', '#optionsPanel .opt-row',
    ];
    /*
     * A selector with no rule at all passes, and that is the point of listing it: `.ro-table tr`
     * has nothing of its own today, and this is here so that the day somebody gives it a height
     * the guard is already watching. Asking `declarations` would fail on the absence instead.
     */
    for (const selector of rows) {
      expect(sizing(selector), `${selector} sizes itself instead of using .list-row`)
        .not.toMatch(verticalSize);
    }
  });

  it('keeps one scrolling rule and reserves room beside every row for its scrollbar', () => {
    const scroll = declarations('.list-scroll');
    expect(scroll).toContain('overflow-y: auto');
    expect(scroll).toContain('min-height: 0');
    expect(scroll).toContain('scrollbar-gutter: stable');
  });

  it('gives a switch explanation the wide column instead of the narrow value gutter', () => {
    const switched = declarations('#optionsPanel .opt-row:has(input[type="checkbox"])');
    expect(switched).toContain('calc(20 * var(--ui-scale)) 1fr');
    expect(declarations('#optionsPanel .opt-hint')).toContain('grid-column: 3');
  });
});

describe('the two rules the bugs were in', () => {
  it('does not cap the status slab at the width of whatever is drawn in it', () => {
    // it was 96 for a ten-block meter, then 176 for a twenty-block one. Both are the same fault
    const rule = CSS.match(/#status \{[^}]*\}/s)?.[0] ?? '';
    expect(rule, 'the status slab is capped at a fixed width again').not.toMatch(/max-width:\s*\d+px/);
  });

  it('starts phone news beyond the bordered tab spine', () => {
    /*
     * `--band-tabs` is the buttons' width. The rail adds a border on both sides, so beginning the
     * news at the bare band puts its first pixel under the controls. This was measured in a
     * 667×375 touch browser: the buttons ended at x=45 and the chat began at x=44.
     */
    expect(CSS).toContain(
      'left: calc(var(--safe-left) + var(--band-tabs) + 2 * var(--ui-scale))',
    );
  });

  it('adds the safe-area insets outside the bands rather than folding them in', () => {
    // a gap kept for taste is waste; a gap kept for an obstruction is a gap. Folding the notch into
    // a band would make every phone's layout a different layout
    for (const inset of ['top', 'left', 'right', 'bottom']) {
      expect(CSS).toContain(`--safe-${inset}: env(safe-area-inset-${inset}`);
    }
  });
});
