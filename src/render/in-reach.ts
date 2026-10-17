import * as THREE from 'three';
import { nativeCamera, type IsoCamera } from './camera';

/**
 * Somebody in reach, where an installed app marks them in the world (#571; design/mobile/README.md,
 * "somebody in reach"): a ring at their feet and their name over their head, in screen pixels.
 */
export interface InReach {
  name: string;
  feet: { x: number; y: number };
  head: { x: number; y: number };
}

/** How far above the ground a name hangs, as the other players' plates hang theirs. */
const OVERHEAD = 2.1;

/** Where on the screen somebody stands, or null when they are behind the lens. */
export function inReachOnScreen(
  camera: IsoCamera, who: { name: string; x: number; y: number; z: number }, width: number, height: number,
): InReach | null {
  // the page's renderer brings the lens up to date as it draws; a host that draws elsewhere never has
  const lens = nativeCamera(camera);
  lens.updateMatrixWorld();
  const at = (y: number): { x: number; y: number } | null => {
    const point = new THREE.Vector3(who.x, y, who.z).project(lens);
    return point.z > 1 ? null : { x: (point.x * 0.5 + 0.5) * width, y: (-point.y * 0.5 + 0.5) * height };
  };
  const feet = at(who.y), head = at(who.y + OVERHEAD);
  return feet && head ? { name: who.name, feet, head } : null;
}
