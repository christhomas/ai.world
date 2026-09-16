import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The top-left readings, on a screen the size of a hand.
 *
 * `hud.ts` draws health and breath as a twenty-block bar and a number, which is right on a desktop
 * and was the first thing wrong with the phone: forty blocks of meter in the brightest colour in
 * the palette, across a third of an 844-pixel screen, over the corner of the world the hero walks
 * out of. A bar is worth its width where there is width to spare.
 *
 * The Ledger II handoff asks for `72/100 · 68 BREATH` in a slab flush into the corner, and these
 * hold the two halves of that: the markup can say it, and the stylesheet does.
 */
const HUD = readFileSync(new URL('./hud.ts', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

/** What a selector declares at the hand-sized breakpoint, where every rule below it lives. */
const onAPhone = (selector: string): string => {
  const at = CSS.indexOf('@media (max-width: 820px), (max-height: 560px)');
  expect(at, 'the hand-sized breakpoint has moved or gone').toBeGreaterThan(0);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = CSS.slice(at).match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  expect(found, `there is no ${selector} rule on a phone`).not.toBeNull();
  return found![1];
};

describe('what the corner of a phone says about the hero', () => {
  it('says the number in parts, so the screen can colour them differently', () => {
    /*
     * `72` in health green against `/100` in dim ink is two elements or it is nothing: one span
     * gets one colour and one size. So the number carries its own parts and the stylesheet decides
     * what a screen of a given size does with them.
     */
    expect(HUD).toContain('class="hud-now"');
    expect(HUD).toContain('class="hud-max"');
  });

  it('names the breath reading, because two bare pairs of digits name neither', () => {
    /*
     * Stacked in the corner with the bars gone, health and breath are `100/100` twice and nothing
     * says which is which. The word after the number is the whole of how you tell them apart.
     */
    expect(HUD).toContain("' BREATH'");
    expect(HUD, 'the sword arm needs its own word for the same reason').toContain("' ARM'");
  });

  it('drops the bar on a phone and keeps the number', () => {
    expect(onAPhone('#status .hud-bar')).toMatch(/display:\s*none/);
    expect(onAPhone('.hud-hp'), 'the reading itself stays').not.toMatch(/display:\s*none/);
  });

  it('puts the slab flush into the corner, with rules on the two inner edges only', () => {
    /*
     * The edge of the screen is the rim — the same argument the tab spine and the panel rail
     * already make. A slab held off the corner by eight pixels reads as a dialog somebody left open
     * over the game.
     */
    const status = onAPhone('#status');
    expect(status).toMatch(/top:\s*0/);
    expect(status).toMatch(/left:\s*0/);
    expect(status).toMatch(/border-right:\s*1px/);
    expect(status).toMatch(/border-bottom:\s*1px/);
    expect(status, 'the two outer edges are the screen').toMatch(/border-top:\s*none/);
    expect(status).toMatch(/border-left:\s*none/);
  });

  it('gives the bearings the foot of the screen, which is the band nothing else wants', () => {
    /*
     * They were pinned under the place name at the top, which is the band the handoff gives to the
     * place name alone — two centred lines of type stacked on each other, covering the picture's
     * own horizon on a screen 390 tall. The thumb owns the bottom-left corner and the action card
     * owns the bottom-right; what is left between them is exactly the shape of one line of text.
     */
    const bearings = onAPhone('#compass');
    expect(bearings).toMatch(/bottom:\s*0/);
    expect(bearings, 'a top and a bottom is a rule that depends on source order').toMatch(/top:\s*auto/);
    expect(bearings, 'read against grass, a road and a cave floor in the same minute').toContain('var(--surface)');
    expect(bearings, 'one line, never two').toMatch(/white-space:\s*nowrap/);
  });

  it('keeps the bearings clear of the two corners a thumb owns', () => {
    // the band is the width it leaves at each end, not a guess at where the card happens to be
    expect(CSS).toMatch(/--band-bearings:\s*calc\(\d+ \* var\(--ui-scale\)\)/);
    expect(onAPhone('#compass')).toContain('var(--band-bearings)');
  });

  it('starts the tab gutter where the readings actually end', () => {
    /*
     * 62 units down, which is the handoff's number and now also the truth: the slab is two lines of
     * eleven-pixel mono rather than two twenty-block meters, and the gutter was still starting
     * below where the meters used to reach.
     */
    const at = CSS.indexOf('@media (max-height: 560px)');
    const rail = CSS.slice(at).match(/#touchPanels\s*\{([^}]*)\}/s);
    expect(rail, 'the short-screen rail rule has gone').not.toBeNull();
    expect(rail![1]).toContain('62px');
  });

  it('puts the reflex pair in the corner the card owns, under it', () => {
    /*
     * They orbited the big USE button on an arc; when USE moved into the action card the arc
     * stayed, so three discs hung in the middle of the picture beside a card flush to the corner,
     * belonging to nothing. The handoff: *"today's build has this backwards — USE owns the corner
     * and the sword orbits into the middle of the picture."*
     */
    const strip = CSS.match(/body\.touch #touchAct\s*\{([^}]*)\}/s);
    expect(strip, 'the touch reflex strip rule has gone').not.toBeNull();
    expect(strip![1]).toMatch(/right:\s*var\(--safe-right\)/);
    expect(strip![1]).toMatch(/bottom:\s*var\(--safe-bottom\)/);
    expect(strip![1], 'one band, shared with the card above it').toContain('var(--band-action)');
  });

  it('stacks the card on the strip rather than on the edge', () => {
    // both measured against the same named height, so neither can drift onto the other
    expect(CSS).toMatch(/--reflex-row:\s*calc\(62 \* var\(--ui-scale\)\)/);
    const card = CSS.match(/body\.touch #actionCard\s*\{([^}]*)\}/s);
    expect(card, 'the card no longer sits on the strip').not.toBeNull();
    expect(card![1]).toContain('var(--reflex-row)');
  });

  it('takes the arc off the reflex buttons rather than leaving it to be undone twice', () => {
    // a transform left on and cancelled somewhere else is the shape of the bug this replaced
    const orbit = CSS.match(/body\.touch #touchAct \.touch-orbit\s*\{([^}]*)\}/s);
    expect(orbit, 'the orbit override has gone').not.toBeNull();
    expect(orbit![1]).toMatch(/transform:\s*none/);
    expect(orbit![1]).toMatch(/position:\s*static/);
  });

  it('keeps the safe-area inset outside the padding rather than folding it in', () => {
    // a notch is an obstruction, not taste: see the same rule in `geometry.test.ts`
    expect(onAPhone('#status')).toContain('var(--safe-left)');
  });
});
