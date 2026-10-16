import { CAMERA, WORLD } from '../core/config';

const FOG_BEGINS = 0.34;

/**
 * How far the fog reaches, measured from the camera rather than from what it is looking at.
 *
 * Two facts decide this and neither is a taste. The camera is orthographic and stands off its
 * target by `CAMERA.HEIGHT` up and `CAMERA.DIST` along, and three.js measures fog from the camera —
 * so a fog that wants to begin forty tiles past the hero begins at forty tiles *plus that standoff*
 * and a hand-tuned pair of constants would be wrong the first time either moved.
 *
 * And the ground is only there out to `WORLD.VIEW_RADIUS` chunks. Fog that ended past the loaded
 * edge would leave the edge on screen, which is the single most useful thing it hides: at full
 * thickness the last chunk is the sky's own colour, so a chunk arriving or leaving is a change to
 * something nobody can see.
 *
 * The camera looks *down* at the ground, so a tile travelled along the ground is worth less than a
 * tile of depth away from the camera — `CAMERA.DIST / standoff` is how much less, and leaving it
 * out would put the far plane of the fog well short of the edge it is meant to cover.
 */
export function fogReach(chunks: number = WORLD.VIEW_RADIUS): { near: number; far: number } {
  const standoff = Math.hypot(CAMERA.HEIGHT, CAMERA.DIST);
  const alongView = CAMERA.DIST / standoff;
  const loaded = chunks * WORLD.CHUNK_SIZE * alongView;
  return { near: standoff + loaded * FOG_BEGINS, far: standoff + loaded };
}

