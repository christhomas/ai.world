import type { Input } from '../core/input';

/**
 * The game played with thumbs.
 *
 * Everything here ends up as a key: the stick holds W/A/S/D, a button presses the letter it is
 * drawn with. That is deliberate — the world already listens for those keys, so a phone and a
 * keyboard are the same game rather than two, and nothing downstream has to be told which one
 * is in the player's hands.
 */

/** How far the thumb travels for full deflection, and how far it may drift while resting. */
const STICK = {
  /** Pixels from where the thumb landed to the edge of the ring. */
  RANGE: 54,
  /** Inside this the thumb is resting on the glass, not steering. */
  DEAD_ZONE: 14,
} as const;

/**
 * The eight sectors of the stick, starting due right and going clockwise on screen, each with the
 * keys it holds. Eight is what the hero walks in anyway — `Player` normalises whatever the
 * direction keys say — so a stick that snapped to sixteen would promise a precision the legs
 * do not have.
 */
const SECTORS: readonly string[][] = [
  ['d'], ['s', 'd'], ['s'], ['s', 'a'], ['a'], ['w', 'a'], ['w'], ['w', 'd'],
];

/** Which keys a thumb this far from where it landed is holding down. Screen pixels: +y is down. */
export function stickKeys(dx: number, dy: number): string[] {
  if (Math.hypot(dx, dy) < STICK.DEAD_ZONE) return [];
  return SECTORS[Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7];
}

/** How far the nub sits from the middle of the ring, in pixels, given the thumb's offset. */
export function nubOffset(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= STICK.RANGE) return { x: dx, y: dy };
  return { x: (dx / len) * STICK.RANGE, y: (dy / len) * STICK.RANGE };
}

interface Button {
  /** The key this button is, spelled the way `Input` spells it. */
  key: string;
  glyph: string;
  /** Read out by screen readers, and the label in the extra-controls menu. */
  label: string;
  /** True for a button that is held rather than struck, like turning the camera. */
  hold?: boolean;
}

/** The buttons that live on screen: the panels, the camera, and the way out of whatever is open. */
const PANEL_BUTTONS: readonly Button[] = [
  { key: 'm', glyph: '🗺', label: 'Map' },
  { key: 'i', glyph: '🎒', label: 'Rucksack' },
  { key: 'j', glyph: '📖', label: 'Journal' },
  { key: 'o', glyph: '⚙', label: 'Options' },
  { key: 'q', glyph: '↺', label: 'Turn the camera left', hold: true },
  { key: 'e', glyph: '↻', label: 'Turn the camera right', hold: true },
];

/**
 * The rest of the keyboard, one tap further away: the five that only mean anything in a shared
 * world, and the two camera modes. None of them is wanted mid-stride, so none of them earns a
 * permanent square of a phone screen.
 */
const MORE_BUTTONS: readonly Button[] = [
  { key: 't', glyph: '💬', label: 'Chat' },
  { key: 'g', glyph: '🤝', label: 'Trade or duel' },
  { key: 'k', glyph: '🧭', label: 'Party' },
  { key: 'l', glyph: '👥', label: 'Travellers' },
  { key: 'r', glyph: '📍', label: 'Rally point' },
  { key: 'p', glyph: '📷', label: 'Photo mode' },
  { key: 'f', glyph: '🎥', label: 'Free camera' },
];

/** The two that are pressed constantly, drawn big enough to hit without looking. */
const ACT = { key: 'enter', glyph: '⏎', label: 'Talk, open, board, harvest' } as const;
const SWING = { key: 'x', glyph: '⚔', label: 'Swing' } as const;
const ESCAPE = { key: 'escape', glyph: '✕', label: 'Close' } as const;

/** `?touch=1` forces the controls on, `?touch=0` off, for anyone whose device we guess wrong. */
function forcedByLink(): boolean | null {
  const asked = new URL(window.location.href).searchParams.get('touch');
  return asked === null ? null : asked !== '0';
}

export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly stickZone = document.createElement('div');
  private readonly stickBase = document.createElement('div');
  private readonly stickNub = document.createElement('div');
  private readonly more = document.createElement('div');
  /** Every listener this layer holds, so they can all be dropped at once. */
  private readonly listening = new AbortController();
  /** The finger currently on the stick, and where it first landed. */
  private stickPointer: number | null = null;
  private stickX = 0;
  private stickY = 0;
  /** The direction keys the stick is holding, so lifting a thumb releases only those. */
  private held: string[] = [];
  private on = false;

  constructor(private readonly input: Input) {
    const signal = this.listening.signal;
    this.root.id = 'touch';
    this.buildStick();
    this.root.append(this.buildPanelRow(), this.buildMoreMenu(), this.buildActionCluster());
    document.body.appendChild(this.root);

    const forced = forcedByLink();
    if (forced === true || (forced === null && window.matchMedia('(pointer: coarse)').matches)) this.enable();
    // A machine with a mouse never gets these, but a laptop with a touchscreen should the moment
    // somebody actually touches it — the first finger anywhere is the only honest signal there is.
    if (forced !== false) {
      window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.enable(); }, { signal });
    }
  }

  private enable(): void {
    if (this.on) return;
    this.on = true;
    document.body.classList.add('touch');
  }

  /** Stop listening, and take the controls off the page. The world is being put away. */
  dispose(): void {
    this.listening.abort();
    this.releaseStick();
    this.root.remove();
    document.body.classList.remove('touch');
  }

  /**
   * The stick is not drawn until a thumb lands: on a screen this size, wherever the thumb falls
   * is where the stick should have been, and a fixed one is a stick you have to look for.
   */
  private buildStick(): void {
    const signal = this.listening.signal;
    this.stickZone.id = 'touchStick';
    this.stickBase.className = 'stick-base';
    this.stickNub.className = 'stick-nub';
    this.stickBase.appendChild(this.stickNub);
    this.stickZone.appendChild(this.stickBase);
    this.root.appendChild(this.stickZone);

    this.stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.stickZone.setPointerCapture(e.pointerId);
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('show');
      this.moveNub(0, 0);
    }, { signal });
    this.stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      const dx = e.clientX - this.stickX;
      const dy = e.clientY - this.stickY;
      this.moveNub(dx, dy);
      this.steer(stickKeys(dx, dy));
    }, { signal });
    const lift = (e: PointerEvent) => { if (e.pointerId === this.stickPointer) this.releaseStick(); };
    this.stickZone.addEventListener('pointerup', lift, { signal });
    this.stickZone.addEventListener('pointercancel', lift, { signal });
  }

  private moveNub(dx: number, dy: number): void {
    const { x, y } = nubOffset(dx, dy);
    this.stickNub.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  private steer(keys: string[]): void {
    for (const k of this.held) if (!keys.includes(k)) this.input.release(k);
    for (const k of keys) this.input.hold(k);
    this.held = keys;
  }

  /** Let go of the world: the thumb has lifted, or a panel has taken the screen. */
  private releaseStick(): void {
    this.steer([]);
    this.stickPointer = null;
    this.stickBase.classList.remove('show');
  }

  private buildPanelRow(): HTMLElement {
    const row = document.createElement('div');
    row.id = 'touchPanels';
    for (const b of PANEL_BUTTONS) row.appendChild(this.button(b, 'touch-btn'));

    const more = this.button({ key: '', glyph: '⋯', label: 'More controls' }, 'touch-btn');
    more.addEventListener('pointerdown', () => this.more.classList.toggle('show'), { signal: this.listening.signal });
    row.appendChild(more);

    const close = this.button(ESCAPE, 'touch-btn touch-close');
    row.appendChild(close);
    return row;
  }

  private buildMoreMenu(): HTMLElement {
    this.more.id = 'touchMore';
    for (const b of MORE_BUTTONS) {
      const btn = this.button(b, 'touch-more-btn');
      btn.innerHTML = `<span class="touch-glyph">${b.glyph}</span><span class="touch-label">${b.label}</span>`;
      // the menu is a shelf, not a mode: whatever you came for, you are done with it
      btn.addEventListener('pointerdown', () => this.more.classList.remove('show'), { signal: this.listening.signal });
      this.more.appendChild(btn);
    }
    return this.more;
  }

  private buildActionCluster(): HTMLElement {
    const cluster = document.createElement('div');
    cluster.id = 'touchAct';
    cluster.append(this.button(SWING, 'touch-round touch-swing'), this.button(ACT, 'touch-round touch-do'));
    return cluster;
  }

  /**
   * One button. Pressing happens on the way down, not the way up, because a game that waits for
   * your thumb to leave the glass feels broken however fast it is.
   */
  private button(b: Button, className: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = b.glyph;
    el.setAttribute('aria-label', b.label);
    el.title = b.label;
    const signal = this.listening.signal;
    if (!b.key) return el;
    if (b.hold) {
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        this.input.hold(b.key);
      }, { signal });
      const letGo = () => this.input.release(b.key);
      el.addEventListener('pointerup', letGo, { signal });
      el.addEventListener('pointercancel', letGo, { signal });
    } else {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();     // no synthetic click behind this one, and no text selection
        // a panel about to cover the screen must not leave the hero walking into a wall
        this.releaseStick();
        this.input.press(b.key);
      }, { signal });
    }
    return el;
  }
}
