/**
 * A phone is held sideways to play this.
 *
 * The whole design is landscape and always was: an isometric view down a valley, a strip of HUD
 * along the top, a stick and buttons along the bottom, a console that comes up from the bottom
 * edge. Stood on its end, a phone has room for about a third of that and none of the view — so
 * rather than trying to make a portrait game out of it, the game asks to be turned.
 *
 * Two ways, because browsers disagree about this. Android through Chrome will lock the orientation
 * outright, but only for a page that is fullscreen, which is a thing a user has to ask for — so the
 * lock is attempted whenever the game goes fullscreen and quietly does nothing when it cannot. iOS
 * will not lock at all, at any price. So the second way is the one that always works: while the
 * phone is upright, the game is covered by a card telling the player to turn it, and uncovered the
 * moment they do.
 *
 * Only on a phone. A tablet in portrait is a perfectly good way to read a map, and a laptop with a
 * touchscreen is not a phone at all — which is why this measures the screen and the pointer rather
 * than asking whether the browser has ever heard of touch.
 */

/**
 * The longest a phone's short side gets, in CSS pixels.
 *
 * Measured across the screen rather than the window, so it does not change when a keyboard opens or
 * the address bar slides away. A large phone is around 430 by 930; a small tablet starts about 600
 * across, and a tablet is not what this is for.
 */
const PHONE_SHORT_SIDE = 520;

/** And the longest its long side gets, so a small window on a desktop is not mistaken for one. */
const PHONE_LONG_SIDE = 1100;

/**
 * Is this a phone? Given the screen's two sides and whether the pointer is a finger.
 *
 * Pure, and separated from everything that reads the browser, because it is the only part of this
 * with a decision in it — and a decision worth being able to test at a size rather than at a
 * device.
 */
export function isPhoneScreen(width: number, height: number, coarsePointer: boolean): boolean {
  if (!coarsePointer) return false;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return short <= PHONE_SHORT_SIDE && long <= PHONE_LONG_SIDE;
}

/**
 * Should the game be covered and the player asked to turn the phone?
 *
 * Two different measurements, and it matters which is which. How big the device is comes from the
 * *screen*, which is stable — it does not change when a keyboard opens or the address bar slides
 * away. Which way up it is being held comes from the *window*, because on iOS `screen.width` is the
 * width of the phone standing up and stays that way however the phone is turned. Read the screen
 * for the orientation and the game asks a player who has already turned their phone to turn it.
 */
export function shouldTurn(
  screen: { width: number; height: number },
  window_: { width: number; height: number },
  coarsePointer: boolean,
): boolean {
  return isPhoneScreen(screen.width, screen.height, coarsePointer) && window_.height > window_.width;
}

/** What a browser has to offer for this, so the whole of it can be handed a pretend one in a test. */
export interface Sideways {
  /** The device's two sides, which do not change when the address bar slides away — nor, on iOS,
   * when the phone is turned. Only good for how big it is. */
  screen: { width: number; height: number };
  /** The window's two sides, which is what says which way up it is being held. */
  window: { width: number; height: number };
  /** Whether the thing pointing at the page is a finger. */
  coarsePointer: boolean;
  /** Cover the game and ask for the phone to be turned, or stop asking. */
  cover: (on: boolean) => void;
  /** Ask the browser to hold the page landscape. May do nothing; must never throw. */
  hold: () => void;
}

/**
 * Watch the screen and keep the game the right way up. Returns a function that stops watching.
 *
 * Called once at boot with the real browser behind it. Everything it decides comes out of the two
 * pure functions above, so what is left here is plumbing: read the screen, cover or uncover, and
 * ask for the lock when there is any chance of getting it.
 */
export function keepSideways(browser: Sideways, listen: (on: () => void) => () => void): () => void {
  const look = (): void => {
    const screen = browser.screen;
    browser.cover(shouldTurn(screen, browser.window, browser.coarsePointer));
    if (isPhoneScreen(screen.width, screen.height, browser.coarsePointer)) browser.hold();
  };
  look();
  return listen(look);
}

/** The real browser, for the one call at boot that has one. */
export function thisBrowser(card: HTMLElement): Sideways {
  return {
    get screen() {
      return { width: window.screen?.width ?? window.innerWidth, height: window.screen?.height ?? window.innerHeight };
    },
    get window() {
      return { width: window.innerWidth, height: window.innerHeight };
    },
    get coarsePointer() {
      return window.matchMedia?.('(pointer: coarse)').matches ?? false;
    },
    cover: (on) => { card.style.display = on ? 'flex' : 'none'; },
    hold: () => {
      // Only ever succeeds fullscreen, and only on browsers that have it at all. Rejected
      // promises are the normal case rather than a fault, so nothing here reports one.
      const orientation = window.screen?.orientation as
        (ScreenOrientation & { lock?: (to: string) => Promise<void> }) | undefined;
      try { void orientation?.lock?.('landscape').catch(() => {}); } catch { /* not on this browser */ }
    },
  };
}

/** Everything that could change which way up a phone is: turning it, and resizing the window. */
export function whenTurned(on: () => void): () => void {
  const events = ['orientationchange', 'resize'] as const;
  for (const event of events) window.addEventListener(event, on);
  const orientation = window.screen?.orientation;
  orientation?.addEventListener?.('change', on);
  return () => {
    for (const event of events) window.removeEventListener(event, on);
    orientation?.removeEventListener?.('change', on);
  };
}
