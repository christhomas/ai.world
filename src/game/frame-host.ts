import type { Viewport } from '../core/viewport';
import type { Level } from '../render/autoquality';
import type { FishingPhase } from './fishing';

/** Surface and presentation services for the shared frame, implemented by each host. */
export interface FrameHost {
  viewport(): Viewport;
  qualityReduced(level: Level): void;
  fishingChanged(phase: FishingPhase, raining: boolean): void;
}
