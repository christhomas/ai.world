import { describe, expect, it } from 'vitest';
import { isPhoneScreen, keepSideways, shouldTurn, type Sideways } from './sideways';

/**
 * Which screens are phones, and which of them are the wrong way up.
 *
 * The sizes are the whole of it. "Has this browser heard of touch" is the easy question and the
 * wrong one — it says yes to a laptop with a touchscreen and to every phone emulator anybody has
 * ever left open — so what is asked instead is how big the screen is and whether the thing pointing
 * at it is a finger. These are the devices that answer.
 */

/** A screen, the way a browser reports one: the device's own two sides, not the window's. */
const screens = {
  phone: { width: 393, height: 852 },          // a large modern phone, upright
  phoneSideways: { width: 852, height: 393 },
  smallPhone: { width: 320, height: 568 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1512, height: 982 },
  desktop: { width: 2560, height: 1440 },
};

describe('which screens are phones', () => {
  it('says yes to a phone, either way up', () => {
    expect(isPhoneScreen(screens.phone.width, screens.phone.height, true)).toBe(true);
    expect(isPhoneScreen(screens.phoneSideways.width, screens.phoneSideways.height, true)).toBe(true);
    expect(isPhoneScreen(screens.smallPhone.width, screens.smallPhone.height, true)).toBe(true);
  });

  it('says no to a tablet, which is a perfectly good way to read a map on its end', () => {
    expect(isPhoneScreen(screens.tablet.width, screens.tablet.height, true)).toBe(false);
  });

  it('says no to anything with a mouse on it, however small the window', () => {
    expect(isPhoneScreen(screens.laptop.width, screens.laptop.height, false)).toBe(false);
    expect(isPhoneScreen(screens.desktop.width, screens.desktop.height, false)).toBe(false);
    // a laptop with a touchscreen is not a phone, and its screen is what says so
    expect(isPhoneScreen(screens.laptop.width, screens.laptop.height, true)).toBe(false);
  });
});

describe('asking for the phone to be turned', () => {
  it('asks when a phone is upright, and stops when it is turned', () => {
    expect(shouldTurn(screens.phone, screens.phone, true)).toBe(true);
    expect(shouldTurn(screens.phone, screens.phoneSideways, true)).toBe(false);
  });

  it('reads which way up from the window, because iOS never turns the screen', () => {
    // the device says it is 393 by 852 whichever way the phone is being held; the window is what
    // actually turns, and asking the screen means asking somebody to turn a phone they have turned
    expect(shouldTurn(screens.phone, { width: 852, height: 393 }, true)).toBe(false);
    expect(shouldTurn(screens.phoneSideways, screens.phone, true)).toBe(true);
  });

  it('never asks anybody else, whichever way up their screen is', () => {
    expect(shouldTurn(screens.tablet, screens.tablet, true)).toBe(false);
    expect(shouldTurn(screens.desktop, screens.desktop, false)).toBe(false);
  });
});

describe('keeping the game the right way up', () => {
  /** A pretend browser whose screen can be turned under it. */
  const pretend = (start: { width: number; height: number }, coarse = true) => {
    let screen = start;
    let view = start;
    const covered: boolean[] = [];
    let held = 0;
    let watcher: (() => void) | null = null;
    const browser: Sideways = {
      get screen() { return screen; },
      get window() { return view; },
      coarsePointer: coarse,
      cover: (on) => covered.push(on),
      hold: () => { held++; },
    };
    const listen = (on: () => void) => { watcher = on; return () => { watcher = null; }; };
    return {
      browser, listen, covered,
      get held() { return held; },
      get watching() { return watcher !== null; },
      // a phone turning: the window's sides swap, and on iOS the screen's do not
      turn: (to: { width: number; height: number }) => { view = to; watcher?.(); },
    };
  };

  it('covers an upright phone at once, and uncovers it when it is turned', () => {
    const it = pretend(screens.phone);
    keepSideways(it.browser, it.listen);
    expect(it.covered).toEqual([true]);
    it.turn(screens.phoneSideways);
    expect(it.covered).toEqual([true, false]);
  });

  it('asks the browser to hold it there, phone or no phone', () => {
    const onAPhone = pretend(screens.phone);
    keepSideways(onAPhone.browser, onAPhone.listen);
    expect(onAPhone.held).toBe(1);

    // and never asks a desktop browser to lock its window sideways
    const onADesk = pretend(screens.desktop, false);
    keepSideways(onADesk.browser, onADesk.listen);
    expect(onADesk.held).toBe(0);
    expect(onADesk.covered).toEqual([false]);
  });

  it('stops watching when it is told to', () => {
    const it = pretend(screens.phone);
    const stop = keepSideways(it.browser, it.listen);
    expect(it.watching).toBe(true);
    stop();
    expect(it.watching).toBe(false);
  });
});
