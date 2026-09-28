import type { Moving } from '../src/entities/motion';

/** A dry-land preview has every field the game's body and limb motion expect. */
export function previewMotion(): Moving {
  return { walk: 0, flap: 0, afloat: 0, phase: 0, headPitch: 0, hurt: 0, dying: 0 };
}
