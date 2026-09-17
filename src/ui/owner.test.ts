import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { screenOf, type Panels } from './panels';

/**
 * Exactly one thing owns the keyboard, and it is decided in one place.
 *
 * The bug the Ledger II handoff reports as *"keys leaking from panels into the world"*, and what it
 * cost was not subtle. `busy()` knew about the maps, the descent and the roster, and did not know
 * about the pack, the journal, Options or the player list — so with a pack open every key bound
 * `free` went on firing behind it. `n` left the world for the title screen. `x` swung the sword at
 * whatever was in front of a hero nobody could see. Every spell key cast.
 *
 * These are about the decision rather than about the panels, so the panels are stubs: what is being
 * held is that a reading surface says so, and that the door out of one still works.
 */
const shut = { isOpen: false };
const open = { isOpen: true };

/** A screen with nothing up, which anything below opens one thing on. */
function panels(over: Partial<Panels> = {}): Panels {
  return {
    chat: { isTyping: false }, dialogue: { isOpen: false }, photo: { active: false },
    worldMap: shut, kinPanel: shut, roster: shut,
    rucksack: shut, journal: shut, playerList: shut,
    hud: { optionsOpen: false },
    ...over,
  } as unknown as Panels;
}

describe('who owns the keyboard', () => {
  it('is nobody when the world is all there is', () => {
    expect(screenOf(panels()).busy()).toBeNull();
  });

  it('is the pack while the pack is open', () => {
    // the one that cost the most: `n` is bound `free`, so an open pack used to mean a keystroke
    // away from the title screen
    expect(screenOf(panels({ rucksack: open } as Partial<Panels>)).busy()).toBe('reading');
  });

  it('is the journal, Options and the player list too', () => {
    expect(screenOf(panels({ journal: open } as Partial<Panels>)).busy()).toBe('reading');
    expect(screenOf(panels({ playerList: open } as Partial<Panels>)).busy()).toBe('reading');
    expect(screenOf(panels({ hud: { optionsOpen: true } } as unknown as Partial<Panels>)).busy()).toBe('reading');
  });

  it('keeps the maps and the roster reading, which they always were', () => {
    expect(screenOf(panels({ worldMap: open } as Partial<Panels>)).busy()).toBe('reading');
    expect(screenOf(panels({ kinPanel: open } as Partial<Panels>)).busy()).toBe('reading');
    expect(screenOf(panels({ roster: open } as Partial<Panels>)).busy()).toBe('reading');
  });

  it('lets typing beat everything, so a message can contain the letter m', () => {
    const typing = panels({ chat: { isTyping: true }, rucksack: open, worldMap: open } as unknown as Partial<Panels>);
    expect(screenOf(typing).busy()).toBe('typing');
  });

  it('lets a conversation beat a panel, the way a person beats a book', () => {
    const talking = panels({ dialogue: { isOpen: true }, rucksack: open } as unknown as Partial<Panels>);
    expect(screenOf(talking).busy()).toBe('talking');
  });

  it('leaves the doors out of a panel bound so they still work', () => {
    /*
     * The other half, and the one that would make this fix worse than the bug. `i`, `j`, `o` and
     * `m` open the reading surfaces and have to close them again, so they are bound `unless
     * talking` rather than `free` — a pack you cannot put down the way you picked it up is not an
     * improvement on a pack that quits the game.
     */
    const keys = readFileSync(new URL('../game/keys.ts', import.meta.url), 'utf8');
    for (const door of ["bind('i'", "bind('j'", "bind('o'"]) {
      const line = keys.split('\n').find((one) => one.includes(door)) ?? '';
      expect(line, `${door} has to survive a panel being open`).toContain("'unless talking'");
    }
    // and the one key that must work from inside anything at all
    expect(keys).toContain("bind('escape', 'always'");
  });
});
