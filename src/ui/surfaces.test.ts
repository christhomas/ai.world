import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The two surfaces, and the seam between them.
 *
 * Item 112: dark glass while you play, paper while you read. `surfaces.css` turns the reading
 * panels into paper — an opaque page with its own ink — and `style.css` lays them out in the glass
 * tokens every other panel uses.
 *
 * That seam has one failure mode and it is silent. A rule in `style.css` like
 * `#journal .j-line { color: var(--accent) }` is more specific than `#journal { color: var(--paper-ink) }`
 * in `surfaces.css`, so it wins — and the text goes on being the glass colour on a cream page.
 * Nothing errors, nothing looks wrong in the editor, and the panel is simply hard to read in a way
 * that depends on which theme is on.
 *
 * There were seventeen of these when this was written: every line of the journal, the roster, the
 * player list and the pack, and the lineage note. Two reviews found two of them. So the rule is
 * written down here rather than left to be noticed one at a time.
 */
const STYLE = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const SURFACES = readFileSync(new URL('./surfaces.css', import.meta.url), 'utf8');

/**
 * Every `selector { body }` in a stylesheet, one row per comma-separated selector.
 *
 * Comments come out first, because this repository writes its arguments above the rule they are
 * about — and a comment sitting on the front of a selector list makes the first selector in it
 * something no scan recognises. Which is how `#journal` hid from the first version of this.
 */
function rules(css: string): Array<{ sel: string; body: string }> {
  const out: Array<{ sel: string; body: string }> = [];
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^}]*)\}/g)) {
    for (const sel of rule[1].split(',')) out.push({ sel: sel.split(/\s+/).filter(Boolean).join(' '), body: rule[2] });
  }
  return out;
}

/** The panels `surfaces.css` turns into paper: whatever it gives a paper background to. */
const paperPanels = (): string[] => [...new Set(rules(SURFACES)
  .filter(({ body }) => /background:[^;]*var\(--paper-(surface|top|bottom)\)/.test(body))
  .map(({ sel }) => sel.split(' ')[0])
  .filter((sel) => sel.startsWith('#')))];

describe('a panel made of paper', () => {
  it('is the set this test knows about, so a new one cannot be added unnoticed', () => {
    // if this fails, a panel became paper and the rule below now has to be true of it too
    expect(paperPanels().sort()).toEqual([
      '#journal', '#kinCard', '#kinpanel', '#optionsPanel', '#players', '#roster', '#rucksack', '#worldmap',
    ]);
  });

  /*
   * The rule itself. Ink on a page is paper ink; a glass token here is the colour of a panel this
   * one is not, and the more specific rule wins in silence.
   */
  it('has nothing inside it coloured with a glass token', () => {
    const paper = paperPanels();
    /*
 * `color`, and not `border-color` or `background-color`, which is what caught this test out the
 * first time a focus ring was added: a ring is a border in the accent and says nothing about
 * whether the words are readable. A hyphen is a word boundary, so `\b` was not enough.
 */
const INK = /(?<![\w-])color:\s*[^;]*var\(--(ink|accent)\)/;
    const answered = new Set(rules(SURFACES).filter(({ body }) => /(?<![\w-])color:/.test(body)).map(({ sel }) => sel));
    const wrong = rules(STYLE)
      .filter(({ body }) => INK.test(body))
      .filter(({ sel }) => paper.some((one) => sel.startsWith(`${one} `) || sel.startsWith(`${one}.`)))
      .filter(({ sel }) => !answered.has(sel))
      .map(({ sel }) => sel);
    expect([...new Set(wrong)],
      'these read as glass on a page; give them a paper colour in surfaces.css').toEqual([]);
  });
});
