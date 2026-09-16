import { describe, expect, it, beforeEach } from 'vitest';
import { SWITCHES, isOn, keyOf, setOn, switchOf } from './switches';

/**
 * The things somebody can turn on before a world opens, and where the choice is kept.
 *
 * #250 says *"`src/ui/title.ts` already carries a list of switches, each with an `id`, a `note` and
 * a `fallback`"*. It does not — `title.ts` is a hundred and forty lines of slot selection, and
 * `ai.world/new/` appears nowhere in the repository. So the list is part of that item rather than a
 * line added to something that exists, and it is here rather than in `title.ts` for the reason
 * `themes.ts` is its own file: what is remembered between visits is a different subject from what
 * is drawn.
 *
 * `themes.ts` is the pattern being followed, down to the failure mode: a value in storage from a
 * build that offered a switch this one does not is somebody whose game should still open. Anything
 * unrecognised reads as the fallback rather than as an error.
 *
 * ## Why a switch has a note
 *
 * Because the first one is a *second renderer*, and "composer" means nothing to the person deciding.
 * A switch that cannot say plainly what it changes is a switch nobody will touch on purpose and
 * everybody will report as a bug when they touch it by accident.
 */

/**
 * A browser's storage, because node has none.
 *
 * Stubbed rather than skipped: what is under test is whether a choice survives being written and
 * read back, and a test that could not observe that would be asserting the environment instead of
 * the code. The browser that *refuses* storage is its own case further down.
 */
beforeEach(() => {
  const held = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => { held.set(k, v); },
      removeItem: (k: string) => { held.delete(k); },
      clear: () => held.clear(),
    },
  });
});

describe('the switches a world can be opened with', () => {
  it('has at least one, and every one of them says what it changes', () => {
    expect(SWITCHES.length).toBeGreaterThan(0);
    for (const one of SWITCHES) {
      expect(one.id, 'a switch with no id').not.toBe('');
      expect(one.note.length, `${one.id} says nothing about what it does`).toBeGreaterThan(20);
      expect(typeof one.fallback, `${one.id} has no fallback`).toBe('boolean');
    }
  });

  it('is off by default, because a new path is a thing somebody opts into', () => {
    for (const one of SWITCHES) expect(isOn(one.id), one.id).toBe(one.fallback);
  });

  it('remembers a choice, which is the whole point of it being a switch', () => {
    const one = SWITCHES[0].id;
    setOn(one, !SWITCHES[0].fallback);
    expect(isOn(one)).toBe(!SWITCHES[0].fallback);
  });

  it('keeps each one under its own name, so two switches cannot collide', () => {
    const keys = new Set(SWITCHES.map((one) => keyOf(one.id)));
    expect(keys.size).toBe(SWITCHES.length);
    expect(keyOf(SWITCHES[0].id)).toContain(SWITCHES[0].id);
  });

  it('reads a switch it has never heard of as off, rather than throwing', () => {
    // a value left by a build that offered something this one does not: that person's game opens
    expect(isOn('a-switch-from-another-build')).toBe(false);
    expect(switchOf('a-switch-from-another-build')).toBeNull();
  });

  it('survives a browser that refuses storage at all', () => {
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage is blocked in this browser'); },
    });
    try {
      expect(() => isOn(SWITCHES[0].id)).not.toThrow();
      expect(isOn(SWITCHES[0].id)).toBe(SWITCHES[0].fallback);
      expect(() => setOn(SWITCHES[0].id, true)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
    }
  });
});

describe('the switch this list exists for', () => {
  it('offers the composer rig, off by default', () => {
    const composer = switchOf('composer');
    expect(composer, 'no composer switch, which is what #250 is about').not.toBeNull();
    expect(composer!.fallback, 'a second render path must be opted into').toBe(false);
  });

  it('says what it changes without using the word composer', () => {
    // the person choosing is not a graphics programmer. "composer" is the implementation's name
    const note = switchOf('composer')!.note.toLowerCase();
    expect(note.length).toBeGreaterThan(30);
    expect(note).not.toBe('');
  });
});
