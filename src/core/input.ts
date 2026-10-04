/**
 * Keyboard + pointer state. Consumers poll `isDown`; one-shot keys use `onKey`.
 *
 * A finger is a second way of saying the same things: the on-screen controls in `ui/touch.ts`
 * hold and press the very keys the game already listens for, so a thumb stick and the W key
 * arrive here as one idea and nothing downstream has to know which one moved the hero.
 */
import { GameInput } from './game-input';

export class Input extends GameInput {
  private dragX = 0;
  private dragY = 0;
  private static readonly DRAG_THRESHOLD = 5;

  /** Distance between two pinching fingers last frame, in pixels; 0 when nobody is pinching. */
  private pinchGap = 0;
  /** How much wheel a pixel of pinch is worth, chosen so a thumb-span zooms about as far as a flick. */
  private static readonly PINCH_WHEEL_PER_PIXEL = 2;

  /** Every listener this input holds, so they can all be dropped at once. */
  private readonly listening = new AbortController();

  constructor(el: HTMLElement) {
    super();
    const signal = this.listening.signal;
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        this.press(k);
      }
      this.keys.add(k);
    }, { signal });
    document.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), { signal });
    window.addEventListener('blur', () => this.clearHeld(), { signal });

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
  override dispose(): void {
    this.listening.abort();
    super.dispose();
  }
}

/** How far apart the first two fingers are, in pixels. */
function gapBetween(touches: TouchList): number {
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
