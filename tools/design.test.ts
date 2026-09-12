import { describe, expect, it } from 'vitest';
import { drawsTheHud, wordsIn } from './design';

/**
 * Reading a design from the terminal.
 *
 * A canvas is a picture and the tool that reads it is not. What it can honestly show is the
 * *words* — the labels, the readouts, the key hints — and those happen to be exactly the parts that
 * go stale, because a key that moves or a world that is retired changes a word and nothing else.
 *
 * Both of these are pinned because both have a failure mode that would make the tool useless rather
 * than wrong. Pulling the words out of a stylesheet would bury the writing in colour names; asking
 * a title screen why it has no health bar would make a check nobody reads.
 */

describe('the words on an artboard', () => {
  it('are the writing, not the code around it', () => {
    const words = wordsIn(`
      <style>body { font-family: 'IBM Plex Mono'; color: #ffd76a; }</style>
      <script>const gold = 246;</script>
      <!-- the purse, top left -->
      <div class="purse"><b>246</b> GOLD</div>`);
    expect(words).toBe('246 GOLD');
  });

  it('keep the order they are drawn in, which is how a design reads', () => {
    expect(wordsIn('<h1>AI WORLD</h1><p>A small hero.</p><p>A big seeded world.</p>'))
      .toBe('AI WORLD A small hero. A big seeded world.');
  });
});

describe('which artboards are drawing the interface', () => {
  it('are the ones that say so, by file or by title', () => {
    expect(drawsTheHud('HudA.dc.html')).toBe(true);
    expect(drawsTheHud('Main.dc.html', 'A · Cut stone — the HUD')).toBe(true);
  });

  it('and a title screen is not one', () => {
    // it has no health bar and no business mentioning one: a check that complained about that is
    // the failure mode of every staleness tool ever written
    expect(drawsTheHud('Main.dc.html', 'Title — desktop')).toBe(false);
    expect(drawsTheHud('TitlePhone.dc.html', 'Title — phone, sideways')).toBe(false);
  });
});
