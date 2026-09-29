import type { FrameDescription } from '../core/scene';
export type { FrameDescription } from '../core/scene';

/** Draws nothing; its input is a neutral description, requested only for a chosen frame. */
export class RecordingPipeline {
  frames = 0;
  private armed = false;
  last: FrameDescription | null = null;

  captureNext(): void { this.armed = true; }

  draw(frame: FrameDescription | (() => FrameDescription)): void {
    this.frames++;
    if (!this.armed) return;
    // Geometry and instance arrays are shared with the running graph to keep normal frames cheap.
    // A captured frame must hold its own values after the next animation tick rewrites them.
    this.last = structuredClone(typeof frame === 'function' ? frame() : frame);
    this.armed = false;
  }
}
