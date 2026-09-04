/**
 * Keyboard + pointer state. Consumers poll `isDown`; one-shot keys use `onKey`.
 *
 * A finger is a second way of saying the same things: the on-screen controls in `ui/touch.ts`
 * hold and press the very keys the game already listens for, so a thumb stick and the W key
 * arrive here as one idea and nothing downstream has to know which one moved the hero.
 */
export class Input {
  private readonly keys = new Set<string>();
  /** Keys a finger is holding down. Kept apart so a lifted finger cannot clear a real key. */
  private readonly virtualKeys = new Set<string>();
  private readonly keyHandlers = new Map<string, Array<() => void>>();

  dragging = false;
  dragMoved = false;
  dragDX = 0;
  dragDY = 0;
  private dragX = 0;
  private dragY = 0;
  private static readonly DRAG_THRESHOLD = 5;

  wheelDelta = 0;
  clickX = -1;
  clickY = -1;
  clicked = false;
  /** Distance between two pinching fingers last frame, in pixels; 0 when nobody is pinching. */
  private pinchGap = 0;
  /** How much wheel a pixel of pinch is worth, chosen so a thumb-span zooms about as far as a flick. */
  private static readonly PINCH_WHEEL_PER_PIXEL = 2;

  /** Every listener this input holds, so they can all be dropped at once. */
  private readonly listening = new AbortController();

  constructor(el: HTMLElement) {
    const signal = this.listening.signal;
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        this.keyHandlers.get(k)?.forEach((h) => h());
      }
      this.keys.add(k);
    }, { signal });
    document.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), { signal });
    window.addEventListener('blur', () => { this.keys.clear(); this.virtualKeys.clear(); }, { signal });

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragMoved = false;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      el.style.cursor = 'grabbing';
    }, { signal });
    el.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragX;
      const dy = e.clientY - this.dragY;
      if (!this.dragMoved && (Math.abs(dx) > Input.DRAG_THRESHOLD || Math.abs(dy) > Input.DRAG_THRESHOLD)) {
        this.dragMoved = true;
      }
      if (this.dragMoved) {
        this.dragDX += dx;
        this.dragDY += dy;
        this.dragX = e.clientX;
        this.dragY = e.clientY;
      }
    }, { signal });
    const endDrag = () => {
      this.dragging = false;
      el.style.cursor = 'default';
    };
    el.addEventListener('mouseup', endDrag, { signal });
    el.addEventListener('mouseleave', endDrag, { signal });
    el.addEventListener('click', (e) => {
      if (this.dragMoved) { this.dragMoved = false; return; }
      this.clicked = true;
      this.clickX = e.clientX;
      this.clickY = e.clientY;
    }, { signal });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelDelta += e.deltaY;
    }, { passive: false, signal });

    // Fingers on the world itself: one drags the free camera and taps whoever it lands on (the
    // browser turns a tap into the click above), two pinch the zoom the way the wheel does.
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.dragging = true;
        this.dragMoved = false;
        this.dragX = t.clientX;
        this.dragY = t.clientY;
      } else {
        // a second finger means a pinch, not a drag: let go of the pan so the view stays put
        this.dragging = false;
        this.pinchGap = gapBetween(e.touches);
      }
    }, { passive: true, signal });
    el.addEventListener('touchmove', (e) => {
      e.preventDefault();   // the world is not a page: no scrolling, no pull-to-refresh
      if (e.touches.length >= 2) {
        const gap = gapBetween(e.touches);
        // fingers apart is zoom in, which is the wheel scrolled the other way
        if (this.pinchGap > 0) this.wheelDelta += (this.pinchGap - gap) * Input.PINCH_WHEEL_PER_PIXEL;
        this.pinchGap = gap;
        return;
      }
      if (!this.dragging) return;
      const t = e.touches[0];
      const dx = t.clientX - this.dragX;
      const dy = t.clientY - this.dragY;
      if (!this.dragMoved && (Math.abs(dx) > Input.DRAG_THRESHOLD || Math.abs(dy) > Input.DRAG_THRESHOLD)) {
        this.dragMoved = true;
      }
      if (this.dragMoved) {
        this.dragDX += dx;
        this.dragDY += dy;
        this.dragX = t.clientX;
        this.dragY = t.clientY;
      }
    }, { passive: false, signal });
    const endTouch = (e: TouchEvent) => {
      if (e.touches.length === 0) { this.dragging = false; this.pinchGap = 0; }
    };
    el.addEventListener('touchend', endTouch, { passive: true, signal });
    el.addEventListener('touchcancel', endTouch, { passive: true, signal });
  }

  /** Stop listening to anything. The world is being put away. */
  dispose(): void {
    this.listening.abort();
    this.keys.clear();
    this.virtualKeys.clear();
    this.keyHandlers.clear();
  }

  isDown(...keys: string[]): boolean {
    for (const k of keys) if (this.keys.has(k) || this.virtualKeys.has(k)) return true;
    return false;
  }

  onKey(key: string, handler: () => void): void {
    const k = key.toLowerCase();
    if (!this.keyHandlers.has(k)) this.keyHandlers.set(k, []);
    this.keyHandlers.get(k)!.push(handler);
  }

  /** An on-screen control being held: reads as the key being held, until `release`. */
  hold(key: string): void { this.virtualKeys.add(key.toLowerCase()); }

  release(key: string): void { this.virtualKeys.delete(key.toLowerCase()); }

  /** An on-screen control tapped: reads as the key being struck once. */
  press(key: string): void {
    this.keyHandlers.get(key.toLowerCase())?.forEach((h) => h());
  }

  /** Call once per frame after consumers have read the accumulated deltas. */
  endFrame(): void {
    this.dragDX = 0;
    this.dragDY = 0;
    this.wheelDelta = 0;
    this.clicked = false;
  }
}

/** How far apart the first two fingers are, in pixels. */
function gapBetween(touches: TouchList): number {
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
