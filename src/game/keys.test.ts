import { describe, expect, it } from 'vitest';
import type { Input } from '../core/input';
import { bindKeys, type Keys } from './keys';
import type { Screen } from './screen';

/**
 * What a key does while somebody else has the keyboard.
 *
 * Item 118. `Input` listens on `document` and calls every handler registered for a key, with no
 * check on where the keypress came from — so a letter typed into the chat box arrives at the game
 * exactly as one pressed on the canvas does. `keys.ts` knows this and answers it with one guard,
 * `free()`, which asks the whole question rather than the two-thirds that used to be spelled out
 * per binding.
 *
 * The pattern was intact and the enforcement was not: some bindings simply did not ask. Reported
 * as two — `f` flipping the camera mid-sentence and `o` opening the options — and it was wider
 * than that. Typing `x` in the chat box swung a sword, `p` entered photo mode, and `n` left the
 * world for the title screen. The `!== 'talking'` guards were the same fault in a different
 * spelling: a text box is not a conversation, so `i` opened the rucksack while you typed.
 *
 * So this is about the rule rather than about any one key: **while a text box has the keyboard,
 * nothing the game does is reachable from it.** It is asked of every binding at once, because the
 * failure is always one that was forgotten.
 */

/*
 * `bindKeys` ends by listening for a resize and for the page being hidden, which are the two things
 * about a window it cares about. Neither is what this file is about, and neither exists in a
 * worker, so they are answered rather than exercised.
 */
const listening = { addEventListener: () => {} };
Object.assign(globalThis, { window: listening, document: listening });

const KEYS = [
  'k', 'l', 'r', 'o', 'f', 't', 'g', 'y', 'p', 'm', 'c', '+', '=', '-', 'x', 'z', 'b', 'h', 'u',
  'v', 'n', 'j', 'i', '1', '2', '3', '4', '5', '6', '7', '8', '9', '`', '~', ' ', 'enter',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd',
];

/** A keyboard nobody is holding, and a record of what each key turned out to do. */
function aKeyboard(busy: ReturnType<Screen['busy']>) {
  const handlers = new Map<string, Array<() => void>>();
  const did: string[] = [];
  const note = (what: string) => () => { did.push(what); };
  const input = {
    onKey(key: string, handler: () => void): void {
      const at = handlers.get(key) ?? [];
      at.push(handler);
      handlers.set(key, at);
    },
  } as unknown as Input;

  const screen = {
    busy: () => busy,
    say: note('say'),
    toggleJournal: note('journal'), toggleRucksack: note('rucksack'), toggleRoster: note('roster'),
    toggleOptions: note('options'), toggleMap: note('map'), toggleCompany: note('company'),
    togglePhoto: () => { did.push('photo'); return true; },
    toggleSeeThrough: () => { did.push('see through'); return true; },
    toggleConsole: note('console'), openChat: note('chat'),
    closeEverything: note('close everything'),
    centreMap: note('centre map'), zoomMap: note('zoom map'),
    advanceTalk: note('advance talk'), moveTalk: note('move talk'), nudgeTalk: note('nudge talk'),
    takePhoto: () => { did.push('take photo'); return 'a.png'; },
  } as unknown as Screen;

  const ctx = {
    seed: 1, input, screen,
    rig: { renderer: { render: () => {} }, scene: {}, resize: () => {} },
    iso: { camera: {}, resize: () => {} },
    player: { mode: 'follow', x: 0, z: 0, jump: () => { did.push('jump'); return true; } },
    places: {}, online: { connected: true, ping: note('ping') },
    sound: { blip: () => {}, chime: () => {} },
    attack: note('attack'), loose: note('loose'), conjure: note('conjure'),
    talkNearest: note('talk'), partyMenu: note('party'), hireMenu: note('hire'),
    offerTrade: note('trade'), tryGive: () => { did.push('give'); return true; },
    toTitle: note('to title'), persist: () => {},
    takeToTheAir: () => false,
    rally: [], partySize: () => 0,
  } as unknown as Keys;

  bindKeys(ctx);
  return {
    did,
    press(key: string): void { for (const handler of handlers.get(key) ?? []) handler(); },
    pressEverything(): void { for (const key of KEYS) this.press(key); },
  };
}

describe('a key pressed while somebody else has the keyboard', () => {
  it('does nothing at all while a text box is taking the letters', () => {
    // the whole of the bug: a chat box swallows a keypress on the way to the game, and it did not
    const board = aKeyboard('typing');
    board.pressEverything();
    expect(board.did).toEqual([]);
  });

  it('leaves a conversation to the conversation, except for moving about it', () => {
    const board = aKeyboard('talking');
    board.pressEverything();
    // the arrows and Enter are the conversation's own; nothing else may reach past it
    expect([...new Set(board.did)].sort()).toEqual(['advance talk', 'move talk', 'nudge talk']);
  });

  it('still gets you out of whatever you are in', () => {
    for (const busy of ['typing', 'talking', 'reading', 'framing'] as const) {
      const board = aKeyboard(busy);
      board.press('escape');
      expect(board.did, `escape did nothing while ${busy}`).toEqual(['close everything']);
    }
  });

  it('does what it says when nobody else has it', () => {
    const board = aKeyboard(null);
    board.press('x');
    board.press('i');
    board.press('f');
    expect(board.did).toEqual(['attack', 'rucksack']);
  });
});
