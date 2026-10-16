/** Pollable player controls shared by browser events and installed host messages. */
export class GameInput {
  protected readonly keys = new Set<string>();
  protected readonly virtualKeys = new Set<string>();
  private readonly keyHandlers = new Map<string, Array<() => void>>();

  dragging = false;
  dragMoved = false;
  dragDX = 0;
  dragDY = 0;
  wheelDelta = 0;
  clickX = -1;
  clickY = -1;
  clicked = false;

  isDown(...keys: string[]): boolean {
    return keys.some((key) => this.keys.has(key) || this.virtualKeys.has(key));
  }

  onKey(key: string, handler: () => void): void {
    const k = key.toLowerCase();
    const handlers = this.keyHandlers.get(k) ?? [];
    handlers.push(handler);
    this.keyHandlers.set(k, handlers);
  }

  hold(key: string): void { this.virtualKeys.add(key.toLowerCase()); }
  release(key: string): void { this.virtualKeys.delete(key.toLowerCase()); }
  press(key: string): void { this.keyHandlers.get(key.toLowerCase())?.forEach((handler) => handler()); }

  /** Clear held controls when the host loses input ownership. */
  clearHeld(): void { this.keys.clear(); this.virtualKeys.clear(); }

  endFrame(): void {
    this.dragDX = 0;
    this.dragDY = 0;
    this.wheelDelta = 0;
    this.clicked = false;
  }

  dispose(): void {
    this.clearHeld();
    this.keyHandlers.clear();
    this.dragging = this.dragMoved = false;
    this.endFrame();
  }
}
