/**
 * A menu deciding for itself, and the one rule that makes that safe.
 *
 * Written for the sleep menu, which is the first thing in this game with *leave the world* in it.
 * A menu that dismisses itself and contains quit can close under somebody who was reading it — so
 * it counts down to the harmless answer, it says out loud that it is counting, and **the count ends
 * for good the moment anything is pressed**. Not paused and not restarted: a count that could come
 * back would be a menu that still closes under a reader, only later.
 *
 * Counted off the frame's `dt` rather than a wall clock. A tab the browser has stopped drawing gets
 * no frames, and a menu that expired while nobody was looking at the page would be the same fault
 * arriving by another road.
 *
 * Its own file because it is arithmetic with no DOM in it, and the panel it belongs to has plenty.
 */
export type Counting = 'idle' | 'running' | 'expired';

export class Countdown {
  private left = 0;
  /** The second last shown, so a panel is redrawn when the number changes and not sixty times for it. */
  private said = 0;

  /** Begin, or — with nothing or nought — do not. */
  begin(after: number | undefined): void {
    this.left = after && after > 0 ? after : 0;
    this.said = Math.ceil(this.left);
  }

  /** Somebody is here. Nothing expires any more, ever. */
  answered(): void {
    this.left = 0;
    this.said = 0;
  }

  /** Whether it ran out on this frame, and whether the number on screen has changed. */
  tick(dt: number): { state: Counting; changed: boolean } {
    if (this.left <= 0) return { state: 'idle', changed: false };
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.said = 0;
      return { state: 'expired', changed: true };
    }
    const now = Math.ceil(this.left);
    const changed = now !== this.said;
    this.said = now;
    return { state: 'running', changed };
  }

  /** Whether anything is counting at all, for a panel deciding whether to draw the row. */
  get counting(): boolean {
    return this.left > 0;
  }

  /** What to put on the row: whole seconds, never nought while it is still running. */
  get seconds(): number {
    return Math.max(1, Math.ceil(this.left));
  }
}
