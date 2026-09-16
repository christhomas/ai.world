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

  it('keeps the safe-area inset outside the padding rather than folding it in', () => {
    // a notch is an obstruction, not taste: see the same rule in `geometry.test.ts`
    expect(onAPhone('#status')).toContain('var(--safe-left)');
  });
});
