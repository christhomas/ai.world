/** Keyboard + mouse state. Consumers poll `isDown`; one-shot keys use `onKey`. */
export class Input {
  private readonly keys = new Set<string>();
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

  constructor(private readonly el: HTMLElement) {
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        this.keyHandlers.get(k)?.forEach((h) => h());
      }
      this.keys.add(k);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragMoved = false;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      el.style.cursor = 'grabbing';
    });
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
    });
    const endDrag = () => {
      this.dragging = false;
      el.style.cursor = 'default';
    };
    el.addEventListener('mouseup', endDrag);
    el.addEventListener('mouseleave', endDrag);
    el.addEventListener('click', (e) => {
      if (this.dragMoved) { this.dragMoved = false; return; }
      this.clicked = true;
      this.clickX = e.clientX;
      this.clickY = e.clientY;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelDelta += e.deltaY;
    }, { passive: false });
  }

  isDown(...keys: string[]): boolean {
    for (const k of keys) if (this.keys.has(k)) return true;
    return false;
  }

  onKey(key: string, handler: () => void): void {
    const k = key.toLowerCase();
    if (!this.keyHandlers.has(k)) this.keyHandlers.set(k, []);
    this.keyHandlers.get(k)!.push(handler);
  }

  /** Call once per frame after consumers have read the accumulated deltas. */
  endFrame(): void {
    this.dragDX = 0;
    this.dragDY = 0;
    this.wheelDelta = 0;
    this.clicked = false;
  }
}
